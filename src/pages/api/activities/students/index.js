// pages/api/activities/students.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { getCurrentSchoolYearId } from '../../lib/schoolYear'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method !== 'GET') {
      return res.status(405).json({ message: 'Method not allowed' })
    }

    const {
      activity_id,
      section_id,
      page = 1,
      page_size = 50,
      search = '',
      parent_ids = '',
      school_year_id // optional
    } = req.query

    if (!activity_id) return res.status(400).json({ message: 'activity_id is required' })
    if (!section_id) return res.status(400).json({ message: 'section_id is required' })

    // Resolve SY (use provided or current)
    let syId = parseInt(school_year_id, 10)
    if (!Number.isFinite(syId)) syId = await getCurrentSchoolYearId()

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const pageSize = Math.max(1, Math.min(1000, parseInt(page_size, 10) || 50))
    const offset = (pageNum - 1) * pageSize

    // Parse parent_ids
    let parentIdsList = []
    if (parent_ids && String(parent_ids).trim() !== '') {
      parentIdsList = String(parent_ids)
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(Number.isFinite)
      if (parentIdsList.length > 50) {
        return res.status(400).json({ message: 'Too many parent_ids (max 50)' })
      }
    }

    // NOTE: schema has no grade_id/section_id on students; use enrollments for the resolved SY.
    // Join activity_assignments by section/grade from enrollment; ensure aa.activity_id matches.
    // Payment amount/status comes from payments_summary (per-student aggregate).
    // Also compute contribution aggregates for the N/A display rule.
    let sql = `
      SELECT
        st.id                  AS student_id,
        st.first_name,
        st.last_name,
        st.lrn,
        se.grade_id,
        se.section_id,
        g.name                 AS grade_name,
        sec.name               AS section_name,

        -- Attendance (for the assignment matching this activity + section)
        att.status             AS attendance_status,
        att.parent_present     AS parent_present,
        att.marked_at          AS attendance_marked_at,

        -- Payments (from the view and raw for latest date)
        ps.paid_amount         AS paid_amount,        -- SUM(amount) per student/assignment
        ps.is_fully_paid       AS is_fully_paid,      -- 0/1 (compared to activities.fee_amount)
        MAX(p.payment_date)    AS latest_payment_date,
        MAX(p.paid)            AS any_paid_flag,      -- 0/1 across rows, used for fallback

        -- Contributions aggregates
        COUNT(c.id)                                  AS contrib_entries,
        COALESCE(SUM(c.hours_worked), 0)             AS contrib_hours_total,
        COALESCE(SUM(c.estimated_value), 0)          AS contrib_estimated_total,

        -- Parents
        GROUP_CONCAT(
          DISTINCT CONCAT(par.last_name, ', ', par.first_name,
            CASE WHEN sp.relation IS NOT NULL THEN CONCAT(' (', sp.relation, ')') ELSE '' END
          )
          SEPARATOR '; '
        ) AS parents
      FROM student_enrollments se
      JOIN students st        ON st.id = se.student_id AND st.is_deleted = 0
      JOIN grades g           ON g.id = se.grade_id
      JOIN sections sec       ON sec.id = se.section_id AND sec.is_deleted = 0
      JOIN activity_assignments aa
                              ON aa.section_id = se.section_id
                             AND aa.grade_id   = se.grade_id
                             AND aa.activity_id = ?
      LEFT JOIN attendance att
                              ON att.activity_assignment_id = aa.id
                             AND att.student_id = st.id
      LEFT JOIN payments p    ON p.activity_assignment_id = aa.id AND p.student_id = st.id
      LEFT JOIN payments_summary ps
                              ON ps.activity_assignment_id = aa.id
                             AND ps.student_id = st.id
      LEFT JOIN contributions c
                              ON c.activity_assignment_id = aa.id
                             AND c.student_id = st.id
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents par        ON par.id = sp.parent_id AND par.is_deleted = 0
      WHERE se.school_year_id = ?
        AND se.status = 'active'
        AND se.section_id = ?
    `

    const params = [activity_id, syId, section_id]

    if (parentIdsList.length > 0) {
      const placeholders = parentIdsList.map(() => '?').join(',')
      sql += `
        AND EXISTS (
          SELECT 1 FROM student_parents sp2
          WHERE sp2.student_id = st.id AND sp2.parent_id IN (${placeholders})
        )
      `
      params.push(...parentIdsList)
    }

    if (search && search.trim() !== '') {
      const s = `%${search.trim()}%`
      sql += `
        AND (
          st.first_name LIKE ? OR
          st.last_name  LIKE ? OR
          st.lrn        LIKE ? OR
          CONCAT(st.first_name, ' ', st.last_name) LIKE ? OR
          CONCAT(st.last_name, ', ', st.first_name) LIKE ?
        )
      `
      params.push(s, s, s, s, s)
    }

    sql += `
      GROUP BY
        st.id, st.first_name, st.last_name, st.lrn,
        se.grade_id, se.section_id, g.name, sec.name,
        att.status, att.parent_present, att.marked_at,
        ps.paid_amount, ps.is_fully_paid
      ORDER BY st.last_name, st.first_name
      LIMIT ? OFFSET ?
    `
    params.push(pageSize, offset)

    // Count (distinct students) with same filters
    let countSql = `
      SELECT COUNT(DISTINCT st.id) AS total
      FROM student_enrollments se
      JOIN students st ON st.id = se.student_id AND st.is_deleted = 0
      JOIN activity_assignments aa
        ON aa.section_id = se.section_id
       AND aa.grade_id   = se.grade_id
       AND aa.activity_id = ?
      WHERE se.school_year_id = ?
        AND se.status = 'active'
        AND se.section_id = ?
    `
    const countParams = [activity_id, syId, section_id]

    if (parentIdsList.length > 0) {
      const placeholders = parentIdsList.map(() => '?').join(',')
      countSql += `
        AND EXISTS (
          SELECT 1 FROM student_parents sp2
          WHERE sp2.student_id = st.id AND sp2.parent_id IN (${placeholders})
        )
      `
      countParams.push(...parentIdsList)
    }

    if (search && search.trim() !== '') {
      const s = `%${search.trim()}%`
      countSql += `
        AND (
          st.first_name LIKE ? OR
          st.last_name  LIKE ? OR
          st.lrn        LIKE ? OR
          CONCAT(st.first_name, ' ', st.last_name) LIKE ? OR
          CONCAT(st.last_name, ', ', st.first_name) LIKE ?
        )
      `
      countParams.push(s, s, s, s, s)
    }

    const [rows] = await db.query(sql, params)
    const [[countRow]] = await db.query(countSql, countParams)
    const total = Number(countRow?.total || 0)

    const students = rows.map(r => {
      const paidAmount = r.paid_amount != null ? Number(r.paid_amount) : null
      const fullyPaid = r.is_fully_paid != null ? Number(r.is_fully_paid) : null
      const anyPaid = r.any_paid_flag != null ? Number(r.any_paid_flag) : null

      return {
        id: r.student_id,
        student_id: r.student_id,
        first_name: r.first_name,
        last_name: r.last_name,
        lrn: r.lrn,
        grade_id: r.grade_id,
        section_id: r.section_id,
        grade_name: r.grade_name,
        section_name: r.section_name,
        parents: r.parents || '',
        attendance_status: r.attendance_status,
        parent_present: Boolean(r.parent_present),
        attendance_marked_at: r.attendance_marked_at,

        // Payments (normalized fields)
        paid_amount: paidAmount, // numeric total from payments_summary
        is_fully_paid: fullyPaid, // 0/1 (null if no fee set in activity)
        any_paid_flag: anyPaid, // 0/1 from raw payments
        latest_payment_date: r.latest_payment_date, // for display

        // Contributions
        contrib_entries: Number(r.contrib_entries || 0),
        contrib_hours_total: Number(r.contrib_hours_total || 0),
        contrib_estimated_total: Number(r.contrib_estimated_total || 0)
      }
    })

    return res.status(200).json({
      students,
      total,
      pagination: {
        page: pageNum,
        page_size: pageSize,
        total,
        total_pages: Math.ceil(total / pageSize)
      }
    })
  } catch (err) {
    console.error('GET /api/activities/students error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
