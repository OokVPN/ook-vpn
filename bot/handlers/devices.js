import {
  getUserByTelegramId
} from "../../api/lib/users.js";

import {
  getUserDevices,
  getDeviceCount,
  removeDevice,
  restoreDevice
} from "../../api/lib/devices.js";

async function answerCallback(
  callbackQueryId,
  text = null
) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  const body = {
    callback_query_id: callbackQueryId
  };

  if (text) {
    body.text = text;
  }

  await fetch(
    `https://api.telegram.org/bot${token}/answerCallbackQuery`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
}

async function editMessage(
  chatId,
  messageId,
  text,
  replyMarkup
) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  await fetch(
    `https://api.telegram.org/bot${token}/editMessageText`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: replyMarkup
      })
    }
  );
}

function getDeviceName(device) {
  return device.name || "Неизвестное устройство";
}

function getDevicesKeyboard(devices) {
  const rows = [];

  for (const device of devices) {
    rows.push([
      {
        text: `❌ ${getDeviceName(device)}`,
        callback_data:
          `delete_device:${device.id}`
      }
    ]);
  }

  rows.push([
    {
      text: "♻️ Восстановить устройство",
      callback_data: "restore_menu"
    }
  ]);

  rows.push([
    {
      text: "◀️ Назад",
      callback_data: "back"
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
        text: `♻️ ${getDeviceName(device)}`,
        callback_data:
          `restore_device:${device.id}`
      }
    ]);
  }

  rows.push([
    {
      text: "◀️ Назад",
      callback_data: "devices"
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

async function showDevices(
  callbackQuery,
  devices,
  count
) {
  const activeDevices = devices.filter(
    device => device.status === "active"
  );

  let text =
    "📱 Мои устройства\n\n" +
    `Использовано: ${count}\n\n`;

  if (activeDevices.length === 0) {
    text += "Активных устройств нет.";
  } else {
    for (const device of activeDevices) {
      text +=
        `📱 ${getDeviceName(device)}\n`;

      if (device.last_seen) {
        text +=
          `Последняя активность: ${device.last_seen}\n`;
      }

      text += "\n";
    }
  }

  text +=
    "\nВыберите устройство, чтобы удалить его.";

  await editMessage(
    callbackQuery.message.chat.id,
    callbackQuery.message.message_id,
    text,
    getDevicesKeyboard(activeDevices)
  );
}

export async function handleDevices(
  callbackQuery
) {
  const telegramId =
    callbackQuery.from.id;

  const user =
    await getUserByTelegramId(
      telegramId
    );

  if (!user) {
    await answerCallback(
      callbackQuery.id,
      "Пользователь не найден"
    );

    return;
  }

  await answerCallback(
    callbackQuery.id
  );

  const devices =
    await getUserDevices(user.id);

  const count =
    await getDeviceCount(user.id);

  await showDevices(
    callbackQuery,
    devices,
    count
  );
}

export async function handleDeleteDevice(
  callbackQuery,
  deviceId
) {
  const telegramId =
    callbackQuery.from.id;

  const user =
    await getUserByTelegramId(
      telegramId
    );

  if (!user) {
    await answerCallback(
      callbackQuery.id,
      "Пользователь не найден"
    );

    return;
  }

  const removed =
    await removeDevice(
      user.id,
      deviceId
    );

  if (!removed) {
    await answerCallback(
      callbackQuery.id,
      "Устройство не найдено"
    );

    return;
  }

  await answerCallback(
    callbackQuery.id,
    "Устройство удалено"
  );

  const devices =
    await getUserDevices(user.id);

  const count =
    await getDeviceCount(user.id);

  await showDevices(
    callbackQuery,
    devices,
    count
  );
}

export async function handleRestoreMenu(
  callbackQuery
) {
  const telegramId =
    callbackQuery.from.id;

  const user =
    await getUserByTelegramId(
      telegramId
    );

  if (!user) {
    await answerCallback(
      callbackQuery.id,
      "Пользователь не найден"
    );

    return;
  }

  const devices =
    await getUserDevices(user.id);

  const removedDevices =
    devices.filter(
      device =>
        device.status === "removed"
    );

  await answerCallback(
    callbackQuery.id
  );

  if (removedDevices.length === 0) {
    await editMessage(
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      "♻️ Восстановление устройства\n\n" +
        "Удалённых устройств нет.",
      {
        inline_keyboard: [
          [
            {
              text: "◀️ Назад",
              callback_data: "devices"
            }
          ]
        ]
      }
    );

    return;
  }

  await editMessage(
    callbackQuery.message.chat.id,
    callbackQuery.message.message_id,
    "♻️ Восстановление устройства\n\n" +
      "Выберите устройство:",
    getRestoreKeyboard(removedDevices)
  );
}

export async function handleRestoreDevice(
  callbackQuery,
  deviceId
) {
  const telegramId =
    callbackQuery.from.id;

  const user =
    await getUserByTelegramId(
      telegramId
    );

  if (!user) {
    await answerCallback(
      callbackQuery.id,
      "Пользователь не найден"
    );

    return;
  }

  const restored =
    await restoreDevice(
      user.id,
      deviceId
    );

  if (!restored) {
    await answerCallback(
      callbackQuery.id,
      "Устройство не найдено"
    );

    return;
  }

  await answerCallback(
    callbackQuery.id,
    "Устройство восстановлено"
  );

  const devices =
    await getUserDevices(user.id);

  const count =
    await getDeviceCount(user.id);

  await showDevices(
    callbackQuery,
    devices,
    count
  );
}
