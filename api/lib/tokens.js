import crypto from "node:crypto";
import db from "../db.js";

export function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

export async function createToken(
  userId,
  expiresAt = null
) {
  const token = generateToken();
  const tokenHash = hashToken(token);

  await db.execute({
    sql: `
      INSERT INTO tokens (
        user_id,
        token_hash,
        expires_at
      )
      VALUES (?, ?, ?)
    `,
    args: [
      userId,
      tokenHash,
      expiresAt
    ]
  });

  return token;
}

export async function getTokenInfo(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const tokenHash = hashToken(token);

  const result = await db.execute({
    sql: `
      SELECT
        t.id AS token_id,
        t.user_id,
        t.expires_at,
        t.revoked,
        u.status AS user_status,
        s.plan,
        s.source,
        s.status AS subscription_status,
        s.expires_at AS subscription_expires_at
      FROM tokens t
      JOIN users u
        ON u.id = t.user_id
      LEFT JOIN subscriptions s
        ON s.id = (
          SELECT s2.id
          FROM subscriptions s2
          WHERE s2.user_id = t.user_id
            AND s2.status = 'active'
            AND (
              s2.expires_at IS NULL
              OR s2.expires_at > CURRENT_TIMESTAMP
            )
          ORDER BY s2.id DESC
          LIMIT 1
        )
      WHERE t.token_hash = ?
      LIMIT 1
    `,
    args: [tokenHash]
  });

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  if (row.revoked) {
    return null;
  }

  if (row.user_status !== "active") {
    return null;
  }

  if (
    row.expires_at &&
    new Date(row.expires_at) <= new Date()
  ) {
    return null;
  }

  if (
    row.subscription_expires_at &&
    new Date(row.subscription_expires_at) <= new Date()
  ) {
    return null;
  }

  if (!row.plan) {
    return null;
  }

  return row;
}
