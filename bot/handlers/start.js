import { getMainKeyboard } from "../keyboards/main.js";

import {
  getMenuPhoto,
  sendScreen
} from "../telegram.js";

import {
  maintenanceText,
  welcomeText
} from "../texts.js";

import { getDefaults } from "../../lib/config.js";

import {
  getUserByTelegramId,
  createUser
} from "../../lib/users.js";

import {
  getActiveSubscription,
  createSubscription
} from "../../lib/subscriptions.js";

export async function handleStart(
  message,
  maintenance,
  admin = false
) {
  if (maintenance && !admin) {
    await sendScreen(message.chat.id, {
      text: maintenanceText()
    });

    return;
  }

  const telegramId = message.from?.id;

  if (!telegramId) {
    throw new Error("Telegram ID is missing");
  }

  let user = await getUserByTelegramId(telegramId);

  if (!user) {
    user = await createUser(telegramId);
  }

  const subscription = await getActiveSubscription(user.id);

  if (!subscription) {
    const defaults = getDefaults();

    await createSubscription(
      user.id,
      defaults.plan,
      null,
      defaults.source
    );
  }

  await sendScreen(message.chat.id, {
    text: welcomeText(),
    replyMarkup: getMainKeyboard(),
    photo: getMenuPhoto()
  });
}
