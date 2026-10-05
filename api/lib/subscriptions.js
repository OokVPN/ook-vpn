import db from "../db.js";

export async function createSubscription(
  userId,
  plan,
  expiresAt = null,
  source = "legacy"
) {
  if (plan !== "free" && plan !== "premium") {
    throw new Error("Invalid subscription plan");
  }

  const allowedSources = [
    "free",
    "trial",
    "paid",
    "admin",
    "legacy"
  ];

  if (!allowedSources.includes(source)) {
    throw new Error("Invalid subscription source");
  }

  await db.execute({
    sql: `
      INSERT INTO subscriptions (
        user_id,
        plan,
        expires_at,
        status,
        source
      )
      VALUES (?, ?, ?, 'active', ?)
    `,
    args: [
      userId,
      plan,
      expiresAt,
      source
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
        AND (
          expires_at IS NULL
          OR expires_at > CURRENT_TIMESTAMP
        )
      ORDER BY id DESC
      LIMIT 1
    `,
    args: [userId]
  });

  return result.rows[0] ?? null;
}
