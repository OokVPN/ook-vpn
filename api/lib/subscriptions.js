import db from "../db.js";

export async function createSubscription(
  userId,
  plan,
  expiresAt = null
) {
  if (plan !== "free" && plan !== "premium") {
    throw new Error("Invalid subscription plan");
  }

  await db.execute({
    sql: `
      INSERT INTO subscriptions (
        user_id,
        plan,
        expires_at,
        status
      )
      VALUES (?, ?, ?, 'active')
    `,
    args: [
      userId,
      plan,
      expiresAt
    ]
  });
}

export async function getActiveSubscription(userId) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM subscriptions
      WHERE user_id = ?
        AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `,
    args: [userId]
  });

  const subscription = result.rows[0] ?? null;

  if (!subscription) {
    return null;
  }

  if (
    subscription.expires_at &&
    new Date(subscription.expires_at) <= new Date()
  ) {
    return null;
  }

  return subscription;
}
