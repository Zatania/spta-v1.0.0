import db from '../../db'

export async function auditLog({ actorUserId = null, action, entityType, entityId = null, details = null }, conn = db) {
  try {
    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [actorUserId, action, entityType, entityId, details ? JSON.stringify(details) : null]
    )
  } catch (err) {
    console.error('auditLog failed:', err)
  }
}
