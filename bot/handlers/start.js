import { getMainKeyboard } from "../keyboards/main.js";

import {
  getUserByTelegramId,
  createUser
} from "../../api/lib/users.js";

import {
  getActiveSubscription,
  createSubscription
} from "../../api/lib/subscriptions.js";

const MENU_PHOTO =
  "https://hotimg.com/f/kK9RT4nw.png";

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
  text
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram sendMessage error: ${JSON.stringify(result)}`
    );
  }
}

async function sendWelcomePhoto(chatId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendPhoto`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo: MENU_PHOTO,
        caption: welcomeMessage,
        reply_markup: getMainKeyboard()
      })
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram sendPhoto error: ${JSON.stringify(result)}`
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

  const telegramId = message.from?.id;

  if (!telegramId) {
    throw new Error("Telegram ID is missing");
  }

  let user = await getUserByTelegramId(telegramId);

  if (!user) {
    user = await createUser(telegramId);
  }

  const subscription = await getActiveSubscription(user.id);

  if (!subscription) {
    await createSubscription(
      user.id,
      "free",
      null,
      "free"
    );
  }

  await sendWelcomePhoto(message.chat.id);
}
