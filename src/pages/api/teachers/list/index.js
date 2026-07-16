// pages/api/teachers/list/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { resolveSchoolYearId } from '../../lib/schoolYear'

function normalizeJsonArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(v => v && v.id != null)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)

      return Array.isArray(parsed) ? parsed.filter(v => v && v.id != null) : []
    } catch {
      return []
    }
  }

  return []
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    const syId = await resolveSchoolYearId(req)

    const [rows] = await db.query(
      `SELECT
          u.id,
          u.username,
          u.full_name,
          u.email,
          COALESCE(
            JSON_ARRAYAGG(
              CASE
                WHEN ts.id IS NULL THEN NULL
                ELSE JSON_OBJECT(
                  'assignment_id', ts.id,
                  'id', s.id,
                  'name', s.name,
                  'section_name', s.name,
                  'grade_id', s.grade_id,
                  'grade_name', g.name,
                  'assigned_at', DATE_FORMAT(ts.assigned_at, '%Y-%m-%d %H:%i:%s')
                )
              END
            ),
            JSON_ARRAY()
          ) AS assigned_sections
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.name = 'teacher'
         LEFT JOIN teacher_sections ts
           ON ts.user_id = u.id
          AND ts.school_year_id = ?
          AND ts.is_active = 1
         LEFT JOIN sections s ON s.id = ts.section_id AND s.is_deleted = 0
         LEFT JOIN grades g ON g.id = s.grade_id
        WHERE u.is_deleted = 0
        GROUP BY u.id, u.username, u.full_name, u.email
        ORDER BY u.full_name, u.username`,
      [syId]
    )

    const teachers = rows.map(row => ({
      id: row.id,
      username: row.username,
      full_name: row.full_name,
      email: row.email,
      assigned_sections: normalizeJsonArray(row.assigned_sections)
    }))

    return res.status(200).json(teachers)
  } catch (err) {
    console.error('GET /api/teachers/list error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
