import {
  getUserByTelegramId
} from "../../api/lib/users.js";

import {
  getActiveSubscription
} from "../../api/lib/subscriptions.js";

import {
  createToken
} from "../../api/lib/tokens.js";

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

  const response = await fetch(
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

  if (!response.ok) {
    throw new Error(
      `Telegram API error: ${response.status}`
    );
  }
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

function getSubscriptionKeyboard(
  url
) {
  return {
    inline_keyboard: [
      [
        {
          text: "📋 Скопировать ссылку",
          copy_text: {
            text: url
          }
        }
      ],
      [
        {
          text: "◀️ Назад",
          callback_data: "back"
        }
      ]
    ]
  };
}

export async function handleSubscription(
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

  const subscription =
    await getActiveSubscription(
      user.id
    );

  if (!subscription) {
    await answerCallback(
      callbackQuery.id
    );

    await editMessage(
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      "📡 Моя подписка\n\n" +
        "Активной подписки нет.",
      {
        inline_keyboard: [
          [
            {
              text: "◀️ Назад",
              callback_data: "back"
            }
          ]
        ]
      }
    );

    return;
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

  const expires =
    formatDate(
      subscription.expires_at
    );

  await answerCallback(
    callbackQuery.id
  );

  await editMessage(
    callbackQuery.message.chat.id,
    callbackQuery.message.message_id,
    "📡 Моя подписка\n\n" +
      `Тариф: ${plan}\n` +
      `Действует до: ${expires}\n\n` +
      "🔗 Ссылка на подписку:\n" +
      `${url}\n\n` +
      "Нажми кнопку ниже, чтобы скопировать ссылку.",
    getSubscriptionKeyboard(url)
  );
}
