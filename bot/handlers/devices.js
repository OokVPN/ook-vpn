import {
  getUserByTelegramId
} from "../../lib/users.js";

import {
  getUserPlanInfo,
  isUnlimited
} from "../../lib/plans.js";

import {
  parseDbDate
} from "../../lib/device-access.js";

import {
  answerCallback,
  editScreen
} from "../telegram.js";

import {
  getUserDevices,
  removeDevice,
  restoreDevice
} from "../../lib/devices.js";

async function editMessage(
  message,
  text,
  replyMarkup
) {
  await editScreen(message, {
    text,
    replyMarkup
  });
}

function getDeviceName(device) {
  return device.name || "Неизвестное устройство";
}

function formatLastSeen(value) {
  const date = parseDbDate(value);

  if (!date) {
    return null;
  }

  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getDevicesKeyboard(devices) {
  const rows = [];

  for (const device of devices) {
    rows.push([
      {
        text: `${getDeviceName(device)}`,
        callback_data: `delete_device:${device.id}`,
        icon_custom_emoji_id: "5985759134316761279",
        style: "danger"
      }
    ]);
  }

  rows.push([
    {
      text: "Восстановить устройство",
      callback_data: "restore_menu",
      icon_custom_emoji_id: "5988011101634172894",
      style: "success"
    }
  ]);

  rows.push([
    {
      text: "Назад",
      callback_data: "back",
      icon_custom_emoji_id: "5877629862306385808"
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

function getRestoreKeyboard(devices) {
  const rows = [];

  for (const device of devices) {
    rows.push([
      {
        text: `${getDeviceName(device)}`,
        callback_data: `restore_device:${device.id}`,
        icon_custom_emoji_id: "5988011101634172894",
        style: "success"
      }
    ]);
  }

  rows.push([
    {
      text: "Назад",
      callback_data: "devices",
      icon_custom_emoji_id: "5877629862306385808"
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

// Screen "My devices": the limit comes from the user's current plan
// (plan.json), so it changes by itself when the plan changes.
async function renderDevices(callbackQuery, user) {
  const devices = await getUserDevices(user.id);

  const activeDevices = devices.filter(
    device => device.status === "active"
  );

  const info = await getUserPlanInfo(user.id);

  const unlimited = info ? isUnlimited(info.plan) : false;
  const limit = info ? info.plan.devices : null;

  const usage =
    limit === null
      ? `${activeDevices.length}`
      : unlimited
        ? `${activeDevices.length}/∞`
        : `${activeDevices.length}/${limit}`;

  let text =
    "📱 Мои устройства\n\n" +
    `Использовано: ${usage}\n`;

  if (info) {
    text += `План: ${info.plan.name}\n`;
  }

  if (
    limit !== null &&
    !unlimited &&
    activeDevices.length > limit
  ) {
    text +=
      "\n⚠️ Превышен лимит устройств. " +
      "Удалите лишние.\n";
  }

  text += "\n";

  if (activeDevices.length === 0) {
    text +=
      "Активных устройств нет. Устройство появится здесь, " +
      "когда вы откроете подписку в приложении.\n";
  } else {
    for (const device of activeDevices) {
      text += `📱 ${getDeviceName(device)}\n`;

      const lastSeen = formatLastSeen(device.last_seen);

      if (lastSeen) {
        text += `Последняя активность: ${lastSeen}\n`;
      }

      text += "\n";
    }

    text +=
      "Выберите устройство, чтобы удалить его. " +
      "Удалённое устройство перестанет получать серверы.";
  }

  await editMessage(
    callbackQuery.message,
    text,
    getDevicesKeyboard(activeDevices)
  );
}

function getUser(callbackQuery) {
  return getUserByTelegramId(callbackQuery.from.id);
}

// A callback can be answered only once, so the two kinds of handlers
// report a missing user differently: those that already answered show
// a screen, those that answer with a toast do it here.
async function showNoUser(callbackQuery) {
  await editMessage(
    callbackQuery.message,
    "📱 Мои устройства\n\nСначала отправь боту /start.",
    {
      inline_keyboard: [
        [
          {
            text: "Назад",
            callback_data: "back",
            icon_custom_emoji_id: "5877629862306385808"
          }
        ]
      ]
    }
  );
}

export async function handleDevices(callbackQuery) {
  await answerCallback(callbackQuery.id);

  const user = await getUser(callbackQuery);

  if (!user) {
    await showNoUser(callbackQuery);
    return;
  }

  await renderDevices(callbackQuery, user);
}

export async function handleDeleteDevice(
  callbackQuery,
  deviceId
) {
  const user = await getUser(callbackQuery);

  if (!user) {
    await answerCallback(
      callbackQuery.id,
      "Сначала отправь боту /start"
    );

    return;
  }

  const removed = await removeDevice(user.id, deviceId);

  await answerCallback(
    callbackQuery.id,
    removed ? "Устройство удалено" : "Устройство не найдено"
  );

  await renderDevices(callbackQuery, user);
}

export async function handleRestoreMenu(callbackQuery) {
  await answerCallback(callbackQuery.id);

  const user = await getUser(callbackQuery);

  if (!user) {
    await showNoUser(callbackQuery);
    return;
  }

  const devices = await getUserDevices(user.id);

  const removedDevices = devices.filter(
    device => device.status === "removed"
  );

  if (removedDevices.length === 0) {
    await editMessage(
      callbackQuery.message,
      "♻️ Восстановление устройства\n\n" +
        "Удалённых устройств нет.",
      {
        inline_keyboard: [
          [
            {
              text: "Назад",
              callback_data: "back",
              icon_custom_emoji_id: "5877629862306385808"
            }
          ]
        ]
      }
    );

    return;
  }

  await editMessage(
    callbackQuery.message,
    "♻️ Восстановление устройства\n\n" +
      "Выберите устройство. ",
    getRestoreKeyboard(removedDevices)
  );
}

export async function handleRestoreDevice(
  callbackQuery,
  deviceId
) {
  const user = await getUser(callbackQuery);

  if (!user) {
    await answerCallback(
      callbackQuery.id,
      "Сначала отправь боту /start"
    );

    return;
  }

  const restored = await restoreDevice(user.id, deviceId);

  await answerCallback(
    callbackQuery.id,
    restored
      ? "Устройство восстановлено"
      : "Устройство не найдено"
  );

  await renderDevices(callbackQuery, user);
}
