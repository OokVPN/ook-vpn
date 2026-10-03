import db from "../db.js";

export async function getUserDevices(userId) {
  const result = await db.execute({
    sql: `
      SELECT
        id,
        hwid,
        name,
        status,
        created_at,
        last_seen
      FROM devices
      WHERE user_id = ?
      ORDER BY id ASC
    `,
    args: [userId]
  });

  return result.rows;
}

export async function getActiveDevices(userId) {
  const result = await db.execute({
    sql: `
      SELECT
        id,
        hwid,
        name,
        status,
        created_at,
        last_seen
      FROM devices
      WHERE user_id = ?
        AND status = 'active'
      ORDER BY id ASC
    `,
    args: [userId]
  });

  return result.rows;
}

export async function getDeviceCount(userId) {
  const result = await db.execute({
    sql: `
      SELECT COUNT(*) AS count
      FROM devices
      WHERE user_id = ?
        AND status = 'active'
    `,
    args: [userId]
  });

  return Number(result.rows[0]?.count ?? 0);
}

export async function getDevice(
  userId,
  deviceId
) {
  const result = await db.execute({
    sql: `
      SELECT
        id,
        hwid,
        name,
        status,
        created_at,
        last_seen
      FROM devices
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    args: [deviceId, userId]
  });

  return result.rows[0] ?? null;
}

export async function removeDevice(
  userId,
  deviceId
) {
  const result = await db.execute({
    sql: `
      UPDATE devices
      SET status = 'removed'
      WHERE id = ?
        AND user_id = ?
        AND status = 'active'
    `,
    args: [deviceId, userId]
  });

  return result.rowsAffected > 0;
}

export async function restoreDevice(
  userId,
  deviceId
) {
  const result = await db.execute({
    sql: `
      UPDATE devices
      SET status = 'active'
      WHERE id = ?
        AND user_id = ?
        AND status = 'removed'
    `,
    args: [deviceId, userId]
  });

  return result.rowsAffected > 0;
}
