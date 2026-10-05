import { getMainKeyboard } from "../keyboards/main.js";

import {
  getUserByTelegramId,
  createUser
} from "../../api/lib/users.js";

import {
  getActiveSubscription,
  createSubscription
} from "../../api/lib/subscriptions.js";

const maintenanceMessage =
  "🛠 OokVPN временно закрыт\n\n" +
  "Мы делаем масштабную переработку VPN.\n\n" +
  "Текущая подписка продолжает работать до выхода новой версии.\n\n" +
  "Следите за новостями в канале: @OokVPNch.";

const welcomeMessage =
  "👋 Добро пожаловать в OokVPN!\n\n" +
  "Выбери нужный раздел:";

async function sendMessage(
  chatId,
  text,
  replyMarkup = null
) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  const body = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Telegram API error: ${response.status}`
    );
  }
}

export async function handleStart(
  message,
  maintenance,
  admin = false
) {
  if (maintenance && !admin) {
    await sendMessage(
      message.chat.id,
      maintenanceMessage
    );

    return;
  }

  const telegramId =
    message.from?.id;

  if (!telegramId) {
    throw new Error(
      "Telegram ID is missing"
    );
  }

  let user =
    await getUserByTelegramId(
      telegramId
    );

  if (!user) {
    user = await createUser(
      telegramId
    );
  }

  const subscription =
    await getActiveSubscription(
      user.id
    );

  if (!subscription) {
    await createSubscription(
      user.id,
      "free",
      null,
      "free"
    );
  }

  await sendMessage(
    message.chat.id,
    welcomeMessage,
    getMainKeyboard()
  );
}
