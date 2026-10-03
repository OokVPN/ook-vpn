import {
  getUserByTelegramId
} from "../../api/lib/users.js";

import {
  getActiveSubscription
} from "../../api/lib/subscriptions.js";

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

function getSubscriptionKeyboard() {
  return {
    inline_keyboard: [
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
      getSubscriptionKeyboard()
    );

    return;
  }

  await answerCallback(
    callbackQuery.id
  );

  const plan =
    subscription.plan === "premium"
      ? "⭐ Premium"
      : "🆓 Free";

  const expires =
    formatDate(
      subscription.expires_at
    );

  await editMessage(
    callbackQuery.message.chat.id,
    callbackQuery.message.message_id,
    "📡 Моя подписка\n\n" +
      `Тариф: ${plan}\n` +
      `Действует до: ${expires}`,
    getSubscriptionKeyboard()
  );
}
