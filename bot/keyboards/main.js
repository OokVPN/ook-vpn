export function getMainKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "📡 Моя подписка",
          callback_data: "subscription"
        }
      ],
      [
        {
          text: "📱 Устройства",
          callback_data: "devices"
        }
      ],
      [
        {
          text: "💎 Premium",
          callback_data: "premium"
        },
        {
          text: "📊 Статистика",
          callback_data: "stats"
        }
      ],
      [
        {
          text: "❓ Помощь",
          callback_data: "help"
        }
      ]
    ]
  };
}
