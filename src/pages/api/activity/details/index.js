// pages/api/activity/details/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { resolveSchoolYearId } from '../../lib/schoolYear'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const syId = await resolveSchoolYearId(req)
    const { activity_id, section_id, page = 1, page_size = 50, search = '' } = req.query
    const activityId = Number(activity_id)
    const sectionId = Number(section_id)

    if (!Number.isInteger(activityId) || activityId <= 0 || !Number.isInteger(sectionId) || sectionId <= 0) {
      return res.status(400).json({ message: 'activity_id and section_id are required' })
    }

    const [[assignment]] = await db.query(
      `SELECT
          aa.id,
          aa.grade_id,
          aa.section_id,
          a.school_year_id,
          a.payments_enabled,
          a.fee_type,
          a.fee_amount
         FROM activity_assignments aa
         JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
        WHERE aa.activity_id = ?
          AND aa.section_id = ?
          AND a.school_year_id = ?
        LIMIT 1`,
      [activityId, sectionId, syId]
    )
    if (!assignment) return res.status(200).json({ total: 0, students: [] })

    if (session.user.role === 'teacher') {
      const [[ok]] = await db.query(
        `SELECT 1
           FROM teacher_sections
          WHERE user_id = ?
            AND section_id = ?
            AND school_year_id = ?
            AND is_active = 1
          LIMIT 1`,
        [session.user.id, assignment.section_id, assignment.school_year_id]
      )
      if (!ok) return res.status(403).json({ message: 'Forbidden' })
    }

    const searchClause = search ? `AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)` : ''
    const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []

    const [countRows] = await db.query(
      `SELECT COUNT(DISTINCT st.id) AS total
         FROM student_enrollments en
         JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
        WHERE en.section_id = ?
          AND en.grade_id = ?
          AND en.school_year_id = ?
          AND en.status = 'active'
          ${searchClause}`,
      [assignment.section_id, assignment.grade_id, assignment.school_year_id, ...searchParams]
    )

    const limit = Math.max(1, Math.min(500, Number(page_size) || 50))
    const offset = (Math.max(1, Number(page) || 1) - 1) * limit

    const [rows] = await db.query(
      `SELECT
          st.id AS student_id,
          st.first_name,
          st.last_name,
          st.lrn,
          att.status AS attendance_status,
          att.parent_present,
          att.marked_by AS attendance_marked_by,
          att.marked_at AS attendance_marked_at,
          pay.paid AS payment_paid,
          pay.amount AS payment_amount,
          DATE_FORMAT(pay.payment_date, '%Y-%m-%d') AS payment_date,
          GROUP_CONCAT(DISTINCT CONCAT(pa.first_name, ' ', pa.last_name) SEPARATOR '; ') AS parents
         FROM student_enrollments en
         JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
         LEFT JOIN attendance att ON att.student_id = st.id AND att.activity_assignment_id = ?
         LEFT JOIN payments pay ON pay.student_id = st.id AND pay.activity_assignment_id = ?
         LEFT JOIN student_parents sp ON sp.student_id = st.id
         LEFT JOIN parents pa ON pa.id = sp.parent_id AND pa.is_deleted = 0
        WHERE en.section_id = ?
          AND en.grade_id = ?
          AND en.school_year_id = ?
          AND en.status = 'active'
          ${searchClause}
        GROUP BY st.id, st.first_name, st.last_name, st.lrn, att.status, att.parent_present, att.marked_by, att.marked_at, pay.paid, pay.amount, pay.payment_date
        ORDER BY st.last_name, st.first_name
        LIMIT ? OFFSET ?`,
      [assignment.id, assignment.id, assignment.section_id, assignment.grade_id, assignment.school_year_id, ...searchParams, limit, offset]
    )

    return res.status(200).json({
      total: Number(countRows[0]?.total || 0),
      page: Number(page),
      page_size: limit,
      assignment_id: assignment.id,
      payments_enabled: assignment.payments_enabled,
      fee_type: assignment.fee_type,
      fee_amount: assignment.fee_amount,
      students: rows
    })
  } catch (err) {
    console.error('Activity details error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
