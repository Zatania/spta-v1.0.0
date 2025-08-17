import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db' // adjust path

/**
 * GET /api/activities/:id
 * PUT /api/activities/:id   (title/activity_date/payments_enabled) - allows partial update
 * DELETE /api/activities/:id  (soft delete)
 *
 * Admins can update/delete any; teachers can update/delete only if they created the activity
 */
export default async function handler(req, res) {
  const { id } = req.query
  const activityId = Number(id)
  if (!activityId) return res.status(400).json({ message: 'Invalid activity id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      const [rows] = await db.query(
        `SELECT a.id, a.title, DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
                a.created_by, COALESCE(a.payments_enabled, 1) AS payments_enabled,
                u.full_name AS created_by_name
         FROM activities a
         LEFT JOIN users u ON u.id = a.created_by
         WHERE a.id = ? AND a.is_deleted = 0
         LIMIT 1`,
        [activityId]
      )
      if (!rows.length) return res.status(404).json({ message: 'Activity not found' })

      // ensure payments_enabled is boolean-like
      const row = rows[0]
      row.payments_enabled = !!Number(row.payments_enabled)

      return res.status(200).json(row)
    }

    if (req.method === 'PUT') {
      // allow partial updates: title, activity_date, payments_enabled
      const { title, activity_date, payments_enabled } = req.body

      // fetch current activity
      const [aRows] = await db.query('SELECT * FROM activities WHERE id = ? AND is_deleted = 0 LIMIT 1', [activityId])
      if (!aRows.length) return res.status(404).json({ message: 'Activity not found' })

      const activity = aRows[0]
      if (session.user.role !== 'admin' && activity.created_by !== session.user.id) {
        return res.status(403).json({ message: 'Forbidden' })
      }

      const setParts = []
      const params = []

      if (typeof title !== 'undefined') {
        if (!title) return res.status(400).json({ message: 'title cannot be empty' })
        setParts.push('title = ?')
        params.push(title)
      }
      if (typeof activity_date !== 'undefined') {
        if (!activity_date) return res.status(400).json({ message: 'activity_date cannot be empty' })
        setParts.push('activity_date = ?')
        params.push(activity_date)
      }
      if (typeof payments_enabled !== 'undefined') {
        // accept boolean or numeric 0/1
        const val = payments_enabled ? 1 : 0
        setParts.push('payments_enabled = ?')
        params.push(val)
      }

      if (!setParts.length) {
        return res.status(400).json({ message: 'No fields to update' })
      }

      const sql = `UPDATE activities SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = ?`
      params.push(activityId)

      await db.query(sql, params)

      return res.status(200).json({ message: 'Activity updated' })
    }

    if (req.method === 'DELETE') {
      const [aRows] = await db.query('SELECT * FROM activities WHERE id = ? AND is_deleted = 0 LIMIT 1', [activityId])
      if (!aRows.length) return res.status(404).json({ message: 'Activity not found' })
      const activity = aRows[0]
      if (session.user.role !== 'admin' && activity.created_by !== session.user.id) {
        return res.status(403).json({ message: 'Forbidden' })
      }

      await db.query('UPDATE activities SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [activityId])

      return res.status(200).json({ message: 'Activity deleted (soft)' })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('activity [id] error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
