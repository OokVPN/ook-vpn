import { handleUpdate } from "../../bot/index.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret =
    req.headers["x-telegram-bot-api-secret-token"];

  if (
    !secret ||
    receivedSecret !== secret
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  try {
    await handleUpdate(req.body);

    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    // Always ack with 200: on a non-2xx Telegram re-sends the same update
    // over and over, so one bad update would block the bot.
    console.error("Bot error:", error);

    return res.status(200).json({
      ok: false
    });
  }
}
