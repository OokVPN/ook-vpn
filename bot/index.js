import fs from "node:fs";
import path from "node:path";

import { handleStart } from "./handlers/start.js";
import { handleSubscription } from "./handlers/subscription.js";
import { getMainKeyboard } from "./keyboards/main.js";

const MENU_PHOTO =
  "https://hotimg.com/f/kK9RT4nw.png";

const welcomeMessage =
  "👋 Добро пожаловать в OokVPN!\n\n" +
  "Выбери нужный раздел:";

function getConfig() {
  const configPath = path.join(
    process.cwd(),
    "config.json"
  );

  return JSON.parse(
    fs.readFileSync(configPath, "utf8")
  );
}

function isAdmin(telegramId) {
  const adminIds = (process.env.ADMIN_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  return adminIds.includes(String(telegramId));
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

async function showMainMenu(callbackQuery) {
  const message = callbackQuery.message;
  const chatId = message.chat.id;

  await deleteMessage(
    chatId,
    message.message_id
  );

  await telegramRequest("sendPhoto", {
    chat_id: chatId,
    photo: MENU_PHOTO,
    caption: welcomeMessage,
    reply_markup: getMainKeyboard()
  });
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

async function showDevices(callbackQuery) {
  await showTextSection(
    callbackQuery,
    "📱 Менеджер устройств\n\n" +
      "Менеджер устройств скоро появится!\n\n" +
      "Мы готовим обновление OokVPN.",
    getBackKeyboard()
  );
}

async function showPremium(callbackQuery) {
  await showTextSection(
    callbackQuery,
    "💎 Premium\n\n" +
      "⭐ Больше возможностей\n" +
      "📡 Premium-серверы\n" +
      "📱 Расширенный лимит устройств\n\n" +
      "Покупка Premium скоро будет доступна.",
    getBackKeyboard()
  );
}

async function showStats(callbackQuery) {
  await showTextSection(
    callbackQuery,
    "📊 Статистика\n\n" +
      "Статистика пользователя скоро будет доступна.",
    getBackKeyboard()
  );
}

async function showHelp(callbackQuery) {
  await showTextSection(
    callbackQuery,
    "❓ Помощь\n\n" +
      "Если у тебя возникли проблемы с OokVPN, " +
      "обратись в поддержку.",
    getBackKeyboard()
  );
}

export async function handleUpdate(update) {
  const config = getConfig();

  if (update?.message) {
    if (update.message.text === "/start") {
      await handleStart(
        update.message,
        config.maintenance,
        isAdmin(update.message.from?.id)
      );
    }

    return;
  }

  if (!update?.callback_query) {
    return;
  }

  const callbackQuery = update.callback_query;

  if (
    config.maintenance &&
    !isAdmin(callbackQuery.from?.id)
  ) {
    await answerCallback(
      callbackQuery.id,
      "🛠 Бот временно находится на технических работах"
    );

    return;
  }

  const data = callbackQuery.data || "";

  if (data === "back") {
    await answerCallback(callbackQuery.id);
    await showMainMenu(callbackQuery);
    return;
  }

  if (data === "subscription") {
    await handleSubscription(callbackQuery);
    return;
  }

  if (
    data === "devices" ||
    data === "restore_menu" ||
    data.startsWith("delete_device:") ||
    data.startsWith("restore_device:")
  ) {
    await answerCallback(callbackQuery.id);
    await showDevices(callbackQuery);
    return;
  }

  if (data === "premium") {
    await answerCallback(callbackQuery.id);
    await showPremium(callbackQuery);
    return;
  }

  if (data === "stats") {
    await answerCallback(callbackQuery.id);
    await showStats(callbackQuery);
    return;
  }

  if (data === "help") {
    await answerCallback(callbackQuery.id);
    await showHelp(callbackQuery);
    return;
  }

  await answerCallback(callbackQuery.id);
}
