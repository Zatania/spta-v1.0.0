import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { resolveSchoolYearId } from '../../lib/schoolYear'

function toPositiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    const syId = await resolveSchoolYearId(req)
    const teacherId = toPositiveInt(req.query.teacher_id)
    const sectionId = toPositiveInt(req.query.section_id)

    const where = ['ts.school_year_id = ?']
    const params = [syId]

    if (teacherId) {
      where.push('ts.user_id = ?')
      params.push(teacherId)
    }

    if (sectionId) {
      where.push('ts.section_id = ?')
      params.push(sectionId)
    }

    const [rows] = await db.query(
      `SELECT
          ts.id,
          ts.user_id AS teacher_id,
          COALESCE(u.full_name, u.username) AS teacher_name,
          u.username,
          ts.section_id,
          s.name AS section_name,
          g.id AS grade_id,
          g.name AS grade_name,
          ts.school_year_id,
          sy.name AS school_year_name,
          ts.is_active,
          DATE_FORMAT(ts.assigned_at, '%Y-%m-%d %H:%i:%s') AS assigned_at,
          DATE_FORMAT(ts.unassigned_at, '%Y-%m-%d %H:%i:%s') AS unassigned_at
         FROM teacher_sections ts
         JOIN users u ON u.id = ts.user_id
         JOIN sections s ON s.id = ts.section_id
         JOIN grades g ON g.id = s.grade_id
         JOIN school_years sy ON sy.id = ts.school_year_id
        WHERE ${where.join(' AND ')}
        ORDER BY g.id, s.name, ts.is_active DESC, ts.assigned_at DESC`,
      params
    )

    return res.status(200).json({ rows, school_year_id: syId })
  } catch (err) {
    console.error('GET /api/teacher-section-assignments/history error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
