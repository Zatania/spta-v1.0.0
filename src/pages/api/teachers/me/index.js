// pages/api/teachers/me.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { getCurrentSchoolYearId } from '../../lib/schoolYear'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const userId = session.user.id
    const [userRows] = await db.query('SELECT id, username, full_name, email FROM users WHERE id = ? LIMIT 1', [userId])
    if (!userRows.length) return res.status(404).json({ message: 'User not found' })
    const user = { ...userRows[0], role: session.user.role || null }

    let teacherData = null
    if (session.user.role === 'teacher') {
      const syId = await getCurrentSchoolYearId()

      const [rows] = await db.query(
        `SELECT s.id, s.name AS section_name, s.grade_id, g.name AS grade_name
         FROM teacher_sections ts
         JOIN sections s ON s.id = ts.section_id AND s.is_deleted = 0
         LEFT JOIN grades g ON g.id = s.grade_id
         WHERE ts.user_id = ?
           AND (ts.school_year_id = ? OR ts.school_year_id IS NULL)
         ORDER BY g.id, s.name`,
        [userId, syId]
      )
      teacherData = {
        assigned_sections: rows.map(r => ({
          id: r.id,
          name: r.section_name,
          grade_id: r.grade_id,
          grade_name: r.grade_name
        }))
      }
    }

    return res.status(200).json({ user, teacher: teacherData })
  } catch (err) {
    console.error('GET /api/teachers/me error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
