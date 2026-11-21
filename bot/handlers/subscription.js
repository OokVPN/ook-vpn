import {
  getUserByTelegramId
} from "../../lib/users.js";

import {
  getUserPlanInfo,
  isUnlimited
} from "../../lib/plans.js";

import { defaultPlanDescription } from "../texts.js";

import {
  getOrCreateUserToken
} from "../../lib/tokens.js";

import {
  getDeviceCount
} from "../../lib/devices.js";

import {
  answerCallback,
  showScreen
} from "../telegram.js";

async function showTextSection(
  callbackQuery,
  text,
  replyMarkup
) {
  await showScreen(callbackQuery, {
    text,
    replyMarkup
  });
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
          style: "success",
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
  // Acknowledge immediately, before database calls can make the callback expire.
  await answerCallback(callbackQuery.id);

  const telegramId = callbackQuery.from.id;

  const user = await getUserByTelegramId(
    telegramId
  );

  if (!user) {
    await showTextSection(
      callbackQuery,
      "📡 Моя подписка\n\n" +
        "Сначала отправь боту /start.",
      getBackKeyboard()
    );

    return;
  }

  const info = await getUserPlanInfo(user.id);

  if (!info) {
    await showTextSection(
      callbackQuery,
      "📡 Моя подписка\n\n" +
        "Активной подписки нет.",
      getBackKeyboard()
    );

    return;
  }

  const { subscription, plan } = info;

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

  const devicesText = isUnlimited(plan)
    ? `${deviceCount}/∞`
    : `${deviceCount}/${plan.devices}`;

  const text =
    "📡 Моя подписка\n\n" +
    `⭐ План: ${plan.name}\n` +
    `📝 ${plan.description || defaultPlanDescription()}\n\n` +
    `📱 Устройства: ${devicesText}\n` +
    `⏳ Действует до: ${formatDate(subscription.expires_at)}`;

  await showTextSection(
    callbackQuery,
    text,
    getSubscriptionKeyboard(url)
  );
}
