import fs from "node:fs";
import path from "node:path";

const DEFAULT_MENU_PHOTO = "https://hotimg.com/f/xx5G65uc.jpg";
const CAPTION_LIMIT = 1024;

export async function telegramRequest(method, body) {
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

export async function answerCallback(
  callbackQueryId,
  text = null
) {
  const body = {
    callback_query_id: callbackQueryId
  };

  if (text) {
    body.text = text;
  }

  try {
    await telegramRequest("answerCallbackQuery", body);
  } catch (error) {
    const message = String(error?.message || error);

    if (
      message.includes("query is too old") ||
      message.includes("query ID is invalid") ||
      message.includes("response timeout expired")
    ) {
      console.warn(
        "Ignoring expired Telegram callback query:",
        message
      );
      return;
    }

    throw error;
  }
}

export function getMenuPhoto() {
  try {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "config.json"),
        "utf8"
      )
    );

    return config.bot?.menuPhoto || DEFAULT_MENU_PHOTO;
  } catch {
    return DEFAULT_MENU_PHOTO;
  }
}

// The picture is shown as a link preview above the text. Because the
// message stays a plain text message, editMessageText can attach the
// picture (url) or remove it (is_disabled) at any time, without ever
// deleting the message. A real photo message cannot be turned back
// into a text message by the Bot API, so we do not send those.
function previewOptions(photo) {
  if (!photo) {
    return { is_disabled: true };
  }

  return {
    url: photo,
    show_above_text: true,
    prefer_large_media: true
  };
}

function isNotModified(error) {
  return String(error?.message || error).includes(
    "message is not modified"
  );
}

export async function sendScreen(
  chatId,
  { text, replyMarkup, photo = null }
) {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
    link_preview_options: previewOptions(photo)
  });
}

export async function editScreen(
  message,
  { text, replyMarkup, photo = null }
) {
  const chatId = message.chat.id;
  const messageId = message.message_id;

  // Menus sent by older versions of the bot are real photo messages.
  // They cannot go through editMessageText, so edit the caption
  // instead (the photo stays, the message is still not deleted).
  const isMediaMessage = Boolean(
    message.photo?.length ||
      message.video ||
      message.animation ||
      message.document
  );

  try {
    if (isMediaMessage) {
      await telegramRequest("editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: text.slice(0, CAPTION_LIMIT),
        reply_markup: replyMarkup
      });

      return;
    }

    await telegramRequest("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: replyMarkup,
      link_preview_options: previewOptions(photo)
    });
  } catch (error) {
    if (isNotModified(error)) {
      return;
    }

    throw error;
  }
}

// Edits the message the button was pressed on; if Telegram no longer
// gives us that message (too old), sends a fresh one instead.
export async function showScreen(
  callbackQuery,
  screen
) {
  const message = callbackQuery.message;

  if (!message || message.date === 0) {
    await sendScreen(callbackQuery.from.id, screen);
    return;
  }

  await editScreen(message, screen);
}
