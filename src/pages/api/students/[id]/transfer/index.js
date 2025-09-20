// pages/api/students/[id]/transfer.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { getCurrentSchoolYearId } from '../../../lib/schoolYear'

export default async function handler(req, res) {
  const studentId = Number(req.query.id)
  if (!studentId) return res.status(400).json({ message: 'Invalid student id' })
  if (req.method !== 'PUT') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { to_grade_id, to_section_id, school_year_id } = req.body || {}
    const syId = school_year_id || (await getCurrentSchoolYearId())

    if (!to_grade_id || !to_section_id) return res.status(400).json({ message: 'Missing target grade/section' })

    // Permissions
    if (session.user.role === 'teacher') {
      // must own current section row
      const [okCurrent] = await db.query(
        `SELECT 1
         FROM student_enrollments en
         JOIN teacher_sections ts
           ON ts.section_id = en.section_id
          AND (ts.school_year_id = ? OR ts.school_year_id IS NULL)
         WHERE en.student_id = ? AND en.school_year_id = ? AND ts.user_id = ?
         LIMIT 1`,
        [syId, studentId, syId, session.user.id]
      )
      if (!okCurrent.length) return res.status(403).json({ message: 'Forbidden (current section not owned)' })

      // must own target section too
      const [okTarget] = await db.query(
        `SELECT 1 FROM teacher_sections
         WHERE user_id = ? AND section_id = ? AND (school_year_id = ? OR school_year_id IS NULL)
         LIMIT 1`,
        [session.user.id, to_section_id, syId]
      )
      if (!okTarget.length) return res.status(403).json({ message: 'Forbidden (target section not owned)' })
    }

    // Validate grade/section relation
    const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
      to_section_id
    ])
    if (!secRows.length) return res.status(400).json({ message: 'Target section not found' })
    if (String(secRows[0].grade_id) !== String(to_grade_id))
      return res.status(400).json({ message: 'Target section does not belong to the target grade' })

    const [enOK] = await db.query(
      'SELECT id FROM student_enrollments WHERE student_id = ? AND school_year_id = ? LIMIT 1',
      [studentId, syId]
    )
    if (!enOK.length) return res.status(404).json({ message: 'No enrollment for this school year' })

    await db.query(
      'UPDATE student_enrollments SET grade_id = ?, section_id = ? WHERE student_id = ? AND school_year_id = ?',
      [to_grade_id, to_section_id, studentId, syId]
    )

    return res.status(200).json({ message: 'Student transferred' })
  } catch (err) {
    console.error('PUT /students/:id/transfer error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
