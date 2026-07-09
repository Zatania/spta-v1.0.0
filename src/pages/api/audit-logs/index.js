import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

function toInt(value, fallback) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function validDate(value) {
  if (!value) return false
  const d = new Date(value)
  return !Number.isNaN(d.getTime())
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    const page = toInt(req.query.page, 1)
    const pageSize = Math.min(100, toInt(req.query.page_size, 25))
    const offset = (page - 1) * pageSize

    const where = []
    const params = []

    if (req.query.action) {
      where.push('al.action LIKE ?')
      params.push(`%${String(req.query.action).trim()}%`)
    }

    if (req.query.entity_type) {
      where.push('al.entity_type = ?')
      params.push(String(req.query.entity_type).trim())
    }

    if (req.query.entity_id) {
      const entityId = Number(req.query.entity_id)
      if (Number.isInteger(entityId) && entityId > 0) {
        where.push('al.entity_id = ?')
        params.push(entityId)
      }
    }

    if (req.query.actor_user_id) {
      const actorId = Number(req.query.actor_user_id)
      if (Number.isInteger(actorId) && actorId > 0) {
        where.push('al.actor_user_id = ?')
        params.push(actorId)
      }
    }

    if (validDate(req.query.from_date)) {
      where.push('DATE(al.created_at) >= ?')
      params.push(req.query.from_date)
    }

    if (validDate(req.query.to_date)) {
      where.push('DATE(al.created_at) <= ?')
      params.push(req.query.to_date)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
        ${whereSql}`,
      params
    )

    const [rows] = await db.query(
      `SELECT
          al.id,
          al.actor_user_id,
          COALESCE(u.full_name, u.username, 'System') AS actor_name,
          u.username AS actor_username,
          al.action,
          al.entity_type,
          al.entity_id,
          al.details,
          DATE_FORMAT(al.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
        ${whereSql}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )

    return res.status(200).json({
      rows: rows.map(row => ({
        ...row,
        details: typeof row.details === 'string' ? JSON.parse(row.details || '{}') : row.details
      })),
      total: Number(countRow?.total || 0),
      page,
      page_size: pageSize
    })
  } catch (err) {
    console.error('GET /api/audit-logs error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
