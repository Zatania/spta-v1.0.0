import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { resolveSchoolYearId } from '../../lib/schoolYear'

function parseParentIds(raw) {
  return String(raw || '')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => Number.isInteger(v) && v > 0)
}

function number(value) {
  return Number(value || 0)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

    const teacherId = Number(session.user.id)
    const syId = await resolveSchoolYearId(req)
    const parentIds = parseParentIds(req.query.parent_ids)
    const parentJoin = parentIds.length
      ? `JOIN student_parents sp_filter
           ON sp_filter.student_id = st.id
          AND sp_filter.parent_id IN (${parentIds.map(() => '?').join(',')})`
      : ''

    const [rows] = await db.query(
      `SELECT
          a.id,
          a.title,
          DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
          a.fee_type,
          a.fee_amount,
          COUNT(DISTINCT st.id) AS expected_students,
          SUM(CASE WHEN att.status = 'present' THEN 1 ELSE 0 END) AS present_count,
          SUM(CASE WHEN att.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
          SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
          SUM(CASE
                WHEN a.fee_type IN ('fee','mixed')
                 AND COALESCE(p.paid, 0) = 0
                 AND c_any.student_id IS NULL
                THEN 1 ELSE 0
              END) AS unpaid_count,
          SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN COALESCE(p.amount,0) ELSE 0 END) AS paid_amount_total,
          COUNT(DISTINCT c_any.student_id) AS contrib_students,
          COALESCE(SUM(c_sum.hours_total),0) AS contrib_hours_total,
          COALESCE(SUM(c_sum.value_total),0) AS contrib_estimated_total
         FROM teacher_sections ts
         JOIN activity_assignments aa
           ON aa.section_id = ts.section_id
          AND aa.school_year_id = ts.school_year_id
         JOIN activities a
           ON a.id = aa.activity_id
          AND a.school_year_id = ts.school_year_id
          AND a.is_deleted = 0
         JOIN student_enrollments en
           ON en.school_year_id = ts.school_year_id
          AND en.grade_id = aa.grade_id
          AND en.section_id = aa.section_id
          AND en.status = 'active'
         JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
         ${parentJoin}
         LEFT JOIN attendance att
           ON att.activity_assignment_id = aa.id
          AND att.student_id = st.id
         LEFT JOIN payments p
           ON p.activity_assignment_id = aa.id
          AND p.student_id = st.id
         LEFT JOIN (
           SELECT activity_assignment_id, student_id
             FROM contributions
            GROUP BY activity_assignment_id, student_id
         ) c_any
           ON c_any.activity_assignment_id = aa.id
          AND c_any.student_id = st.id
         LEFT JOIN (
           SELECT
             activity_assignment_id,
             student_id,
             COALESCE(SUM(hours_worked),0) AS hours_total,
             COALESCE(SUM(estimated_value),0) AS value_total
             FROM contributions
            GROUP BY activity_assignment_id, student_id
         ) c_sum
           ON c_sum.activity_assignment_id = aa.id
          AND c_sum.student_id = st.id
        WHERE ts.user_id = ?
          AND ts.school_year_id = ?
          AND ts.is_active = 1
        GROUP BY a.id, a.title, a.activity_date, a.fee_type, a.fee_amount
        ORDER BY a.activity_date DESC, a.title ASC`,
      [...parentIds, teacherId, syId]
    )

    return res.status(200).json({
      school_year_id: syId,
      activities: rows.map(r => ({
        id: r.id,
        title: r.title,
        activity_date: r.activity_date,
        fee_type: r.fee_type,
        fee_amount: r.fee_amount == null ? null : Number(r.fee_amount),
        expected_students: number(r.expected_students),
        present_count: number(r.present_count),
        absent_count: number(r.absent_count),
        paid_count: number(r.paid_count),
        unpaid_count: number(r.unpaid_count),
        paid_amount_total: number(r.paid_amount_total),
        contrib_students: number(r.contrib_students),
        contrib_hours_total: number(r.contrib_hours_total),
        contrib_estimated_total: number(r.contrib_estimated_total)
      }))
    })
  } catch (err) {
    console.error('GET /api/teacher/attendance-summary error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
