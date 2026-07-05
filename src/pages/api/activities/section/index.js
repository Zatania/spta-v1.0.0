// pages/api/activities/section/index.js
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
    const sectionId = Number(req.query.section_id)
    const { from_date, to_date } = req.query

    if (!Number.isInteger(sectionId) || sectionId <= 0) {
      return res.status(400).json({ message: 'section_id is required' })
    }

    if (session.user.role === 'teacher') {
      const [[ok]] = await db.query(
        `SELECT 1
           FROM teacher_sections
          WHERE user_id = ?
            AND section_id = ?
            AND school_year_id = ?
            AND is_active = 1
          LIMIT 1`,
        [session.user.id, sectionId, syId]
      )
      if (!ok) return res.status(403).json({ message: 'Forbidden' })
    }

    const dateWhere = []
    const dateParams = []
    if (from_date) {
      dateWhere.push('a.activity_date >= ?')
      dateParams.push(from_date)
    }
    if (to_date) {
      dateWhere.push('a.activity_date <= ?')
      dateParams.push(to_date)
    }
    const dateSql = dateWhere.length ? `AND ${dateWhere.join(' AND ')}` : ''

    const [activities] = await db.query(
      `SELECT
          a.id,
          a.title,
          DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
          a.created_at,
          a.payments_enabled,
          a.fee_type,
          a.fee_amount,
          aa.id AS assignment_id,
          COUNT(DISTINCT st.id) AS total_students,
          COUNT(DISTINCT CASE WHEN att.status = 'present' THEN st.id END) AS present_count,
          COUNT(DISTINCT CASE WHEN att.status = 'absent' THEN st.id END) AS absent_count,
          COUNT(DISTINCT CASE WHEN att.parent_present = 1 THEN st.id END) AS parent_present_count,
          COUNT(DISTINCT CASE WHEN p.paid = 1 THEN st.id END) AS paid_count,
          COUNT(DISTINCT CASE
            WHEN a.payments_enabled = 1
             AND a.fee_type IN ('fee','mixed')
             AND COALESCE(p.paid, 0) = 0
             AND c.student_id IS NULL
            THEN st.id
          END) AS unpaid_count,
          COUNT(DISTINCT CASE WHEN c.student_id IS NOT NULL THEN st.id END) AS contribution_count
         FROM activities a
         JOIN activity_assignments aa ON aa.activity_id = a.id
         JOIN sections sec ON sec.id = aa.section_id AND sec.is_deleted = 0
         LEFT JOIN student_enrollments en
           ON en.section_id = aa.section_id
          AND en.grade_id = aa.grade_id
          AND en.school_year_id = a.school_year_id
          AND en.status = 'active'
         LEFT JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
         LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
         LEFT JOIN payments p ON p.activity_assignment_id = aa.id AND p.student_id = st.id
         LEFT JOIN (
           SELECT activity_assignment_id, student_id
             FROM contributions
            GROUP BY activity_assignment_id, student_id
         ) c ON c.activity_assignment_id = aa.id AND c.student_id = st.id
        WHERE a.is_deleted = 0
          AND a.school_year_id = ?
          AND aa.section_id = ?
          ${dateSql}
        GROUP BY a.id, a.title, a.activity_date, a.created_at, a.payments_enabled, a.fee_type, a.fee_amount, aa.id
        ORDER BY a.activity_date DESC, a.created_at DESC`,
      [syId, sectionId, ...dateParams]
    )

    return res.status(200).json({
      activities: activities.map(a => ({
        id: a.id,
        assignment_id: a.assignment_id,
        title: a.title,
        activity_date: a.activity_date,
        payments_enabled: !!Number(a.payments_enabled),
        fee_type: a.fee_type,
        fee_amount: a.fee_amount,
        present_count: Number(a.present_count || 0),
        absent_count: Number(a.absent_count || 0),
        parent_present_count: Number(a.parent_present_count || 0),
        paid_count: Number(a.paid_count || 0),
        unpaid_count: Number(a.unpaid_count || 0),
        contribution_count: Number(a.contribution_count || 0),
        total_students: Number(a.total_students || 0)
      }))
    })
  } catch (err) {
    console.error('GET /api/activities/section error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
