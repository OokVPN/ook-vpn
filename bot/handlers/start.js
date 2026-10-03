const maintenanceMessage =
  "🛠 OokVPN временно закрыт\n\n" +
  "Мы делаем масштабную переработку VPN.\n\n" +
  "Текущая подписка продолжает работать до выхода новой версии.\n\n" +
  "Следите за новостями в канале: @OokVPNch.";

export async function handleStart(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: maintenanceMessage
      })
    }
  );
}
