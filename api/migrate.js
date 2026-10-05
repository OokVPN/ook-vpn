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
    const columns = await db.execute({
      sql: "PRAGMA table_info(subscriptions)",
      args: []
    });

    const hasSource =
      columns.rows.some(
        row => row.name === "source"
      );

    if (!hasSource) {
      await db.execute({
        sql: `
          ALTER TABLE subscriptions
          ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'
        `,
        args: []
      });
    }

    return res.status(200).json({
      ok: true,
      source_added: !hasSource
    });
  } catch (error) {
    console.error(
      "Migration error:",
      error
    );

    return res.status(500).json({
      error: "Migration failed"
    });
  }
}
