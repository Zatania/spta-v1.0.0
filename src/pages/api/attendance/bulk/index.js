// pages/api/attendance/bulk.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db' // adjust path
import { getCurrentSchoolYearId } from '../../lib/schoolYear'

/**
 * POST /api/attendance/bulk
 * Body:
 * {
 *   activity_assignment_id: number,
 *   records: [
 *     { student_id, status: 'present'|'absent', parent_present: 0|1 }
 *   ]
 * }
 *
 * Upserts into attendance (unique constraint on activity_assignment_id + student_id)
 * Only teachers assigned to assignment.section or admins can update.
 */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { activity_assignment_id, records } = req.body
    if (!activity_assignment_id || !Array.isArray(records)) return res.status(400).json({ message: 'Invalid payload' })

    // get assignment
    const [aa] = await db.query(
      `SELECT aa.id, aa.grade_id, aa.section_id, aa.activity_id
        FROM activity_assignments aa
        JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
        WHERE aa.id = ?
        LIMIT 1`,
      [activity_assignment_id]
    )
    if (!aa.length) return res.status(404).json({ message: 'Assignment not found' })
    const assignment = aa[0]

    const currentSyId = await getCurrentSchoolYearId()

    // permission
    if (session.user.role === 'teacher') {
      const [ok] = await db.query(
        `SELECT 1
          FROM teacher_sections
          WHERE user_id = ?
            AND section_id = ?
            AND (school_year_id = ? OR school_year_id IS NULL)
          LIMIT 1`,
        [session.user.id, assignment.section_id, currentSyId]
      )
      if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
    }

    const submittedStudentIds = [...new Set(records.map(r => Number(r.student_id)).filter(Number.isFinite))]

    if (!submittedStudentIds.length) {
      return res.status(400).json({ message: 'No valid student IDs submitted' })
    }

    const placeholders = submittedStudentIds.map(() => '?').join(',')

    const [validRows] = await db.query(
      `SELECT st.id
        FROM students st
        JOIN student_enrollments en ON en.student_id = st.id
        WHERE st.id IN (${placeholders})
          AND st.is_deleted = 0
          AND en.school_year_id = ?
          AND en.status = 'active'
          AND en.grade_id = ?
          AND en.section_id = ?`,
      [...submittedStudentIds, currentSyId, assignment.grade_id, assignment.section_id]
    )

    const validIds = new Set(validRows.map(r => Number(r.id)))
    const invalidIds = submittedStudentIds.filter(id => !validIds.has(id))
    if (invalidIds.length) {
      return res.status(400).json({
        message: 'Some students do not belong to this assignment section/current school year',
        invalid_student_ids: invalidIds
      })
    }

    // Upsert rows using single multi-row query for efficiency
    // Prepare bulk insert values
    const values = []
    const params = []
    const now = new Date()
    for (const r of records) {
      const sid = r.student_id
      const status = r.status === 'present' ? 'present' : 'absent'
      const parent_present = r.parent_present ? 1 : 0
      values.push('(?, ?, ?, ?, ?, ?)')
      params.push(activity_assignment_id, sid, parent_present, status, session.user.id, now)
    }

    if (!values.length) return res.status(400).json({ message: 'No records to save' })

    // MySQL: ON DUPLICATE KEY UPDATE to update existing rows
    const sql = `
      INSERT INTO attendance (activity_assignment_id, student_id, parent_present, status, marked_by, marked_at)
      VALUES ${values.join(', ')}
      ON DUPLICATE KEY UPDATE
        parent_present = VALUES(parent_present),
        status = VALUES(status),
        marked_by = VALUES(marked_by),
        marked_at = VALUES(marked_at)
    `
    await db.query(sql, params)

    return res.status(200).json({ message: 'Attendance saved' })
  } catch (err) {
    console.error('attendance bulk error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
