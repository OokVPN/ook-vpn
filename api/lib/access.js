import { createUser } from "./users.js";
import { createSubscription } from "./subscriptions.js";
import { createToken } from "./tokens.js";

export async function createAccess({
  telegramId,
  plan,
  expiresAt = null
}) {
  if (!telegramId) {
    throw new Error("Telegram ID is required");
  }

  if (plan !== "free" && plan !== "premium") {
    throw new Error("Invalid subscription plan");
  }

  const user = await createUser(telegramId);

  await createSubscription(
    user.id,
    plan,
    expiresAt
  );

  const token = await createToken(
    user.id,
    expiresAt
  );

  return {
    user,
    token,
    plan,
    expiresAt
  };
}
