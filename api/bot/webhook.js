import fs from "node:fs";
import path from "node:path";

const configPath = path.join(
  process.cwd(),
  "config",
  "config.json"
);

function getConfig() {
  return JSON.parse(
    fs.readFileSync(configPath, "utf8")
  );
}

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  await fetch(
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
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const webhookSecret =
    process.env.TELEGRAM_WEBHOOK_SECRET;

  const receivedSecret =
    req.headers["x-telegram-bot-api-secret-token"];

  if (
    !webhookSecret ||
    receivedSecret !== webhookSecret
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const update = req.body;
  const config = getConfig();

  if (config.maintenance) {
    const message = update?.message;

    if (message?.text === "/start") {
      await sendMessage(
        message.chat.id,
        "🛠 OokVPN временно закрыт\n\nМы делаем масштабную переработку VPN.\n\nТекущая подписка продолжает работать до выхода новой версии.\n\nСледите за новостями в канале."
      );
    }

    return res.status(200).json({
      ok: true
    });
  }

  return res.status(200).json({
    ok: true
  });
}
