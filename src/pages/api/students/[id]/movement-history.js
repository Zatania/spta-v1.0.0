import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'

function toPositiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (!['admin', 'teacher'].includes(session.user.role)) return res.status(403).json({ message: 'Forbidden' })

    const studentId = toPositiveInt(req.query.id)
    if (!studentId) return res.status(400).json({ message: 'Invalid student id' })

    if (session.user.role === 'teacher') {
      const [[allowed]] = await db.query(
        `SELECT 1
           FROM student_enrollments en
           JOIN teacher_sections ts
             ON ts.section_id = en.section_id
            AND ts.school_year_id = en.school_year_id
            AND ts.is_active = 1
          WHERE en.student_id = ?
            AND ts.user_id = ?
          LIMIT 1`,
        [studentId, session.user.id]
      )
      if (!allowed) return res.status(403).json({ message: 'Forbidden' })
    }

    const [rows] = await db.query(
      `SELECT
          en.id AS enrollment_id,
          en.student_id,
          sy.id AS school_year_id,
          sy.name AS school_year_name,
          g.id AS grade_id,
          g.name AS grade_name,
          s.id AS section_id,
          s.name AS section_name,
          en.status,
          csy.name AS completion_school_year_name,
          cg.name AS completion_grade_name,
          cs.name AS completion_section_name,
          DATE_FORMAT(en.enrolled_at, '%Y-%m-%d %H:%i:%s') AS enrolled_at
         FROM student_enrollments en
         JOIN school_years sy ON sy.id = en.school_year_id
         JOIN grades g ON g.id = en.grade_id
         JOIN sections s ON s.id = en.section_id
         LEFT JOIN school_years csy ON csy.id = en.completion_school_year_id
         LEFT JOIN grades cg ON cg.id = en.completion_grade_id
         LEFT JOIN sections cs ON cs.id = en.completion_section_id
        WHERE en.student_id = ?
        ORDER BY sy.start_date ASC, en.enrolled_at ASC, en.id ASC`,
      [studentId]
    )

    return res.status(200).json({ rows })
  } catch (err) {
    console.error('GET /api/students/:id/movement-history error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
