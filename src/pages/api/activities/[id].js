// pages/api/activities/[id].js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db' // adjust path

/**
 * GET /api/activities/:id
 * PUT /api/activities/:id   (title/activity_date)
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
        'SELECT a.id, a.title, a.activity_date, a.created_by, u.full_name AS created_by_name FROM activities a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = ? AND a.is_deleted = 0 LIMIT 1',
        [activityId]
      )
      if (!rows.length) return res.status(404).json({ message: 'Activity not found' })

      return res.status(200).json(rows[0])
    }

    if (req.method === 'PUT') {
      const { title, activity_date } = req.body
      if (!title || !activity_date) return res.status(400).json({ message: 'title and activity_date are required' })

      // fetch current activity
      const [aRows] = await db.query('SELECT * FROM activities WHERE id = ? AND is_deleted = 0 LIMIT 1', [activityId])
      if (!aRows.length) return res.status(404).json({ message: 'Activity not found' })

      const activity = aRows[0]
      if (session.user.role !== 'admin' && activity.created_by !== session.user.id) {
        return res.status(403).json({ message: 'Forbidden' })
      }

      await db.query('UPDATE activities SET title = ?, activity_date = ?, updated_at = NOW() WHERE id = ?', [
        title,
        activity_date,
        activityId
      ])

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
