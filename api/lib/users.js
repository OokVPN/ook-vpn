import db from "../db.js";

export async function getUserByTelegramId(telegramId) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
    `,
    args: [String(telegramId)]
  });

  return result.rows[0] ?? null;
}

export async function createUser(telegramId) {
  const existing = await getUserByTelegramId(telegramId);

  if (existing) {
    return existing;
  }

  await db.execute({
    sql: `
      INSERT INTO users (telegram_id)
      VALUES (?)
    `,
    args: [String(telegramId)]
  });

  return getUserByTelegramId(telegramId);
}
