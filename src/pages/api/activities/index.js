import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]' // adjust path if needed
import db from '../db' // adjust path to your db helper

/**
 * GET /api/activities
 *   query: search, date_from, date_to, page, page_size
 *   - Admins see all activities
 *   - Teachers see activities they created OR activities assigned to their sections (via activity_assignments)
 *
 * POST /api/activities
 *   body: { title, activity_date, payments_enabled } - creates activity (created_by = session.user.id)
 *   role: admin or teacher allowed (teachers will appear as creator)
 */
export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      const { search = '', date_from = '', date_to = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(500, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['a.is_deleted = 0']
      const params = []

      if (search) {
        where.push('(a.title LIKE ?)')
        params.push(`%${search}%`)
      }
      if (date_from) {
        where.push('a.activity_date >= ?')
        params.push(date_from)
      }
      if (date_to) {
        where.push('a.activity_date <= ?')
        params.push(date_to)
      }

      // teachers: restrict to activities that affect their sections OR created_by them
      if (session.user.role === 'teacher') {
        where.push(`(
          (a.created_by = ? AND a.created_by IN (SELECT id FROM users WHERE is_deleted = 0))
          OR a.id IN (
            SELECT aa.activity_id
            FROM activity_assignments aa
            WHERE aa.section_id IN (
              SELECT section_id FROM teacher_sections WHERE user_id = ?
            )
          )
        )`)
        params.push(session.user.id, session.user.id)
      }

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      const countSql = `SELECT COUNT(*) AS total FROM activities a ${whereSql}`
      const [countRows] = await db.query(countSql, params)
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT a.id,
               a.title,
               DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
               a.created_by,
               COALESCE(a.payments_enabled, 1) AS payments_enabled,
               u.full_name AS created_by_name
        FROM activities a
        LEFT JOIN users u ON u.id = a.created_by
        ${whereSql}
        ORDER BY a.activity_date ASC
        LIMIT ? OFFSET ?
      `
      const finalParams = [...params, limit, offset]
      const [rows] = await db.query(sql, finalParams)

      // normalize payments_enabled to boolean-like 0/1
      const normalized = rows.map(r => ({ ...r, payments_enabled: !!Number(r.payments_enabled) }))

      return res.status(200).json({ total, page: Number(page), page_size: limit, activities: normalized })
    }

    if (req.method === 'POST') {
      const { title, activity_date, payments_enabled } = req.body
      if (!title || !activity_date) return res.status(400).json({ message: 'title and activity_date are required' })

      const paymentsVal = typeof payments_enabled === 'undefined' ? 1 : payments_enabled ? 1 : 0

      const [ins] = await db.query(
        'INSERT INTO activities (title, activity_date, created_by, payments_enabled, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NOW(), NOW())',
        [title, activity_date, session.user.id, paymentsVal]
      )
      const activityId = ins.insertId

      const [activityRows] = await db.query(
        'SELECT id, title, DATE_FORMAT(activity_date, "%Y-%m-%d") AS activity_date, created_by, COALESCE(payments_enabled,1) AS payments_enabled FROM activities WHERE id = ? LIMIT 1',
        [activityId]
      )

      if (activityRows[0]) {
        activityRows[0].payments_enabled = !!Number(activityRows[0].payments_enabled)
      }

      return res.status(201).json({ activity: activityRows[0] })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Activities index error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
