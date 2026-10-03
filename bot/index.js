import fs from "node:fs";
import path from "node:path";

import { handleStart } from "./handlers/start.js";

import {
  handleSubscription
} from "./handlers/subscription.js";

import {
  handleDevices,
  handleDeleteDevice,
  handleRestoreMenu,
  handleRestoreDevice
} from "./handlers/devices.js";

function getConfig() {
  const configPath = path.join(
    process.cwd(),
    "config.json"
  );

  return JSON.parse(
    fs.readFileSync(configPath, "utf8")
  );
}

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

export async function handleUpdate(update) {
  const config = getConfig();

  if (update?.message) {
    if (update.message.text === "/start") {
      await handleStart(
        update.message,
        config.maintenance
      );
    }

    return;
  }

  if (!update?.callback_query) {
    return;
  }

  const callbackQuery =
    update.callback_query;

  if (config.maintenance) {
    await answerCallback(
      callbackQuery.id,
      "🛠 Бот временно находится на технических работах"
    );

    return;
  }

  const data =
    callbackQuery.data || "";

  if (data === "subscription") {
    await handleSubscription(
      callbackQuery
    );

    return;
  }

  if (data === "devices") {
    await handleDevices(
      callbackQuery
    );

    return;
  }

  if (data === "restore_menu") {
    await handleRestoreMenu(
      callbackQuery
    );

    return;
  }

  if (data.startsWith("delete_device:")) {
    const deviceId = Number(
      data.split(":")[1]
    );

    if (!Number.isInteger(deviceId)) {
      await answerCallback(
        callbackQuery.id,
        "Некорректное устройство"
      );

      return;
    }

    await handleDeleteDevice(
      callbackQuery,
      deviceId
    );

    return;
  }

  if (data.startsWith("restore_device:")) {
    const deviceId = Number(
      data.split(":")[1]
    );

    if (!Number.isInteger(deviceId)) {
      await answerCallback(
        callbackQuery.id,
        "Некорректное устройство"
      );

      return;
    }

    await handleRestoreDevice(
      callbackQuery,
      deviceId
    );

    return;
  }

  await answerCallback(
    callbackQuery.id
  );
}
