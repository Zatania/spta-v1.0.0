// pages/api/summary.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { getCurrentSchoolYearId } from '../lib/schoolYear' // NOTE: path is from /pages/api/summary.js

const isValidDate = d => {
  if (!d) return false
  const n = new Date(d)

  return !Number.isNaN(n.getTime())
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed. Use GET.' })
  }

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
    to_date = null,
    school_year_id = null
  } = req.query

  // Parent filter (comma-separated ids)
  const parentIds = String(req.query.parent_ids || '')
    .split(',')
    .map(x => parseInt(x.trim(), 10))
    .filter(Number.isFinite)

  const hasParentFilter = parentIds.length > 0
  const parentFilterParams = hasParentFilter ? parentIds : []

  // helper WHERE for tables that already joined students as alias `s`
  const parentWhereS = hasParentFilter
    ? `AND EXISTS (SELECT 1 FROM student_parents sp WHERE sp.student_id = s.id AND sp.parent_id IN (${parentIds
        .map(_ => '?')
        .join(',')}))`
    : ''

  // Date filters
  const dateParams = []
  const dateFiltersA = [] // uses alias a.activity_date
  const dateFiltersNoAlias = [] // uses activity_date

  if (isValidDate(from_date)) {
    dateFiltersA.push('a.activity_date >= ?')
    dateFiltersNoAlias.push('activity_date >= ?')
    dateParams.push(from_date)
  }
  if (isValidDate(to_date)) {
    dateFiltersA.push('a.activity_date <= ?')
    dateFiltersNoAlias.push('activity_date <= ?')
    dateParams.push(to_date)
  }

  const dateWhereA = dateFiltersA.length ? `AND ${dateFiltersA.join(' AND ')}` : ''
  const dateWhereNoAlias = dateFiltersNoAlias.length ? `AND ${dateFiltersNoAlias.join(' AND ')}` : ''

  try {
    let syId = parseInt(school_year_id, 10)
    if (!Number.isFinite(syId)) syId = await getCurrentSchoolYearId()

    // ---------- OVERVIEW ----------
    if (view === 'overview') {
      // total students = active enrollments in current SY
      const [[studentsRow]] = await db.query(
        `SELECT COUNT(DISTINCT en.student_id) AS total_students
        FROM student_enrollments en
        JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
        WHERE en.school_year_id = ? AND en.status = 'active'`,
        [syId]
      )

      // activities count (current SY + optional date range)
      const [[activitiesRow]] = await db.query(
        `SELECT COUNT(*) AS total_activities
         FROM activities
         WHERE is_deleted = 0
           AND school_year_id = ?
           ${dateWhereNoAlias}`,
        [syId, ...dateParams]
      )

      // attendance totals limited to current SY activities
      const [attendanceRows] = await db.query(
        `
        SELECT
            SUM(att.status = 'present') AS total_present,
            SUM(att.status = 'absent')  AS total_absent,
            SUM(att.parent_present = 1) AS parent_present_count,
            SUM(att.parent_present = 0) AS parent_absent_count
        FROM attendance att
        JOIN activity_assignments aa ON aa.id = att.activity_assignment_id
        JOIN activities a ON a.id = aa.activity_id
        JOIN students s ON s.id = att.student_id AND s.is_deleted = 0
        WHERE a.is_deleted = 0
          AND a.school_year_id = ?
          ${dateWhereA};
        `,
        [syId, ...dateParams]
      )

      // payments totals limited to current SY activities
      const [paymentsRows] = await db.query(
        `
        SELECT
          SUM(p.paid = 1) AS total_paid,
          -- do NOT count as unpaid if the same student has a contribution for the same activity_assignment
          SUM(
            p.paid = 0
            AND NOT EXISTS (
              SELECT 1
              FROM contributions c
              WHERE c.activity_assignment_id = p.activity_assignment_id
                AND c.student_id = p.student_id
            )
          ) AS total_unpaid
        FROM payments p
        JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
        JOIN activities a ON a.id = aa.activity_id
        JOIN students s ON s.id = p.student_id AND s.is_deleted = 0
        WHERE a.is_deleted = 0
          AND a.school_year_id = ?
          ${dateWhereA};
        `,
        [syId, ...dateParams]
      )

      return res.status(200).json({
        total_students: Number(studentsRow?.total_students || 0),
        total_activities: Number(activitiesRow?.total_activities || 0),
        attendance: attendanceRows[0] ?? {
          total_present: 0,
          total_absent: 0,
          parent_present_count: 0,
          parent_absent_count: 0
        },
        payments: paymentsRows[0] ?? { total_paid: 0, total_unpaid: 0 }
      })
    }

    // ---------- CONTRIBUTIONS OVERVIEW ----------
    if (view === 'contribOverview') {
      // alias: contributions c -> activity_assignments aa -> activities a -> students s2
      const parentWhereS2 = hasParentFilter
        ? `AND EXISTS (SELECT 1 FROM student_parents sp2 WHERE sp2.student_id = s2.id AND sp2.parent_id IN (${parentIds
            .map(_ => '?')
            .join(',')}))`
        : ''

      const [rows] = await db.query(
        `
            SELECT
              COUNT(DISTINCT c.parent_id) AS parents_contributed,
              SUM(c.hours_worked)         AS hours_total,
              SUM(c.estimated_value)      AS est_value_total
            FROM contributions c
            JOIN activity_assignments aa ON aa.id = c.activity_assignment_id
            JOIN activities a            ON a.id  = aa.activity_id
            JOIN students s2             ON s2.id = c.student_id AND s2.is_deleted = 0
            WHERE a.is_deleted = 0
              AND a.school_year_id = ?
              ${dateWhereA}
              ${parentWhereS2};
            `,
        [syId, ...dateParams, ...parentFilterParams]
      )

      const r = rows?.[0] || { parents_contributed: 0, hours_total: 0, est_value_total: 0 }

      return res.status(200).json({
        totals: {
          // frontend label says "Parents Contributed", but prop name expected is "students"
          // so we intentionally map parents -> "students" for display without another frontend change
          students: Number(r.parents_contributed || 0),
          hours_total: Number(r.hours_total || 0),
          est_value_total: Number(r.est_value_total || 0)
        }
      })
    }

    // ---------- CONTRIBUTIONS BY GRADE ----------
    if (view === 'contribByGrade') {
      const parentWhereS2 = hasParentFilter
        ? `AND EXISTS (SELECT 1 FROM student_parents sp2 WHERE sp2.student_id = s2.id AND sp2.parent_id IN (${parentIds
            .map(_ => '?')
            .join(',')}))`
        : ''

      const [rows] = await db.query(
        `
            SELECT
              aa.grade_id,
              g.name AS grade_name,
              COUNT(DISTINCT c.parent_id) AS contrib_students,
              SUM(c.hours_worked)         AS contrib_hours_total,
              SUM(c.estimated_value)      AS contrib_estimated_total
            FROM contributions c
            JOIN activity_assignments aa ON aa.id = c.activity_assignment_id
            JOIN activities a            ON a.id  = aa.activity_id
            JOIN grades g                ON g.id  = aa.grade_id
            JOIN students s2             ON s2.id = c.student_id AND s2.is_deleted = 0
            WHERE a.is_deleted = 0
              AND a.school_year_id = ?
              ${dateWhereA}
              ${parentWhereS2}
            GROUP BY aa.grade_id, g.name
            ORDER BY aa.grade_id;
            `,
        [syId, ...dateParams, ...parentFilterParams]
      )

      return res.status(200).json({ by_grade: rows ?? [] })
    }

    // ---------- CONTRIBUTIONS BY SECTION ----------
    if (view === 'contribBySection') {
      if (!grade_id) {
        return res.status(400).json({ message: 'grade_id is required for view=contribBySection' })
      }

      const parentWhereS2 = hasParentFilter
        ? `AND EXISTS (SELECT 1 FROM student_parents sp2 WHERE sp2.student_id = s2.id AND sp2.parent_id IN (${parentIds
            .map(_ => '?')
            .join(',')}))`
        : ''

      const [rows] = await db.query(
        `
            SELECT
              aa.section_id,
              s.name AS section_name,
              COUNT(DISTINCT c.parent_id) AS contrib_students,
              SUM(c.hours_worked)         AS contrib_hours_total,
              SUM(c.estimated_value)      AS contrib_estimated_total
            FROM contributions c
            JOIN activity_assignments aa ON aa.id = c.activity_assignment_id
            JOIN activities a            ON a.id  = aa.activity_id
            JOIN sections s              ON s.id  = aa.section_id AND s.is_deleted = 0
            JOIN students s2             ON s2.id = c.student_id AND s2.is_deleted = 0
            WHERE a.is_deleted = 0
              AND a.school_year_id = ?
              ${dateWhereA}
              AND aa.grade_id = ?
              ${parentWhereS2}
            GROUP BY aa.section_id, s.name
            ORDER BY s.name;
            `,
        [syId, ...dateParams, grade_id, ...parentFilterParams]
      )

      return res.status(200).json({ by_section: rows ?? [] })
    }

    // ---------- BY GRADE ----------
    if (view === 'byGrade') {
      const filter = grade_id ? 'WHERE g.id = ?' : ''

      // First ? is for en.school_year_id, second ? (optional) is for g.id
      const params = grade_id ? [syId, grade_id] : [syId]

      // Count students per section via current SY enrollments
      const [rows] = await db.query(
        `
        SELECT
          g.id AS grade_id,
          g.name AS grade_name,
          s.id AS section_id,
          s.name AS section_name,
          COUNT(DISTINCT en.student_id) AS total_students
        FROM grades g
        LEFT JOIN sections s ON s.grade_id = g.id AND s.is_deleted = 0
        LEFT JOIN student_enrollments en
          ON en.section_id = s.id
         AND en.school_year_id = ?
         AND en.status = 'active'
        ${filter}
        GROUP BY g.id, g.name, s.id, s.name
        ORDER BY g.id, s.name
        `,
        params
      )

      const gradeMap = {}
      for (const r of rows) {
        const gid = r.grade_id
        if (!gradeMap[gid]) gradeMap[gid] = { grade_id: gid, grade_name: r.grade_name, sections: [] }
        gradeMap[gid].sections.push({
          section_id: r.section_id,
          section_name: r.section_name,
          total_students: Number(r.total_students || 0)
        })
      }

      return res.status(200).json({ grades: Object.values(gradeMap) })
    }

    // ---------- BY SECTION ----------
    if (view === 'bySection') {
      if (!section_id) {
        return res.status(400).json({ message: 'section_id is required for view=bySection' })
      }

      // activities for that section in current SY
      const [activities] = await db.query(
        `
        SELECT DISTINCT
          a.id AS activity_id,
          a.title,
          DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date
        FROM activities a
        JOIN activity_assignments aa ON aa.activity_id = a.id
        WHERE aa.section_id = ?
          AND a.is_deleted = 0
          AND a.school_year_id = ?
          ${dateWhereA}
        ORDER BY activity_date DESC
        `,
        [section_id, syId, ...dateParams]
      )

      const activitySummaries = []
      for (const act of activities) {
        const [attRows] = await db.query(
          `
          SELECT
            SUM(att.status = 'present') AS present_count,
            SUM(att.status = 'absent')  AS absent_count,
            SUM(att.parent_present = 1) AS parent_present_count,
            SUM(att.parent_present = 0) AS parent_absent_count
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
          attendance: attRows[0] ?? {
            present_count: 0,
            absent_count: 0,
            parent_present_count: 0,
            parent_absent_count: 0
          },
          payments: payRows[0] ?? { paid_count: 0, unpaid_count: 0 }
        })
      }

      // students in section (current SY, active)
      const [[studentRow]] = await db.query(
        `
        SELECT COUNT(DISTINCT en.student_id) AS total_students
        FROM student_enrollments en
        JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
        WHERE en.section_id = ? AND en.school_year_id = ? AND en.status = 'active'
        `,
        [section_id, syId]
      )

      return res.status(200).json({
        section_id,
        total_students: Number(studentRow?.total_students || 0),
        activities: activitySummaries
      })
    }

    // ---------- BY ACTIVITY ----------
    if (view === 'byActivity') {
      if (!activity_id) {
        return res.status(400).json({ message: 'activity_id is required for view=byActivity' })
      }

      // optional: ensure activity belongs to current SY
      const [[actCheck]] = await db.query(
        `SELECT id FROM activities WHERE id = ? AND is_deleted = 0 AND school_year_id = ? LIMIT 1`,
        [activity_id, syId]
      )
      if (!actCheck) return res.status(404).json({ message: 'Activity not found for current school year' })

      const [attGroups] = await db.query(
        `
        SELECT
          aa.grade_id,
          aa.section_id,
          s.name AS section_name,
          SUM(att.status = 'present') AS present_count,
          SUM(att.status = 'absent')  AS absent_count,
          SUM(att.parent_present = 1) AS parent_present_count,
          SUM(att.parent_present = 0) AS parent_absent_count,
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

    // ---------- PAYMENTS BY GRADE (enhanced) ----------
    if (view === 'paymentsByGrade') {
      const gradeFilter = grade_id ? 'AND aa.grade_id = ?' : ''

      // parent filter uses alias s (students from payments)
      const params = grade_id
        ? [syId, ...dateParams, ...parentFilterParams, grade_id]
        : [syId, ...dateParams, ...parentFilterParams]

      const [rows] = await db.query(
        `
            SELECT
              aa.grade_id,
              g.name AS grade_name,
              SUM(p.paid = 1) AS paid_count,
              SUM(
                p.paid = 0
                AND NOT EXISTS (
                  SELECT 1 FROM contributions c
                  WHERE c.activity_assignment_id = p.activity_assignment_id
                    AND c.student_id = p.student_id
                )
              ) AS unpaid_count,
              SUM(CASE WHEN p.paid = 1 THEN p.amount ELSE 0 END) AS paid_amount_total,
              CASE WHEN SUM(CASE WHEN a.fee_type IN ('fee','mixed') THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END AS applies_fee,
              CASE WHEN SUM(CASE WHEN a.fee_type IN ('fee','mixed') THEN 1 ELSE 0 END) > 0 THEN 'fee' ELSE 'nonfee' END AS fee_type
            FROM payments p
            JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
            JOIN activities a            ON a.id  = aa.activity_id
            JOIN grades g                ON g.id  = aa.grade_id
            JOIN students s              ON s.id  = p.student_id AND s.is_deleted = 0
            WHERE a.is_deleted = 0
              AND a.school_year_id = ?
              ${dateWhereA}
              ${parentWhereS}
            GROUP BY aa.grade_id, g.name
            ORDER BY aa.grade_id;


            `,
        params
      )

      return res.status(200).json({ payments_by_grade: rows ?? [] })
    }

    // ---------- PAYMENTS BY SECTION (enhanced) ----------
    if (view === 'paymentsBySection') {
      if (!grade_id) {
        return res.status(400).json({ message: 'grade_id is required for view=paymentsBySection' })
      }

      const params = [syId, ...dateParams, ...parentFilterParams, grade_id]

      const [rows] = await db.query(
        `
            SELECT
              aa.section_id,
              sct.name AS section_name,
              SUM(p.paid = 1) AS paid_count,
              SUM(
                p.paid = 0
                AND NOT EXISTS (
                  SELECT 1 FROM contributions c
                  WHERE c.activity_assignment_id = p.activity_assignment_id
                    AND c.student_id = p.student_id
                )
              ) AS unpaid_count,
              SUM(CASE WHEN p.paid = 1 THEN p.amount ELSE 0 END) AS paid_amount_total,
              CASE WHEN SUM(CASE WHEN a.fee_type IN ('fee','mixed') THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END AS applies_fee,
              CASE WHEN SUM(CASE WHEN a.fee_type IN ('fee','mixed') THEN 1 ELSE 0 END) > 0 THEN 'fee' ELSE 'nonfee' END AS fee_type
            FROM payments p
            JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
            JOIN activities a            ON a.id  = aa.activity_id
            JOIN sections sct            ON sct.id = aa.section_id AND sct.is_deleted = 0
            JOIN students s              ON s.id  = p.student_id AND s.is_deleted = 0
            WHERE a.is_deleted = 0
              AND a.school_year_id = ?
              ${dateWhereA}
              ${parentWhereS}
              AND aa.grade_id = ?
            GROUP BY aa.section_id, sct.name
            ORDER BY sct.name;

            `,
        params
      )

      return res.status(200).json({ payments_by_section: rows ?? [] })
    }

    // ---------- ACTIVITIES OVERVIEW (BY GRADE) ----------
    if (view === 'activitiesOverview') {
      const [rows] = await db.query(
        `
        SELECT
            aa.grade_id,
            g.name AS grade_name,
            SUM(att.status = 'present') AS present_count,
            SUM(att.status = 'absent') AS absent_count,
            SUM(att.parent_present = 1) AS parent_present_count,
            SUM(att.parent_present = 0) AS parent_absent_count
        FROM attendance att
        JOIN activity_assignments aa ON aa.id = att.activity_assignment_id
        JOIN activities a ON a.id = aa.activity_id
        JOIN grades g ON g.id = aa.grade_id
        JOIN students s ON s.id = att.student_id AND s.is_deleted = 0
        WHERE a.is_deleted = 0
          AND a.school_year_id = ?
          ${dateWhereA}
        GROUP BY aa.grade_id, g.name
        ORDER BY aa.grade_id;
        `,
        [syId, ...dateParams]
      )

      return res.status(200).json({ activities_by_grade: rows ?? [] })
    }

    // ---------- ACTIVITIES BY GRADE (SECTIONS) ----------
    if (view === 'activitiesByGrade') {
      if (!grade_id) {
        return res.status(400).json({ message: 'grade_id is required for view=activitiesByGrade' })
      }

      const [rows] = await db.query(
        `
        SELECT
            aa.section_id,
            s.name AS section_name,
            SUM(att.status = 'present') AS present_count,
            SUM(att.status = 'absent') AS absent_count,
            SUM(att.parent_present = 1) AS parent_present_count,
            SUM(att.parent_present = 0) AS parent_absent_count
        FROM attendance att
        JOIN activity_assignments aa ON aa.id = att.activity_assignment_id
        JOIN activities a ON a.id = aa.activity_id
        JOIN sections s ON s.id = aa.section_id AND s.is_deleted = 0
        JOIN students st ON st.id = att.student_id AND st.is_deleted = 0
        WHERE a.is_deleted = 0
          AND a.school_year_id = ?
          ${dateWhereA}
          AND aa.grade_id = ?
        GROUP BY aa.section_id, s.name
        ORDER BY s.name;
        `,
        [syId, ...dateParams, grade_id]
      )

      return res.status(200).json({ activities_by_section: rows ?? [] })
    }

    // ---------- ACTIVITIES BY SECTION (INDIVIDUAL ACTIVITIES) ----------
    if (view === 'activitiesBySection') {
      if (!section_id) {
        return res.status(400).json({ message: 'section_id is required for view=activitiesBySection' })
      }

      const [activities] = await db.query(
        `
          SELECT DISTINCT
            a.id,
            a.title,
            DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date
          FROM activities a
          JOIN activity_assignments aa ON aa.activity_id = a.id
          WHERE aa.section_id = ?
            AND a.is_deleted = 0
            AND a.school_year_id = ?
            ${dateWhereA}
          ORDER BY activity_date DESC
          `,
        [section_id, syId, ...dateParams]
      )

      const activitySummaries = []
      for (const act of activities) {
        const [attRows] = await db.query(
          `
          SELECT
            SUM(att.status = 'present') AS present_count,
            SUM(att.status = 'absent') AS absent_count,
            SUM(att.parent_present = 1) AS parent_present_count,
            SUM(att.parent_present = 0) AS parent_absent_count
          FROM attendance att
          JOIN activity_assignments aa ON aa.id = att.activity_assignment_id
          JOIN students s ON s.id = att.student_id
          WHERE aa.activity_id = ? AND aa.section_id = ? AND s.is_deleted = 0
          `,
          [act.id, section_id]
        )

        const [payRows] = await db.query(
          `
          SELECT
            SUM(p.paid = 1) AS paid_count,
            SUM(
              p.paid = 0
              AND NOT EXISTS (
                SELECT 1 FROM contributions c
                WHERE c.activity_assignment_id = aa.id
                  AND c.student_id = p.student_id
              )
            ) AS unpaid_count,
            SUM(CASE WHEN p.paid = 1 THEN p.amount ELSE 0 END) AS paid_amount_total
          FROM payments p
          JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
          WHERE aa.activity_id = ? AND aa.section_id = ?
          `,
          [act.id, section_id]
        )

        activitySummaries.push({
          id: act.id,
          title: act.title,
          activity_date: act.activity_date,
          present_count: attRows[0]?.present_count || 0,
          absent_count: attRows[0]?.absent_count || 0,
          parent_present_count: attRows[0]?.parent_present_count || 0,
          parent_absent_count: attRows[0]?.parent_absent_count || 0,
          paid_count: payRows[0]?.paid_count || 0,
          unpaid_count: payRows[0]?.unpaid_count || 0,
          paid_amount_total: Number(payRows[0]?.paid_amount_total || 0)
        })
      }

      return res.status(200).json({ section_activities: activitySummaries })
    }

    return res.status(400).json({ message: 'Invalid view parameter' })
  } catch (err) {
    console.error('Summary API error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
