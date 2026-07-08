// pages/api/activities/students/index.js
// Legacy dashboard checklist endpoint, hardened to resolve the real section-level assignment first.
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { resolveSchoolYearId } from '../../lib/schoolYear'

function parsePositiveInt(value) {
  const n = Number(value)

  return Number.isInteger(n) && n > 0 ? n : null
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (!['admin', 'teacher'].includes(session.user.role)) return res.status(403).json({ message: 'Forbidden' })

    if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

    const { activity_id, section_id, page = 1, page_size = 50, search = '', parent_ids = '' } = req.query

    const activityId = parsePositiveInt(activity_id)
    const sectionId = parsePositiveInt(section_id)
    if (!activityId) return res.status(400).json({ message: 'activity_id is required' })
    if (!sectionId) return res.status(400).json({ message: 'section_id is required' })

    const syId = await resolveSchoolYearId(req)
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const pageSize = Math.max(1, Math.min(1000, parseInt(page_size, 10) || 50))
    const offset = (pageNum - 1) * pageSize

    const [[assignment]] = await db.query(
      `SELECT
          aa.id AS activity_assignment_id,
          aa.activity_id,
          aa.grade_id,
          aa.section_id,
          aa.school_year_id,
          a.title,
          a.fee_type,
          a.fee_amount,
          a.payments_enabled
         FROM activity_assignments aa
         JOIN activities a
           ON a.id = aa.activity_id
          AND a.school_year_id = aa.school_year_id
          AND a.is_deleted = 0
        WHERE aa.activity_id = ?
          AND aa.section_id = ?
          AND aa.school_year_id = ?
        LIMIT 1`,
      [activityId, sectionId, syId]
    )

    if (!assignment) {
      return res.status(404).json({ message: 'No assignment found for this activity, section, and school year' })
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
        [session.user.id, assignment.section_id, assignment.school_year_id]
      )
      if (!ok) return res.status(403).json({ message: 'Forbidden: this section is not assigned to the teacher' })
    }

    let parentIdsList = []
    if (parent_ids && String(parent_ids).trim() !== '') {
      parentIdsList = String(parent_ids)
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(Number.isInteger)
      if (parentIdsList.length > 50) return res.status(400).json({ message: 'Too many parent_ids (max 50)' })
    }

    const filters = []
    const baseParams = [assignment.activity_assignment_id, assignment.activity_assignment_id, assignment.activity_assignment_id, syId, assignment.grade_id, assignment.section_id]

    if (parentIdsList.length > 0) {
      filters.push(`AND EXISTS (
        SELECT 1 FROM student_parents sp2
        WHERE sp2.student_id = st.id AND sp2.parent_id IN (${parentIdsList.map(() => '?').join(',')})
      )`)
      baseParams.push(...parentIdsList)
    }

    if (search && search.trim() !== '') {
      const s = `%${search.trim()}%`
      filters.push(`AND (
        st.first_name LIKE ? OR
        st.last_name LIKE ? OR
        st.lrn LIKE ? OR
        CONCAT(st.first_name, ' ', st.last_name) LIKE ? OR
        CONCAT(st.last_name, ', ', st.first_name) LIKE ?
      )`)
      baseParams.push(s, s, s, s, s)
    }

    const sql = `
      SELECT
        st.id AS student_id,
        st.first_name,
        st.last_name,
        st.lrn,
        en.grade_id,
        en.section_id,
        g.name AS grade_name,
        sec.name AS section_name,
        att.status AS attendance_status,
        att.parent_present,
        att.marked_at AS attendance_marked_at,
        p.amount AS paid_amount,
        p.paid AS any_paid_flag,
        p.payment_date AS latest_payment_date,
        CASE
          WHEN ? = 'none' OR ? = 0 THEN NULL
          WHEN ? IS NULL THEN p.paid
          WHEN COALESCE(p.amount, 0) >= ? THEN 1
          ELSE 0
        END AS is_fully_paid,
        COALESCE(ca.contrib_entries, 0) AS contrib_entries,
        COALESCE(ca.contrib_hours_total, 0) AS contrib_hours_total,
        COALESCE(ca.contrib_estimated_total, 0) AS contrib_estimated_total,
        GROUP_CONCAT(
          DISTINCT CONCAT(par.last_name, ', ', par.first_name,
            CASE WHEN sp.relation IS NOT NULL THEN CONCAT(' (', sp.relation, ')') ELSE '' END
          )
          SEPARATOR '; '
        ) AS parents
      FROM student_enrollments en
      JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
      JOIN grades g ON g.id = en.grade_id
      JOIN sections sec ON sec.id = en.section_id AND sec.is_deleted = 0
      LEFT JOIN attendance att ON att.activity_assignment_id = ? AND att.student_id = st.id
      LEFT JOIN payments p ON p.activity_assignment_id = ? AND p.student_id = st.id
      LEFT JOIN (
        SELECT activity_assignment_id, student_id,
               COUNT(*) AS contrib_entries,
               SUM(hours_worked) AS contrib_hours_total,
               SUM(estimated_value) AS contrib_estimated_total
          FROM contributions
         WHERE activity_assignment_id = ?
         GROUP BY activity_assignment_id, student_id
      ) ca ON ca.student_id = st.id
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents par ON par.id = sp.parent_id AND par.is_deleted = 0
      WHERE en.school_year_id = ?
        AND en.status = 'active'
        AND en.grade_id = ?
        AND en.section_id = ?
        ${filters.join('\n')}
      GROUP BY
        st.id, st.first_name, st.last_name, st.lrn,
        en.grade_id, en.section_id, g.name, sec.name,
        att.status, att.parent_present, att.marked_at,
        p.amount, p.paid, p.payment_date,
        ca.contrib_entries, ca.contrib_hours_total, ca.contrib_estimated_total
      ORDER BY st.last_name, st.first_name
      LIMIT ? OFFSET ?
    `

    const dataParams = [
      assignment.fee_type,
      Number(assignment.payments_enabled),
      assignment.fee_amount,
      assignment.fee_amount,
      ...baseParams,
      pageSize,
      offset
    ]

    let countSql = `
      SELECT COUNT(DISTINCT st.id) AS total
      FROM student_enrollments en
      JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
      WHERE en.school_year_id = ?
        AND en.status = 'active'
        AND en.grade_id = ?
        AND en.section_id = ?
    `
    const countParams = [syId, assignment.grade_id, assignment.section_id]

    if (parentIdsList.length > 0) {
      countSql += `AND EXISTS (
        SELECT 1 FROM student_parents sp2
        WHERE sp2.student_id = st.id AND sp2.parent_id IN (${parentIdsList.map(() => '?').join(',')})
      )`
      countParams.push(...parentIdsList)
    }

    if (search && search.trim() !== '') {
      const s = `%${search.trim()}%`
      countSql += `AND (
        st.first_name LIKE ? OR
        st.last_name LIKE ? OR
        st.lrn LIKE ? OR
        CONCAT(st.first_name, ' ', st.last_name) LIKE ? OR
        CONCAT(st.last_name, ', ', st.first_name) LIKE ?
      )`
      countParams.push(s, s, s, s, s)
    }

    const [rows] = await db.query(sql, dataParams)
    const [[countRow]] = await db.query(countSql, countParams)
    const total = Number(countRow?.total || 0)

    return res.status(200).json({
      activity_assignment_id: assignment.activity_assignment_id,
      students: rows.map(r => ({
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
        paid_amount: r.paid_amount == null ? null : Number(r.paid_amount),
        is_fully_paid: r.is_fully_paid == null ? null : Number(r.is_fully_paid),
        any_paid_flag: r.any_paid_flag == null ? null : Number(r.any_paid_flag),
        latest_payment_date: r.latest_payment_date,
        contrib_entries: Number(r.contrib_entries || 0),
        contrib_hours_total: Number(r.contrib_hours_total || 0),
        contrib_estimated_total: Number(r.contrib_estimated_total || 0)
      })),
      total,
      pagination: { page: pageNum, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) }
    })
  } catch (err) {
    console.error('GET /api/activities/students error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
