// pages/api/activity_assignments/[id]/students.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../auth/[...nextauth]'
import db from '../../../db'
import { getCurrentSchoolYearId } from '../../../lib/schoolYear'

export default async function handler(req, res) {
  const { id } = req.query
  const assignmentId = Number(id)
  if (!assignmentId) return res.status(400).json({ message: 'Invalid assignment id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const page = Math.max(1, Number(req.query.page || 1))
    const pageSize = Math.max(1, Math.min(1000, Number(req.query.page_size || 50)))
    const offset = (page - 1) * pageSize
    const syId = await getCurrentSchoolYearId()

    // assignment + activity flags (now includes fee_type/fee_amount)
    const [assRows] = await db.query(
      `SELECT aa.id, aa.activity_id, aa.grade_id, aa.section_id,
              a.payments_enabled, a.fee_type, a.fee_amount
         FROM activity_assignments aa
         JOIN activities a ON a.id = aa.activity_id
        WHERE aa.id = ?
        LIMIT 1`,
      [assignmentId]
    )
    if (!assRows.length) return res.status(404).json({ message: 'Assignment not found' })
    const assignment = assRows[0]

    // permission for teachers (current SY)
    if (session.user.role === 'teacher') {
      const [ok] = await db.query(
        `SELECT 1 FROM teacher_sections
          WHERE user_id = ? AND section_id = ? AND school_year_id = ?
          LIMIT 1`,
        [session.user.id, assignment.section_id, syId]
      )
      if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
    }

    // total students via enrollments
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM student_enrollments se
         JOIN students st ON st.id = se.student_id
        WHERE se.school_year_id = ?
          AND se.status = 'active'
          AND se.grade_id = ?
          AND se.section_id = ?
          AND st.is_deleted = 0`,
      [syId, assignment.grade_id, assignment.section_id]
    )
    const total = countRows[0]?.total ?? 0

    // page data + joins
    const sql = `
      SELECT
        st.id, st.lrn, st.first_name, st.last_name,
        se.grade_id, se.section_id,

        at.id         AS attendance_id,
        at.status     AS attendance_status,
        at.parent_present,
        at.marked_by  AS attendance_marked_by,
        at.marked_at  AS attendance_marked_at,

        pmt.id        AS payment_id,
        pmt.paid      AS payment_paid,
        pmt.amount    AS payment_amount,
        DATE_FORMAT(pmt.payment_date, '%Y-%m-%d') AS payment_date,
        pmt.marked_by AS payment_marked_by,

        COUNT(c.id)                         AS contrib_count,
        COALESCE(SUM(c.estimated_value),0)  AS contrib_estimated_total,
        COALESCE(SUM(c.hours_worked),0)     AS contrib_hours_total

      FROM student_enrollments se
      JOIN students st
        ON st.id = se.student_id
      LEFT JOIN attendance at
        ON at.activity_assignment_id = ? AND at.student_id = st.id
      LEFT JOIN payments pmt
        ON pmt.activity_assignment_id = ? AND pmt.student_id = st.id
      LEFT JOIN contributions c
        ON c.activity_assignment_id = ? AND c.student_id = st.id

      WHERE se.school_year_id = ?
        AND se.status = 'active'
        AND se.grade_id = ?
        AND se.section_id = ?
        AND st.is_deleted = 0

      GROUP BY
        st.id, st.lrn, st.first_name, st.last_name, se.grade_id, se.section_id,
        at.id, at.status, at.parent_present, at.marked_by, at.marked_at,
        pmt.id, pmt.paid, pmt.amount, pmt.payment_date, pmt.marked_by

      ORDER BY st.last_name, st.first_name
      LIMIT ? OFFSET ?
    `

    const params = [
      assignmentId,
      assignmentId,
      assignmentId,
      syId,
      assignment.grade_id,
      assignment.section_id,
      pageSize,
      offset
    ]
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
            amount: r.payment_amount == null ? null : Number(r.payment_amount),
            payment_date: r.payment_date,
            marked_by: r.payment_marked_by
          }
        : null,
      contributions_summary: {
        count: Number(r.contrib_count || 0),
        estimated_total: Number(r.contrib_estimated_total || 0),
        hours_total: Number(r.contrib_hours_total || 0)
      }
    }))

    // ⬅️ include fee_type & fee_amount so the UI shows contribution fields
    return res.status(200).json({
      total,
      page,
      page_size: pageSize,
      students,
      payments_enabled: assignment.payments_enabled,
      fee_type: assignment.fee_type,
      fee_amount: assignment.fee_amount
    })
  } catch (err) {
    console.error('GET /activity_assignments/:id/students error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
