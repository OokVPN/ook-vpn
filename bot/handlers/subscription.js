import fs from "node:fs";
import path from "node:path";

import {
  getUserByTelegramId
} from "../../api/lib/users.js";

import {
  getActiveSubscription
} from "../../api/lib/subscriptions.js";

import {
  getOrCreateUserToken
} from "../../api/lib/tokens.js";

import {
  getDeviceCount
} from "../../api/lib/devices.js";

function getPlans() {
  const planPath = path.join(
    process.cwd(),
    "plan.json"
  );

  return JSON.parse(
    fs.readFileSync(planPath, "utf8")
  );
}

async function telegramRequest(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram ${method} error: ${
        result.description || JSON.stringify(result)
      }`
    );
  }

  return result;
}

async function answerCallback(
  callbackQueryId,
  text = null
) {
  const body = {
    callback_query_id: callbackQueryId
  };

  if (text) {
    body.text = text;
  }

  await telegramRequest(
    "answerCallbackQuery",
    body
  );
}

async function sendTextMessage(
  chatId,
  text,
  replyMarkup
) {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup
  });
}

async function editTextMessage(
  chatId,
  messageId,
  text,
  replyMarkup
) {
  await telegramRequest("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup
  });
}

async function deleteMessage(
  chatId,
  messageId
) {
  await telegramRequest("deleteMessage", {
    chat_id: chatId,
    message_id: messageId
  });
}

async function showTextSection(
  callbackQuery,
  text,
  replyMarkup
) {
  const message = callbackQuery.message;
  const chatId = message.chat.id;

  if (message.photo?.length) {
    await deleteMessage(
      chatId,
      message.message_id
    );

    await sendTextMessage(
      chatId,
      text,
      replyMarkup
    );

    return;
  }

  await editTextMessage(
    chatId,
    message.message_id,
    text,
    replyMarkup
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

  return value.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow"
  });
}

function getSubscriptionUrl(plan, token) {
  const baseUrl = process.env.PUBLIC_URL;

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

function getSubscriptionKeyboard(url) {
  return {
    inline_keyboard: [
      [
        {
          text: "Скопировать",
          copy_text: {
            text: url
          }
        }
      ],
      [
        {
          text: "Назад",
          callback_data: "back",
          icon_custom_emoji_id: "5877629862306385808"
        }
      ]
    ]
  };
}

function getBackKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "Назад",
          callback_data: "back",
          icon_custom_emoji_id: "5877629862306385808"
        }
      ]
    ]
  };
}

export async function handleSubscription(
  callbackQuery
) {
  const telegramId = callbackQuery.from.id;

  const user = await getUserByTelegramId(
    telegramId
  );

  if (!user) {
    await answerCallback(
      callbackQuery.id,
      "Пользователь не найден"
    );

    return;
  }

  const subscription = await getActiveSubscription(
    user.id
  );

  if (!subscription) {
    await answerCallback(callbackQuery.id);

    await showTextSection(
      callbackQuery,
      "📡 Моя подписка\n\n" +
        "Активной подписки нет.",
      getBackKeyboard()
    );

    return;
  }

  const plans = getPlans();

  const basePlan =
    plans[subscription.plan] || {};

  const sourcePlan =
    plans[subscription.source] || {};

  const planName =
    sourcePlan.name ||
    basePlan.name ||
    subscription.plan;

  const description =
    sourcePlan.description ||
    basePlan.description ||
    "Подписка OokVPN";

  const deviceLimit =
    sourcePlan.devices ??
    basePlan.devices ??
    0;

  const deviceCount = await getDeviceCount(
    user.id
  );

  const token = await getOrCreateUserToken(
    user.id
  );

  const url = getSubscriptionUrl(
    subscription.plan,
    token
  );

  const devicesText =
    deviceLimit === -1
      ? `${deviceCount}/∞`
      : `${deviceCount}/${deviceLimit}`;

  const text =
    "📡 Моя подписка\n\n" +
    `⭐ План: ${planName}\n` +
    `📝 ${description}\n\n` +
    `📱 Устройства: ${devicesText}\n` +
    `⏳ Действует до: ${formatDate(subscription.expires_at)}`;

  await answerCallback(callbackQuery.id);

  await showTextSection(
    callbackQuery,
    text,
    getSubscriptionKeyboard(url)
  );
}
