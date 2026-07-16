import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { resolveSchoolYearId } from '../lib/schoolYear'

const isValidDate = d => {
  if (!d) return false
  const n = new Date(d)

  return !Number.isNaN(n.getTime())
}

const number = value => Number(value || 0)

function buildDateFilter(fromDate, toDate) {
  const filters = []
  const params = []

  if (isValidDate(fromDate)) {
    filters.push('a.activity_date >= ?')
    params.push(fromDate)
  }
  if (isValidDate(toDate)) {
    filters.push('a.activity_date <= ?')
    params.push(toDate)
  }

  return { sql: filters.length ? `AND ${filters.join(' AND ')}` : '', params }
}

function parseParentIds(raw) {
  return String(raw || '')
    .split(',')
    .map(x => Number(x.trim()))
    .filter(Number.isInteger)
}

function parentFilterSql(parentIds, studentAlias = 'st') {
  if (!parentIds.length) return { sql: '', params: [] }

  return {
    sql: `AND EXISTS (
            SELECT 1
              FROM student_parents sp_filter
             WHERE sp_filter.student_id = ${studentAlias}.id
               AND sp_filter.parent_id IN (${parentIds.map(() => '?').join(',')})
          )`,
    params: parentIds
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed. Use GET.' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user || session.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden. Admins only.' })
    }

    const syId = await resolveSchoolYearId(req)
    const {
      view = 'overview',
      grade_id = '',
      section_id = '',
      activity_id = '',
      from_date = '',
      to_date = ''
    } = req.query

    const parentIds = parseParentIds(req.query.parent_ids)
    const date = buildDateFilter(from_date, to_date)
    const parent = parentFilterSql(parentIds, 'st')

    if (view === 'overview') {
      const [[studentsRow]] = await db.query(
        `SELECT COUNT(DISTINCT en.student_id) AS total_students
           FROM student_enrollments en
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
          WHERE en.school_year_id = ?
            AND en.status = 'active'
            ${parent.sql}`,
        [syId, ...parent.params]
      )

      const [[activitiesRow]] = await db.query(
        `SELECT COUNT(*) AS total_activities
           FROM activities a
          WHERE a.is_deleted = 0
            AND a.school_year_id = ?
            ${date.sql}`,
        [syId, ...date.params]
      )

      const [[attendanceRow]] = await db.query(
        `SELECT
            SUM(CASE WHEN att.status = 'present' THEN 1 ELSE 0 END) AS total_present,
            SUM(CASE WHEN att.status = 'absent' THEN 1 ELSE 0 END) AS total_absent,
            SUM(CASE WHEN att.parent_present = 1 THEN 1 ELSE 0 END) AS parent_present_count,
            SUM(CASE WHEN att.parent_present = 0 THEN 1 ELSE 0 END) AS parent_absent_count
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN attendance att
             ON att.activity_assignment_id = aa.id
            AND att.student_id = st.id
          WHERE a.school_year_id = ?
            ${date.sql}
            ${parent.sql}`,
        [syId, ...date.params, ...parent.params]
      )

      const [[paymentsRow]] = await db.query(
        `SELECT
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN 1 ELSE 0 END) AS total_paid,
            SUM(CASE
                  WHEN a.fee_type IN ('fee','mixed')
                   AND COALESCE(p.paid, 0) = 0
                   AND COALESCE(c.contribution_count, 0) = 0
                  THEN 1 ELSE 0
                END) AS total_unpaid,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN p.amount ELSE 0 END) AS paid_amount_total
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN payments p
             ON p.activity_assignment_id = aa.id
            AND p.student_id = st.id
           LEFT JOIN (
             SELECT activity_assignment_id, student_id, COUNT(*) AS contribution_count
               FROM contributions
              GROUP BY activity_assignment_id, student_id
           ) c
             ON c.activity_assignment_id = aa.id
            AND c.student_id = st.id
          WHERE a.school_year_id = ?
            ${date.sql}
            ${parent.sql}`,
        [syId, ...date.params, ...parent.params]
      )

      return res.status(200).json({
        total_students: number(studentsRow?.total_students),
        total_activities: number(activitiesRow?.total_activities),
        attendance: {
          total_present: number(attendanceRow?.total_present),
          total_absent: number(attendanceRow?.total_absent),
          parent_present_count: number(attendanceRow?.parent_present_count),
          parent_absent_count: number(attendanceRow?.parent_absent_count)
        },
        payments: {
          total_paid: number(paymentsRow?.total_paid),
          total_unpaid: number(paymentsRow?.total_unpaid),
          paid_amount_total: number(paymentsRow?.paid_amount_total)
        }
      })
    }

    if (view === 'byGrade') {
      const filter = grade_id ? 'AND g.id = ?' : ''
      const params = grade_id ? [syId, grade_id] : [syId]

      const [rows] = await db.query(
        `SELECT
            g.id AS grade_id,
            g.name AS grade_name,
            s.id AS section_id,
            s.name AS section_name,
            COUNT(DISTINCT en.student_id) AS total_students
           FROM grades g
           LEFT JOIN sections s
             ON s.grade_id = g.id
            AND s.is_deleted = 0
           LEFT JOIN student_enrollments en
             ON en.section_id = s.id
            AND en.school_year_id = ?
            AND en.status = 'active'
          WHERE 1 = 1
            ${filter}
          GROUP BY g.id, g.name, s.id, s.name
          ORDER BY g.id, s.name`,
        params
      )

      const gradeMap = {}
      for (const r of rows) {
        if (!gradeMap[r.grade_id]) gradeMap[r.grade_id] = { grade_id: r.grade_id, grade_name: r.grade_name, sections: [] }
        if (r.section_id) {
          gradeMap[r.grade_id].sections.push({
            section_id: r.section_id,
            section_name: r.section_name,
            total_students: number(r.total_students)
          })
        }
      }

      return res.status(200).json({ grades: Object.values(gradeMap) })
    }

    if (view === 'bySection') {
      if (!section_id) return res.status(400).json({ message: 'section_id is required for view=bySection' })

      const [[studentRow]] = await db.query(
        `SELECT COUNT(DISTINCT en.student_id) AS total_students
           FROM student_enrollments en
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
          WHERE en.section_id = ?
            AND en.school_year_id = ?
            AND en.status = 'active'`,
        [section_id, syId]
      )

      const [activities] = await db.query(
        `SELECT
            a.id AS activity_id,
            a.title,
            DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
            SUM(CASE WHEN att.status = 'present' THEN 1 ELSE 0 END) AS present_count,
            SUM(CASE WHEN att.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
            SUM(CASE WHEN att.parent_present = 1 THEN 1 ELSE 0 END) AS parent_present_count,
            SUM(CASE WHEN att.parent_present = 0 THEN 1 ELSE 0 END) AS parent_absent_count,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
            SUM(CASE
                  WHEN a.fee_type IN ('fee','mixed')
                   AND COALESCE(p.paid, 0) = 0
                   AND COALESCE(c.contribution_count, 0) = 0
                  THEN 1 ELSE 0
                END) AS unpaid_count,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN p.amount ELSE 0 END) AS paid_amount_total
           FROM activities a
           JOIN activity_assignments aa ON aa.activity_id = a.id
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
           LEFT JOIN payments p ON p.activity_assignment_id = aa.id AND p.student_id = st.id
           LEFT JOIN (
             SELECT activity_assignment_id, student_id, COUNT(*) AS contribution_count
               FROM contributions
              GROUP BY activity_assignment_id, student_id
           ) c ON c.activity_assignment_id = aa.id AND c.student_id = st.id
          WHERE a.is_deleted = 0
            AND a.school_year_id = ?
            AND aa.section_id = ?
            ${date.sql}
          GROUP BY a.id, a.title, a.activity_date
          ORDER BY a.activity_date DESC, a.id DESC`,
        [syId, section_id, ...date.params]
      )

      return res.status(200).json({
        section_id,
        total_students: number(studentRow?.total_students),
        activities: activities.map(a => ({
          activity_id: a.activity_id,
          title: a.title,
          activity_date: a.activity_date,
          attendance: {
            present_count: number(a.present_count),
            absent_count: number(a.absent_count),
            parent_present_count: number(a.parent_present_count),
            parent_absent_count: number(a.parent_absent_count)
          },
          payments: {
            paid_count: number(a.paid_count),
            unpaid_count: number(a.unpaid_count),
            paid_amount_total: number(a.paid_amount_total)
          }
        }))
      })
    }

    if (view === 'byActivity') {
      if (!activity_id) return res.status(400).json({ message: 'activity_id is required for view=byActivity' })

      const [[act]] = await db.query(
        `SELECT id FROM activities WHERE id = ? AND school_year_id = ? AND is_deleted = 0 LIMIT 1`,
        [activity_id, syId]
      )
      if (!act) return res.status(404).json({ message: 'Activity not found for selected school year' })

      const [rows] = await db.query(
        `SELECT
            aa.grade_id,
            g.name AS grade_name,
            aa.section_id,
            s.name AS section_name,
            SUM(CASE WHEN att.status = 'present' THEN 1 ELSE 0 END) AS present_count,
            SUM(CASE WHEN att.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
            SUM(CASE WHEN att.parent_present = 1 THEN 1 ELSE 0 END) AS parent_present_count,
            SUM(CASE WHEN att.parent_present = 0 THEN 1 ELSE 0 END) AS parent_absent_count,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
            SUM(CASE
                  WHEN a.fee_type IN ('fee','mixed')
                   AND COALESCE(p.paid, 0) = 0
                   AND COALESCE(c.contribution_count, 0) = 0
                  THEN 1 ELSE 0
                END) AS unpaid_count,
            COUNT(DISTINCT en.student_id) AS total_expected
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN grades g ON g.id = aa.grade_id
           JOIN sections s ON s.id = aa.section_id
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
           LEFT JOIN payments p ON p.activity_assignment_id = aa.id AND p.student_id = st.id
           LEFT JOIN (
             SELECT activity_assignment_id, student_id, COUNT(*) AS contribution_count
               FROM contributions
              GROUP BY activity_assignment_id, student_id
           ) c ON c.activity_assignment_id = aa.id AND c.student_id = st.id
          WHERE aa.activity_id = ?
          GROUP BY aa.grade_id, g.name, aa.section_id, s.name
          ORDER BY aa.grade_id, s.name`,
        [activity_id]
      )

      return res.status(200).json({
        activity_id,
        attendance_by_section: rows.map(r => ({
          grade_id: r.grade_id,
          grade_name: r.grade_name,
          section_id: r.section_id,
          section_name: r.section_name,
          present_count: number(r.present_count),
          absent_count: number(r.absent_count),
          parent_present_count: number(r.parent_present_count),
          parent_absent_count: number(r.parent_absent_count),
          total_records: number(r.total_expected)
        })),
        payments_by_section: rows.map(r => ({
          grade_id: r.grade_id,
          grade_name: r.grade_name,
          section_id: r.section_id,
          section_name: r.section_name,
          paid_count: number(r.paid_count),
          unpaid_count: number(r.unpaid_count),
          total_records: number(r.total_expected)
        }))
      })
    }

    if (view === 'paymentsByGrade') {
      const gradeFilter = grade_id ? 'AND aa.grade_id = ?' : ''
      const params = grade_id
        ? [syId, ...date.params, ...parent.params, grade_id]
        : [syId, ...date.params, ...parent.params]

      const [rows] = await db.query(
        `SELECT
            aa.grade_id,
            g.name AS grade_name,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
            SUM(CASE
                  WHEN a.fee_type IN ('fee','mixed')
                   AND COALESCE(p.paid, 0) = 0
                   AND COALESCE(c.contribution_count, 0) = 0
                  THEN 1 ELSE 0
                END) AS unpaid_count,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN p.amount ELSE 0 END) AS paid_amount_total,
            CASE WHEN SUM(CASE WHEN a.fee_type IN ('fee','mixed') THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END AS applies_fee,
            CASE WHEN SUM(CASE WHEN a.fee_type IN ('fee','mixed') THEN 1 ELSE 0 END) > 0 THEN 'fee' ELSE 'nonfee' END AS fee_type
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN grades g ON g.id = aa.grade_id
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN payments p ON p.activity_assignment_id = aa.id AND p.student_id = st.id
           LEFT JOIN (
             SELECT activity_assignment_id, student_id, COUNT(*) AS contribution_count
               FROM contributions
              GROUP BY activity_assignment_id, student_id
           ) c ON c.activity_assignment_id = aa.id AND c.student_id = st.id
          WHERE a.school_year_id = ?
            ${date.sql}
            ${parent.sql}
            ${gradeFilter}
          GROUP BY aa.grade_id, g.name
          ORDER BY aa.grade_id`,
        params
      )

      return res.status(200).json({ payments_by_grade: rows ?? [] })
    }

    if (view === 'paymentsBySection') {
      if (!grade_id) return res.status(400).json({ message: 'grade_id is required for view=paymentsBySection' })

      const [rows] = await db.query(
        `SELECT
            aa.section_id,
            sct.name AS section_name,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
            SUM(CASE
                  WHEN a.fee_type IN ('fee','mixed')
                   AND COALESCE(p.paid, 0) = 0
                   AND COALESCE(c.contribution_count, 0) = 0
                  THEN 1 ELSE 0
                END) AS unpaid_count,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN p.amount ELSE 0 END) AS paid_amount_total,
            CASE WHEN SUM(CASE WHEN a.fee_type IN ('fee','mixed') THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END AS applies_fee,
            CASE WHEN SUM(CASE WHEN a.fee_type IN ('fee','mixed') THEN 1 ELSE 0 END) > 0 THEN 'fee' ELSE 'nonfee' END AS fee_type
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN sections sct ON sct.id = aa.section_id AND sct.is_deleted = 0
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN payments p ON p.activity_assignment_id = aa.id AND p.student_id = st.id
           LEFT JOIN (
             SELECT activity_assignment_id, student_id, COUNT(*) AS contribution_count
               FROM contributions
              GROUP BY activity_assignment_id, student_id
           ) c ON c.activity_assignment_id = aa.id AND c.student_id = st.id
          WHERE a.school_year_id = ?
            ${date.sql}
            ${parent.sql}
            AND aa.grade_id = ?
          GROUP BY aa.section_id, sct.name
          ORDER BY sct.name`,
        [syId, ...date.params, ...parent.params, grade_id]
      )

      return res.status(200).json({ payments_by_section: rows ?? [] })
    }

    if (view === 'activitiesOverview') {
      const [rows] = await db.query(
        `SELECT
            aa.grade_id,
            g.name AS grade_name,
            SUM(CASE WHEN att.status = 'present' THEN 1 ELSE 0 END) AS present_count,
            SUM(CASE WHEN att.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
            SUM(CASE WHEN att.parent_present = 1 THEN 1 ELSE 0 END) AS parent_present_count,
            SUM(CASE WHEN att.parent_present = 0 THEN 1 ELSE 0 END) AS parent_absent_count
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN grades g ON g.id = aa.grade_id
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
          WHERE a.school_year_id = ?
            ${date.sql}
          GROUP BY aa.grade_id, g.name
          ORDER BY aa.grade_id`,
        [syId, ...date.params]
      )

      return res.status(200).json({ activities_by_grade: rows ?? [] })
    }

    if (view === 'activitiesByGrade') {
      if (!grade_id) return res.status(400).json({ message: 'grade_id is required for view=activitiesByGrade' })

      const [rows] = await db.query(
        `SELECT
            aa.section_id,
            s.name AS section_name,
            SUM(CASE WHEN att.status = 'present' THEN 1 ELSE 0 END) AS present_count,
            SUM(CASE WHEN att.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
            SUM(CASE WHEN att.parent_present = 1 THEN 1 ELSE 0 END) AS parent_present_count,
            SUM(CASE WHEN att.parent_present = 0 THEN 1 ELSE 0 END) AS parent_absent_count
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN sections s ON s.id = aa.section_id AND s.is_deleted = 0
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
          WHERE a.school_year_id = ?
            ${date.sql}
            AND aa.grade_id = ?
          GROUP BY aa.section_id, s.name
          ORDER BY s.name`,
        [syId, ...date.params, grade_id]
      )

      return res.status(200).json({ activities_by_section: rows ?? [] })
    }

    if (view === 'activitiesBySection') {
      if (!section_id) return res.status(400).json({ message: 'section_id is required for view=activitiesBySection' })

      const [rows] = await db.query(
        `SELECT
            a.id,
            a.title,
            DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
            SUM(CASE WHEN att.status = 'present' THEN 1 ELSE 0 END) AS present_count,
            SUM(CASE WHEN att.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
            SUM(CASE WHEN att.parent_present = 1 THEN 1 ELSE 0 END) AS parent_present_count,
            SUM(CASE WHEN att.parent_present = 0 THEN 1 ELSE 0 END) AS parent_absent_count,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
            SUM(CASE
                  WHEN a.fee_type IN ('fee','mixed')
                   AND COALESCE(p.paid, 0) = 0
                   AND COALESCE(c.contribution_count, 0) = 0
                  THEN 1 ELSE 0
                END) AS unpaid_count,
            SUM(CASE WHEN a.fee_type IN ('fee','mixed') AND p.paid = 1 THEN p.amount ELSE 0 END) AS paid_amount_total
           FROM activities a
           JOIN activity_assignments aa ON aa.activity_id = a.id
           JOIN student_enrollments en
             ON en.school_year_id = a.school_year_id
            AND en.grade_id = aa.grade_id
            AND en.section_id = aa.section_id
            AND en.status = 'active'
           JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
           LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
           LEFT JOIN payments p ON p.activity_assignment_id = aa.id AND p.student_id = st.id
           LEFT JOIN (
             SELECT activity_assignment_id, student_id, COUNT(*) AS contribution_count
               FROM contributions
              GROUP BY activity_assignment_id, student_id
           ) c ON c.activity_assignment_id = aa.id AND c.student_id = st.id
          WHERE a.is_deleted = 0
            AND a.school_year_id = ?
            ${date.sql}
            AND aa.section_id = ?
          GROUP BY a.id, a.title, a.activity_date
          ORDER BY a.activity_date DESC, a.id DESC`,
        [syId, ...date.params, section_id]
      )

      return res.status(200).json({ section_activities: rows ?? [] })
    }

    if (view === 'contribOverview') {
      const [rows] = await db.query(
        `SELECT
            COUNT(DISTINCT c.parent_id) AS parents_contributed,
            SUM(c.hours_worked) AS hours_total,
            SUM(c.estimated_value) AS est_value_total
           FROM contributions c
           JOIN activity_assignments aa ON aa.id = c.activity_assignment_id
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN students st ON st.id = c.student_id AND st.is_deleted = 0
          WHERE a.school_year_id = ?
            ${date.sql}
            ${parent.sql}`,
        [syId, ...date.params, ...parent.params]
      )
      const r = rows[0] || {}

      return res.status(200).json({
        totals: {
          students: number(r.parents_contributed),
          hours_total: number(r.hours_total),
          est_value_total: number(r.est_value_total)
        }
      })
    }

    if (view === 'contribByGrade') {
      const [rows] = await db.query(
        `SELECT
            aa.grade_id,
            g.name AS grade_name,
            COUNT(DISTINCT c.parent_id) AS contrib_students,
            SUM(c.hours_worked) AS contrib_hours_total,
            SUM(c.estimated_value) AS contrib_estimated_total
           FROM contributions c
           JOIN activity_assignments aa ON aa.id = c.activity_assignment_id
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN grades g ON g.id = aa.grade_id
           JOIN students st ON st.id = c.student_id AND st.is_deleted = 0
          WHERE a.school_year_id = ?
            ${date.sql}
            ${parent.sql}
          GROUP BY aa.grade_id, g.name
          ORDER BY aa.grade_id`,
        [syId, ...date.params, ...parent.params]
      )

      return res.status(200).json({ by_grade: rows ?? [] })
    }

    if (view === 'contribBySection') {
      if (!grade_id) return res.status(400).json({ message: 'grade_id is required for view=contribBySection' })

      const [rows] = await db.query(
        `SELECT
            aa.section_id,
            s.name AS section_name,
            COUNT(DISTINCT c.parent_id) AS contrib_students,
            SUM(c.hours_worked) AS contrib_hours_total,
            SUM(c.estimated_value) AS contrib_estimated_total
           FROM contributions c
           JOIN activity_assignments aa ON aa.id = c.activity_assignment_id
           JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
           JOIN sections s ON s.id = aa.section_id AND s.is_deleted = 0
           JOIN students st ON st.id = c.student_id AND st.is_deleted = 0
          WHERE a.school_year_id = ?
            ${date.sql}
            ${parent.sql}
            AND aa.grade_id = ?
          GROUP BY aa.section_id, s.name
          ORDER BY s.name`,
        [syId, ...date.params, ...parent.params, grade_id]
      )

      return res.status(200).json({ by_section: rows ?? [] })
    }

    return res.status(400).json({ message: 'Invalid view parameter' })
  } catch (err) {
    console.error('Summary API error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
