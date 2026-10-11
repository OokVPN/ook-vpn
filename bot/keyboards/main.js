export function getMainKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "Моя подписка",
          callback_data: "subscription",
          style: "success"
        }
      ],
      [
        {
          text: "Устройства",
          callback_data: "devices",
          icon_custom_emoji_id: "5877318502947229960",
          style: "primary"
        }
      ],
      [
        {
          text: "Premium",
          callback_data: "premium",
          icon_custom_emoji_id: "5807465992363710697",
          style: "primary"
        },
        {
          text: "Статистика",
          callback_data: "stats",
          icon_custom_emoji_id: "5931472654660800739",
          style: "primary"
        }
      ],
      [
        {
          text: "Помощь",
          callback_data: "help",
          icon_custom_emoji_id: "5879785854284599288",
          style: "danger"
        }
      ]
    ]
  };
}
