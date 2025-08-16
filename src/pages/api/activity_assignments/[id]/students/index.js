// pages/api/activity_assignments/[id]/students.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../auth/[...nextauth]' // adjust path if needed
import db from '../../../db' // adjust db path

/**
 * GET /api/activity_assignments/:id/students
 * Query: page (1-based), page_size
 * Response: { total, page, page_size, students: [...] }
 *
 * Permission:
 *  - admin: any
 *  - teacher: only for their assigned section
 */
export default async function handler(req, res) {
  const { id } = req.query
  const assignmentId = Number(id)
  if (!assignmentId) return res.status(400).json({ message: 'Invalid assignment id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const page = Math.max(1, Number(req.query.page || 1))
    const page_size = Math.max(1, Math.min(1000, Number(req.query.page_size || 50)))
    const offset = (page - 1) * page_size

    // verify assignment and section/grade
    const [assRows] = await db.query(
      'SELECT aa.id, aa.activity_id, aa.grade_id, aa.section_id FROM activity_assignments aa WHERE aa.id = ? LIMIT 1',
      [assignmentId]
    )
    if (!assRows.length) return res.status(404).json({ message: 'Assignment not found' })
    const assignment = assRows[0]

    // teacher permission
    if (session.user.role === 'teacher') {
      const [ok] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
        session.user.id,
        assignment.section_id
      ])
      if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
    }

    // count total students in that grade/section (non-deleted)
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS total FROM students st WHERE st.is_deleted = 0 AND st.grade_id = ? AND st.section_id = ?',
      [assignment.grade_id, assignment.section_id]
    )
    const total = countRows[0]?.total ?? 0

    // fetch page with left joins for attendance & payments
    const sql = `
      SELECT st.id, st.lrn, st.first_name, st.last_name, st.grade_id, st.section_id,
        at.id AS attendance_id, at.status AS attendance_status, at.parent_present AS parent_present,
        at.marked_by AS attendance_marked_by, at.marked_at AS attendance_marked_at,
        pmt.id AS payment_id, pmt.paid AS payment_paid, DATE_FORMAT(pmt.payment_date, '%Y-%m-%d') AS payment_date,
        pmt.marked_by AS payment_marked_by
      FROM students st
      LEFT JOIN attendance at ON at.activity_assignment_id = ? AND at.student_id = st.id
      LEFT JOIN payments pmt ON pmt.activity_assignment_id = ? AND pmt.student_id = st.id
      WHERE st.is_deleted = 0 AND st.grade_id = ? AND st.section_id = ?
      ORDER BY st.last_name, st.first_name
      LIMIT ? OFFSET ?
    `
    const params = [assignmentId, assignmentId, assignment.grade_id, assignment.section_id, page_size, offset]
    const [rows] = await db.query(sql, params)

    const students = rows.map(r => ({
      id: r.id,
      lrn: r.lrn,
      first_name: r.first_name,
      last_name: r.last_name,
      grade_id: r.grade_id,
      section_id: r.section_id,
      attendance: r.attendance_id
        ? {
            id: r.attendance_id,
            status: r.attendance_status,
            parent_present: !!r.parent_present,
            marked_by: r.attendance_marked_by,
            marked_at: r.attendance_marked_at
          }
        : null,
      payment: r.payment_id
        ? {
            id: r.payment_id,
            paid: !!r.payment_paid,
            payment_date: r.payment_date,
            marked_by: r.payment_marked_by
          }
        : null
    }))

    return res.status(200).json({ total, page, page_size, students })
  } catch (err) {
    console.error('GET /activity_assignments/:id/students error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
