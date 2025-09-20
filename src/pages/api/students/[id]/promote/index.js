// pages/api/students/[id]/promote.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { getCurrentSchoolYearId, getNextSchoolYearId } from '../../../lib/schoolYear'

export default async function handler(req, res) {
  const studentId = Number(req.query.id)
  if (!studentId) return res.status(400).json({ message: 'Invalid student id' })
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const {
      to_school_year_id, // optional; if absent we’ll try next SY
      to_grade_id,
      to_section_id,
      mark_previous_as = 'promoted' // or 'active' if you don’t want to mark; ‘promoted’ is typical
    } = req.body || {}

    if (!to_grade_id || !to_section_id) return res.status(400).json({ message: 'Missing target grade/section' })

    const currentSyId = await getCurrentSchoolYearId()
    const nextSyId = to_school_year_id || (await getNextSchoolYearId())
    if (!nextSyId)
      return res.status(400).json({ message: 'Target school year not provided and could not infer the next SY' })

    // Permissions:
    // - Admin can promote anywhere.
    // - Teacher can only promote students currently in their section AND only into a section they own in the target SY (or teacher_sections.school_year_id IS NULL).
    if (session.user.role === 'teacher') {
      const [okCurrent] = await db.query(
        `SELECT 1
         FROM student_enrollments en
         JOIN teacher_sections ts
           ON ts.section_id = en.section_id
          AND (ts.school_year_id = ? OR ts.school_year_id IS NULL)
         WHERE en.student_id = ? AND en.school_year_id = ? AND ts.user_id = ?
         LIMIT 1`,
        [currentSyId, studentId, currentSyId, session.user.id]
      )
      if (!okCurrent.length) return res.status(403).json({ message: 'Forbidden (current section not owned)' })

      const [okTarget] = await db.query(
        `SELECT 1 FROM teacher_sections
         WHERE user_id = ? AND section_id = ? AND (school_year_id = ? OR school_year_id IS NULL)
         LIMIT 1`,
        [session.user.id, to_section_id, nextSyId]
      )
      if (!okTarget.length) return res.status(403).json({ message: 'Forbidden (target section not owned)' })
    }

    // Validate target section belongs to target grade
    const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
      to_section_id
    ])
    if (!secRows.length) return res.status(400).json({ message: 'Target section not found' })
    if (String(secRows[0].grade_id) !== String(to_grade_id))
      return res.status(400).json({ message: 'Target section does not belong to the target grade' })

    let conn
    try {
      conn = await db.getConnection()
      await conn.beginTransaction()

      // Mark current SY enrollment (optional)
      if (mark_previous_as) {
        await conn.query('UPDATE student_enrollments SET status = ? WHERE student_id = ? AND school_year_id = ?', [
          mark_previous_as,
          studentId,
          currentSyId
        ])
      }

      // Insert new SY enrollment (upsert-safe with your UX key)
      await conn.query(
        `INSERT INTO student_enrollments (student_id, school_year_id, grade_id, section_id, status, enrolled_at)
         VALUES (?, ?, ?, ?, 'active', NOW())
         ON DUPLICATE KEY UPDATE grade_id = VALUES(grade_id), section_id = VALUES(section_id), status = 'active'`,
        [studentId, nextSyId, to_grade_id, to_section_id]
      )

      await conn.commit()
      try {
        conn.release()
      } catch {}

      return res.status(200).json({ message: 'Student promoted', school_year_id: nextSyId })
    } catch (err) {
      try {
        if (conn) await conn.rollback()
      } catch {}
      try {
        if (conn) conn.release()
      } catch {}
      console.error('POST /students/:id/promote error:', err)

      return res.status(500).json({ message: 'Internal server error' })
    }
  } catch (err) {
    console.error('promote handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
