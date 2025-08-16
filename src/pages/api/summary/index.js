// pages/api/summary.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]' // adjust path if your NextAuth file is elsewhere
import db from '../db' // adjust path to your DB helper

/**
 * GET /api/summary?view=overview|byGrade|bySection|byActivity|paymentsByGrade|paymentsBySection
 * grade_id=&section_id=&activity_id=&from_date=&to_date=
 *
 * Only admins allowed.
 *
 * NOTE: db.query(...) is expected to be mysql2/promise style returning [rows, fields].
 */

const isValidDate = d => {
  if (!d) return false
  const n = new Date(d)

  return !Number.isNaN(n.getTime())
}

export default async function handler(req, res) {
  // only GET
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed. Use GET.' })
  }

  // require admin
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user || session.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden. Admins only.' })
    }
  } catch (err) {
    console.error('Session check error:', err)

    return res.status(500).json({ message: 'Server error during auth check' })
  }

  const {
    view = 'overview',
    grade_id = null,
    section_id = null,
    activity_id = null,
    from_date = null,
    to_date = null
  } = req.query

  // build date filter for activity date when needed
  const dateFilters = []
  const dateParams = []
  if (isValidDate(from_date)) {
    dateFilters.push('a.activity_date >= ?')
    dateParams.push(from_date)
  }
  if (isValidDate(to_date)) {
    dateFilters.push('a.activity_date <= ?')
    dateParams.push(to_date)
  }
  const dateWhere = dateFilters.length ? `AND ${dateFilters.join(' AND ')}` : ''

  try {
    // ---------- OVERVIEW ----------
    if (view === 'overview') {
      const [studentsRows] = await db.query(`SELECT COUNT(*) AS total_students FROM students WHERE is_deleted = 0`)

      const [[activitiesRow]] = await db.query(
        `SELECT COUNT(*) AS total_activities FROM activities WHERE is_deleted = 0 ${
          dateFilters.length ? 'AND activity_date BETWEEN ? AND ?' : ''
        }`,
        dateParams.length === 2 ? [dateParams[0], dateParams[1]] : []
      )

      // attendance totals (present/absent) across activities in date range
      const [attendanceRows] = await db.query(
        `
        SELECT
          SUM(att.status = 'present') AS total_present,
          SUM(att.status = 'absent')  AS total_absent,
          SUM(att.parent_present = 1) AS parent_present_count
        FROM attendance att
        JOIN activity_assignments aa ON aa.id = att.activity_assignment_id
        JOIN activities a ON a.id = aa.activity_id
        WHERE a.is_deleted = 0 ${dateWhere}
        `,
        dateParams
      )

      // payments totals
      const [paymentsRows] = await db.query(
        `
        SELECT
          SUM(p.paid = 1) AS total_paid,
          SUM(p.paid = 0) AS total_unpaid
        FROM payments p
        JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
        JOIN activities a ON a.id = aa.activity_id
        WHERE a.is_deleted = 0 ${dateWhere}
        `,
        dateParams
      )

      return res.status(200).json({
        total_students: studentsRows[0].total_students ?? 0,
        total_activities: activitiesRow.total_activities ?? 0,
        attendance: attendanceRows[0] ?? { total_present: 0, total_absent: 0, parent_present_count: 0 },
        payments: paymentsRows[0] ?? { total_paid: 0, total_unpaid: 0 }
      })
    }

    // ---------- BY GRADE (students per grade, sections) ----------
    if (view === 'byGrade') {
      // If grade_id provided, filter; else produce for all grades
      const gradeFilter = grade_id ? 'WHERE g.id = ?' : ''
      const gradeParams = grade_id ? [grade_id] : []

      // total students grouped by grade + section
      const [rows] = await db.query(
        `
        SELECT
          g.id AS grade_id,
          g.name AS grade_name,
          s.id AS section_id,
          s.name AS section_name,
          COUNT(st.id) AS total_students
        FROM grades g
        LEFT JOIN sections s ON s.grade_id = g.id
        LEFT JOIN students st ON st.section_id = s.id AND st.is_deleted = 0
        ${gradeFilter}
        GROUP BY g.id, s.id, s.name
        ORDER BY g.id, s.name
        `,
        gradeParams
      )

      // restructure into nested result per grade
      const gradeMap = {}
      for (const r of rows) {
        const gid = r.grade_id
        if (!gradeMap[gid]) {
          gradeMap[gid] = { grade_id: gid, grade_name: r.grade_name, sections: [] }
        }

        // section could be null (no sections); handle
        gradeMap[gid].sections.push({
          section_id: r.section_id,
          section_name: r.section_name,
          total_students: Number(r.total_students)
        })
      }

      return res.status(200).json({ grades: Object.values(gradeMap) })
    }

    // ---------- BY SECTION (activities, attendance, payments for a section) ----------
    if (view === 'bySection') {
      if (!section_id) {
        return res.status(400).json({ message: 'section_id is required for view=bySection' })
      }

      // activity list assigned to this section (and optionally date filter)
      const [activities] = await db.query(
        `
        SELECT
          a.id AS activity_id,
          a.title,
          a.activity_date
        FROM activities a
        JOIN activity_assignments aa ON aa.activity_id = a.id
        WHERE aa.section_id = ? AND a.is_deleted = 0 ${dateWhere}
        GROUP BY a.id
        ORDER BY a.activity_date DESC
        `,
        [section_id, ...dateParams]
      )

      // for each activity compute attendance & payment summary for this section
      const activitySummaries = []
      for (const act of activities) {
        const [attRows] = await db.query(
          `
          SELECT
            SUM(att.status = 'present') AS present_count,
            SUM(att.status = 'absent')  AS absent_count,
            SUM(att.parent_present = 1) AS parent_present_count
          FROM attendance att
          JOIN activity_assignments aa ON aa.id = att.activity_assignment_id
          WHERE aa.activity_id = ? AND aa.section_id = ?
          `,
          [act.activity_id, section_id]
        )

        const [payRows] = await db.query(
          `
          SELECT
            SUM(p.paid = 1) AS paid_count,
            SUM(p.paid = 0) AS unpaid_count
          FROM payments p
          JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
          WHERE aa.activity_id = ? AND aa.section_id = ?
          `,
          [act.activity_id, section_id]
        )

        activitySummaries.push({
          activity_id: act.activity_id,
          title: act.title,
          activity_date: act.activity_date,
          attendance: attRows[0] ?? { present_count: 0, absent_count: 0, parent_present_count: 0 },
          payments: payRows[0] ?? { paid_count: 0, unpaid_count: 0 }
        })
      }

      // total students in this section
      const [[studentRow]] = await db.query(
        `SELECT COUNT(*) AS total_students FROM students WHERE section_id = ? AND is_deleted = 0`,
        [section_id]
      )

      return res.status(200).json({
        section_id,
        total_students: studentRow.total_students ?? 0,
        activities: activitySummaries
      })
    }

    // ---------- BY ACTIVITY (attendance & payments grouped by section/grade) ----------
    if (view === 'byActivity') {
      if (!activity_id) {
        return res.status(400).json({ message: 'activity_id is required for view=byActivity' })
      }

      // attendance grouped by grade+section
      const [attGroups] = await db.query(
        `
        SELECT
          aa.grade_id,
          aa.section_id,
          s.name AS section_name,
          SUM(att.status = 'present') AS present_count,
          SUM(att.status = 'absent')  AS absent_count,
          SUM(att.parent_present = 1) AS parent_present_count,
          COUNT(att.id) AS total_records
        FROM attendance att
        JOIN activity_assignments aa ON aa.id = att.activity_assignment_id
        JOIN sections s ON s.id = aa.section_id
        WHERE aa.activity_id = ?
        GROUP BY aa.grade_id, aa.section_id, s.name
        ORDER BY aa.grade_id, s.name
        `,
        [activity_id]
      )

      // payments grouped by grade+section
      const [payGroups] = await db.query(
        `
        SELECT
          aa.grade_id,
          aa.section_id,
          s.name AS section_name,
          SUM(p.paid = 1) AS paid_count,
          SUM(p.paid = 0) AS unpaid_count,
          COUNT(p.id) AS total_records
        FROM payments p
        JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
        JOIN sections s ON s.id = aa.section_id
        WHERE aa.activity_id = ?
        GROUP BY aa.grade_id, aa.section_id, s.name
        ORDER BY aa.grade_id, s.name
        `,
        [activity_id]
      )

      return res.status(200).json({
        activity_id,
        attendance_by_section: attGroups,
        payments_by_section: payGroups
      })
    }

    // ---------- PAYMENTS BY GRADE ----------
    // GET /api/summary?view=paymentsByGrade&from_date=&to_date=&grade_id(optional)=
    if (view === 'paymentsByGrade') {
      // optional grade_id filter - if supplied, restrict to that grade
      const gradeFilter = grade_id ? 'AND aa.grade_id = ?' : ''

      // params: if grade_id present, include it as first param, then dateParams
      const params = grade_id ? [grade_id, ...dateParams] : [...dateParams]

      const [rows] = await db.query(
        `
        SELECT
          aa.grade_id,
          g.name AS grade_name,
          SUM(p.paid = 1) AS paid_count,
          SUM(p.paid = 0) AS unpaid_count
        FROM payments p
        JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
        JOIN activities a ON a.id = aa.activity_id
        JOIN grades g ON g.id = aa.grade_id
        WHERE a.is_deleted = 0 ${dateWhere} ${gradeFilter}
        GROUP BY aa.grade_id, g.name
        ORDER BY aa.grade_id
        `,
        params
      )

      return res.status(200).json({ payments_by_grade: rows ?? [] })
    }

    // ---------- PAYMENTS BY SECTION ----------
    // GET /api/summary?view=paymentsBySection&grade_id=&from_date=&to_date=
    if (view === 'paymentsBySection') {
      if (!grade_id) {
        return res.status(400).json({ message: 'grade_id is required for view=paymentsBySection' })
      }

      const params = [grade_id, ...dateParams]

      const [rows] = await db.query(
        `
        SELECT
          aa.section_id,
          s.name AS section_name,
          SUM(p.paid = 1) AS paid_count,
          SUM(p.paid = 0) AS unpaid_count
        FROM payments p
        JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
        JOIN activities a ON a.id = aa.activity_id
        JOIN sections s ON s.id = aa.section_id
        WHERE a.is_deleted = 0 AND aa.grade_id = ? ${dateWhere}
        GROUP BY aa.section_id, s.name
        ORDER BY s.name
        `,
        params
      )

      return res.status(200).json({ payments_by_section: rows ?? [] })
    }

    // unknown view
    return res.status(400).json({ message: 'Invalid view parameter' })
  } catch (err) {
    console.error('Summary API error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
