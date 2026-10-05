import { getMainKeyboard } from "../keyboards/main.js";

import {
  getUserByTelegramId,
  createUser
} from "../../api/lib/users.js";

import {
  getActiveSubscription
} from "../../api/lib/subscriptions.js";

import {
  createToken
} from "../../api/lib/tokens.js";

const maintenanceMessage =
  "🛠 OokVPN временно закрыт\n\n" +
  "Мы делаем масштабную переработку VPN.\n\n" +
  "Текущая подписка продолжает работать до выхода новой версии.\n\n" +
  "Следите за новостями в канале: @OokVPNch.";

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

function getSubscriptionUrl(
  plan,
  token
) {
  const baseUrl =
    process.env.PUBLIC_URL;

  if (!baseUrl) {
    throw new Error(
      "PUBLIC_URL is not configured"
    );
  }

  return (
    `${baseUrl.replace(/\/+$/, "")}` +
    `/api/sub/${plan}` +
    `?token=${encodeURIComponent(token)}`
  );
}

function formatDate(date) {
  if (!date) {
    return "Бессрочно";
  }

  const value = new Date(date);

  if (Number.isNaN(value.getTime())) {
    return "Неизвестно";
  }

  return value.toLocaleString(
    "ru-RU",
    {
      timeZone: "Europe/Moscow"
    }
  );
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

  let subscription =
    await getActiveSubscription(
      user.id
    );

  if (!subscription) {
    const { createSubscription } =
      await import(
        "../../api/lib/subscriptions.js"
      );

    await createSubscription(
      user.id,
      "free",
      null,
      "free"
    );

    subscription =
      await getActiveSubscription(
        user.id
      );
  }

  if (!subscription) {
    throw new Error(
      "Failed to create Free subscription"
    );
  }

  const token =
    await createToken(
      user.id,
      subscription.expires_at
    );

  const url =
    getSubscriptionUrl(
      subscription.plan,
      token
    );

  const plan =
    subscription.plan === "premium"
      ? "⭐ Premium"
      : "🆓 Free";

  const text =
    "👋 Добро пожаловать в OokVPN!\n\n" +
    `Тариф: ${plan}\n` +
    `Действует до: ${formatDate(subscription.expires_at)}\n\n` +
    "🔗 Твоя ссылка на подписку:\n" +
    `${url}\n\n` +
    "Добавь эту ссылку в Happ.";

  await sendMessage(
    message.chat.id,
    text,
    getMainKeyboard()
  );
}
