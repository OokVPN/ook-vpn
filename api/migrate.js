import db from "./db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const secret =
    process.env.MIGRATION_SECRET;

  if (
    !secret ||
    req.query.secret !== secret
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  try {
    const result = await db.execute({
      sql: "PRAGMA table_info(users)",
      args: []
    });

    const exists =
      result.rows.some(
        column =>
          column.name ===
          "subscription_token"
      );

    if (!exists) {
      await db.execute({
        sql: `
          ALTER TABLE users
          ADD COLUMN subscription_token TEXT
        `,
        args: []
      });
    }

    return res.status(200).json({
      ok: true,
      column: "subscription_token",
      created: !exists
    });
  } catch (error) {
    console.error(
      "Migration error:",
      error
    );

    return res.status(500).json({
      error: "Migration failed",
      message: error.message
    });
  }
}
