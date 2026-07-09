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
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    const activityId = toPositiveInt(req.query.id)
    if (!activityId) return res.status(400).json({ message: 'Invalid activity id' })

    const [[activity]] = await db.query(
      `SELECT
          a.id,
          a.title,
          DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
          a.fee_type,
          a.fee_amount,
          a.payments_enabled,
          a.school_year_id,
          sy.name AS school_year_name,
          a.created_by,
          u.full_name AS created_by_name
         FROM activities a
         JOIN school_years sy ON sy.id = a.school_year_id
         LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id = ?
          AND a.is_deleted = 0
        LIMIT 1`,
      [activityId]
    )

    if (!activity) return res.status(404).json({ message: 'Activity not found' })

    const [assignments] = await db.query(
      `SELECT
          aa.id AS assignment_id,
          aa.grade_id,
          g.name AS grade_name,
          aa.section_id,
          s.name AS section_name,
          aa.school_year_id,
          COALESCE(enr.enrolled_students, 0) AS enrolled_students,
          COALESCE(att.attendance_records, 0) AS attendance_records,
          COALESCE(att.present_count, 0) AS present_count,
          COALESCE(att.absent_count, 0) AS absent_count,
          COALESCE(pay.payment_records, 0) AS payment_records,
          COALESCE(pay.paid_count, 0) AS paid_count,
          COALESCE(pay.unpaid_count, 0) AS unpaid_count,
          COALESCE(pay.paid_amount_total, 0) AS paid_amount_total,
          COALESCE(contrib.contribution_records, 0) AS contribution_records,
          COALESCE(contrib.contribution_students, 0) AS contribution_students,
          COALESCE(contrib.contribution_hours_total, 0) AS contribution_hours_total,
          COALESCE(contrib.contribution_value_total, 0) AS contribution_value_total
         FROM activity_assignments aa
         JOIN grades g ON g.id = aa.grade_id
         JOIN sections s ON s.id = aa.section_id
         LEFT JOIN (
           SELECT school_year_id, grade_id, section_id, COUNT(DISTINCT student_id) AS enrolled_students
             FROM student_enrollments
            WHERE status = 'active'
            GROUP BY school_year_id, grade_id, section_id
         ) enr
           ON enr.school_year_id = aa.school_year_id
          AND enr.grade_id = aa.grade_id
          AND enr.section_id = aa.section_id
         LEFT JOIN (
           SELECT
             activity_assignment_id,
             COUNT(*) AS attendance_records,
             SUM(status = 'present') AS present_count,
             SUM(status = 'absent') AS absent_count
             FROM attendance
            GROUP BY activity_assignment_id
         ) att ON att.activity_assignment_id = aa.id
         LEFT JOIN (
           SELECT
             activity_assignment_id,
             COUNT(*) AS payment_records,
             SUM(paid = 1) AS paid_count,
             SUM(paid = 0) AS unpaid_count,
             COALESCE(SUM(CASE WHEN paid = 1 THEN amount ELSE 0 END), 0) AS paid_amount_total
             FROM payments
            GROUP BY activity_assignment_id
         ) pay ON pay.activity_assignment_id = aa.id
         LEFT JOIN (
           SELECT
             activity_assignment_id,
             COUNT(*) AS contribution_records,
             COUNT(DISTINCT student_id) AS contribution_students,
             COALESCE(SUM(hours_worked), 0) AS contribution_hours_total,
             COALESCE(SUM(estimated_value), 0) AS contribution_value_total
             FROM contributions
            GROUP BY activity_assignment_id
         ) contrib ON contrib.activity_assignment_id = aa.id
        WHERE aa.activity_id = ?
        ORDER BY g.id, s.name`,
      [activityId]
    )

    const totals = assignments.reduce(
      (acc, row) => {
        acc.assignments += 1
        acc.enrolled_students += Number(row.enrolled_students || 0)
        acc.attendance_records += Number(row.attendance_records || 0)
        acc.payment_records += Number(row.payment_records || 0)
        acc.contribution_records += Number(row.contribution_records || 0)
        acc.locking_records += Number(row.attendance_records || 0) + Number(row.payment_records || 0) + Number(row.contribution_records || 0)
        return acc
      },
      { assignments: 0, enrolled_students: 0, attendance_records: 0, payment_records: 0, contribution_records: 0, locking_records: 0 }
    )

    return res.status(200).json({ activity, assignments, totals })
  } catch (err) {
    console.error('GET /api/activities/:id/scope error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
