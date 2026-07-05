// pages/api/activities/section.js
import db from '../../db'
import { getCurrentSchoolYearId } from '../../lib/schoolYear' // path is from /pages/api/activities/section.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { section_id, from_date, to_date, school_year_id } = req.query
    if (!section_id) {
      return res.status(400).json({ message: 'section_id is required' })
    }

    let syId = Number(school_year_id)
    if (!Number.isFinite(syId) || syId <= 0) {
      syId = await getCurrentSchoolYearId()
    }

    if (session.user.role === 'teacher') {
      const [ok] = await db.query(
        `SELECT 1
         FROM teacher_sections
         WHERE user_id = ?
           AND section_id = ?
           AND school_year_id = ?
         LIMIT 1`,
        [session.user.id, section_id, syId]
      )
      if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
    }

    // Build date filters against alias a.activity_date
    const dateWhere = []
    const params = []

    if (from_date) {
      dateWhere.push('a.activity_date >= ?')
      params.push(from_date)
    }
    if (to_date) {
      dateWhere.push('a.activity_date <= ?')
      params.push(to_date)
    }
    const dateSql = dateWhere.length ? `AND ${dateWhere.join(' AND ')}` : ''

    // Activities for a specific section, counting attendance & payment over
    // students enrolled in that section for the current school year.
    const sql = `
      SELECT
        a.id,
        a.title,
        DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
        a.created_at,

        -- Attendance
        SUM(CASE WHEN att.status = 'present' THEN 1 ELSE 0 END) AS present_count,
        SUM(CASE WHEN att.status = 'absent'  THEN 1 ELSE 0 END) AS absent_count,
        SUM(CASE WHEN att.parent_present = 1 THEN 1 ELSE 0 END) AS parent_present_count,

        -- Payments
        SUM(CASE WHEN p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN COALESCE(p.paid, 0) = 0 THEN 1 ELSE 0 END) AS unpaid_count,

        -- Total enrolled students for this section (current SY)
        COUNT(DISTINCT st.id) AS total_students
      FROM activities a
      INNER JOIN activity_assignments aa
        ON aa.activity_id = a.id
      INNER JOIN sections sec
        ON sec.id = aa.section_id
      LEFT JOIN student_enrollments en
        ON en.section_id = sec.id
       AND en.school_year_id = ?
       AND en.status = 'active'
      LEFT JOIN students st
        ON st.id = en.student_id
       AND st.is_deleted = 0
      LEFT JOIN attendance att
        ON att.activity_assignment_id = aa.id
       AND att.student_id = st.id
      LEFT JOIN payments p
        ON p.activity_assignment_id = aa.id
       AND p.student_id = st.id
      WHERE a.is_deleted = 0
        AND a.school_year_id = ?
        AND aa.section_id = ?
        ${dateSql}
      GROUP BY a.id, a.title, a.activity_date, a.created_at
      ORDER BY a.activity_date DESC, a.created_at DESC
    `

    const queryParams = [syId, syId, section_id, ...params]
    const [activities] = await db.query(sql, queryParams)

    const formatted = activities.map(a => ({
      id: a.id,
      title: a.title,
      activity_date: a.activity_date,
      present_count: Number(a.present_count || 0),
      absent_count: Number(a.absent_count || 0),
      parent_present_count: Number(a.parent_present_count || 0),
      paid_count: Number(a.paid_count || 0),
      unpaid_count: Number(a.unpaid_count || 0),
      total_students: Number(a.total_students || 0)
    }))

    return res.status(200).json({ activities: formatted })
  } catch (err) {
    console.error('GET /api/activities/section error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
