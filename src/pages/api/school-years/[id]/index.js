import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'

export default async function handler(req, res) {
  const id = Number(req.query.id)
  if (!id) return res.status(400).json({ message: 'Invalid school year id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    if (req.method === 'PUT') {
      const { name, start_date, end_date } = req.body || {}
      if (!name || !start_date || !end_date) {
        return res.status(400).json({ message: 'name, start_date and end_date are required' })
      }

      await db.query(
        `UPDATE school_years
         SET name = ?, start_date = ?, end_date = ?, updated_at = NOW()
         WHERE id = ?`,
        [name, start_date, end_date, id]
      )

      return res.status(200).json({ message: 'School year updated' })
    }

    if (req.method === 'DELETE') {
      const [[used]] = await db.query(
        `SELECT
          (SELECT COUNT(*) FROM student_enrollments WHERE school_year_id = ?) +
          (SELECT COUNT(*) FROM activities WHERE school_year_id = ?) +
          (SELECT COUNT(*) FROM teacher_sections WHERE school_year_id = ?) AS cnt`,
        [id, id, id]
      )

      if (Number(used.cnt) > 0) {
        return res.status(400).json({ message: 'Cannot delete a school year with existing records' })
      }

      await db.query('DELETE FROM school_years WHERE id = ? AND is_current = 0', [id])

      return res.status(200).json({ message: 'School year deleted' })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('/api/school-years/[id] error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
