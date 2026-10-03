const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

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

  console.log("Telegram update received");

  return res.status(200).json({
    ok: true
  });
}
