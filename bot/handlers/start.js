import { getMainKeyboard } from "../keyboards/main.js";

const maintenanceMessage =
  "🛠 OokVPN временно закрыт\n\n" +
  "Мы делаем масштабную переработку VPN.\n\n" +
  "Текущая подписка продолжает работать до выхода новой версии.\n\n" +
  "Следите за новостями в канале: @OokVPNch.";

const welcomeMessage =
  "👋 Добро пожаловать в OokVPN!\n\n" +
  "Выбери нужный раздел:";

async function sendMessage(chatId, text, replyMarkup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const body = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
}

export async function handleStart(message, maintenance) {
  if (maintenance) {
    await sendMessage(
      message.chat.id,
      maintenanceMessage
    );

    return;
  }

  await sendMessage(
    message.chat.id,
    welcomeMessage,
    getMainKeyboard()
  );
}
