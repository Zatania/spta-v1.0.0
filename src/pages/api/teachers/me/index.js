// pages/api/teachers/me/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { resolveSchoolYearId } from '../../lib/schoolYear'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const userId = Number(session.user.id)
    const [userRows] = await db.query(
      `SELECT id, username, full_name, email
         FROM users
        WHERE id = ? AND is_deleted = 0
        LIMIT 1`,
      [userId]
    )
    if (!userRows.length) return res.status(404).json({ message: 'User not found' })

    const user = { ...userRows[0], role: session.user.role || null }
    let teacherData = null

    if (session.user.role === 'teacher') {
      const syId = await resolveSchoolYearId(req)

      const [rows] = await db.query(
        `SELECT
            ts.id AS assignment_id,
            s.id,
            s.name AS section_name,
            s.name AS name,
            s.grade_id,
            g.name AS grade_name,
            DATE_FORMAT(ts.assigned_at, '%Y-%m-%d %H:%i:%s') AS assigned_at
           FROM teacher_sections ts
           JOIN sections s ON s.id = ts.section_id AND s.is_deleted = 0
           JOIN grades g ON g.id = s.grade_id
          WHERE ts.user_id = ?
            AND ts.school_year_id = ?
            AND ts.is_active = 1
          ORDER BY g.id, s.name`,
        [userId, syId]
      )

      teacherData = {
        school_year_id: syId,
        assigned_sections: rows.map(r => ({
          assignment_id: r.assignment_id,
          id: r.id,
          name: r.name,
          section_name: r.section_name,
          grade_id: r.grade_id,
          grade_name: r.grade_name,
          assigned_at: r.assigned_at
        }))
      }
    }

    return res.status(200).json({ user, teacher: teacherData })
  } catch (err) {
    console.error('GET /api/teachers/me error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
