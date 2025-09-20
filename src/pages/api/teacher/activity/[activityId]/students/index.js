// pages/api/teacher/activity/[activityId]/students.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../auth/[...nextauth]'
import db from '../../../../db'
import { getCurrentSchoolYearId } from '../../../../lib/schoolYear'

/**
 * GET /api/teacher/activity/:activityId/students
 * Query: section_id (optional to target one section if an activity covers multiple)
 *        page, page_size, search (by name or LRN)
 * Returns student rows plus attendance/payment for the activity_assignment.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })
  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const teacherId = session.user.id
  const activityId = Number(req.query.activityId)
  const sectionId = req.query.section_id ? Number(req.query.section_id) : null
  const page = Math.max(1, Number(req.query.page ?? 1))
  const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size ?? 50)))
  const search = (req.query.search ?? '').trim()
  const syId = await getCurrentSchoolYearId()

  try {
    // Validate teacher visibility: created_by or assigned section
    const [visible] = await db.query(
      `
      SELECT DISTINCT a.id
      FROM activities a
      LEFT JOIN activity_assignments aa ON aa.activity_id = a.id
      LEFT JOIN teacher_sections ts ON ts.section_id = aa.section_id AND ts.school_year_id = ?
      WHERE a.id = ?
        AND (a.created_by = ? OR ts.user_id = ?)
        AND a.is_deleted = 0
        AND a.school_year_id = ?
    `,
      [syId, activityId, teacherId, teacherId, syId]
    )

    if (visible.length === 0) return res.status(404).json({ message: 'Activity not found' })

    // Build list of activity_assignment_ids the teacher can view
    const params = [activityId, teacherId, syId]
    let aaWhere = ' WHERE aa.activity_id = ? AND ts.user_id = ? AND ts.school_year_id = ? '
    if (sectionId) {
      aaWhere += ' AND aa.section_id = ?'
      params.push(sectionId)
    }

    const [assignments] = await db.query(
      `
      SELECT aa.id AS activity_assignment_id, aa.section_id, s.name AS section_name, s.grade_id, g.name AS grade_name
      FROM activity_assignments aa
      JOIN sections s ON s.id = aa.section_id
      JOIN grades g   ON g.id = s.grade_id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id
      ${aaWhere}
    `,
      params
    )
    if (assignments.length === 0) return res.status(200).json({ students: [], total: 0 })

    // If multiple sections, aggregate students across them; we'll return a flat list with section fields
    const aaIds = assignments.map(a => a.activity_assignment_id)

    // Count for pagination
    const like = `%${search}%`

    const [countRows] = await db.query(
      `
        SELECT COUNT(*) AS total
        FROM student_enrollments se
        JOIN students st ON st.id = se.student_id AND st.is_deleted = 0
        WHERE se.section_id IN (${assignments.map(() => '?').join(',')})
          AND se.school_year_id = ?
          ${search ? 'AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)' : ''}
      `,
      search
        ? [...assignments.map(a => a.section_id), syId, like, like, like]
        : [...assignments.map(a => a.section_id), syId]
    )
    const total = countRows[0]?.total ?? 0

    // Page rows with enhanced data
    const offset = (page - 1) * pageSize

    const [rows] = await db.query(
      `
        SELECT
          st.id,
          st.lrn,
          st.first_name,
          st.last_name,
          st.picture_url,
          se.grade_id,
          se.section_id,
          s.name AS section_name,
          g.name AS grade_name
        FROM student_enrollments se
        JOIN students st ON st.id = se.student_id AND st.is_deleted = 0
        JOIN sections s  ON s.id = se.section_id
        JOIN grades g    ON g.id = se.grade_id
        WHERE se.section_id IN (${assignments.map(() => '?').join(',')})
          AND se.school_year_id = ?
          ${search ? 'AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)' : ''}
        ORDER BY st.last_name ASC, st.first_name ASC
        LIMIT ? OFFSET ?
      `,
      search
        ? [...assignments.map(a => a.section_id), syId, like, like, like, pageSize, offset]
        : [...assignments.map(a => a.section_id), syId, pageSize, offset]
    )

    // Attendance + payments for each student per its matching activity_assignment
    // Build map: section_id -> aa_id
    const mapSectionToAa = new Map()
    assignments.forEach(a => mapSectionToAa.set(a.section_id, a.activity_assignment_id))

    const studentIds = rows.map(r => r.id)
    let attendanceMap = new Map()
    let paymentMap = new Map()
    let contribMap = new Map()

    if (studentIds.length) {
      // Get attendance data
      const [attRows] = await db.query(
        `
        SELECT
          at.student_id,
          at.parent_present,
          at.status,
          at.marked_at,
          aa.section_id,
          u.full_name as marked_by_name
        FROM attendance at
        JOIN activity_assignments aa ON aa.id = at.activity_assignment_id
        LEFT JOIN users u ON u.id = at.marked_by
        WHERE aa.id IN (${aaIds.map(() => '?').join(',')})
          AND at.student_id IN (${studentIds.map(() => '?').join(',')})
      `,
        [...aaIds, ...studentIds]
      )
      attendanceMap = new Map(
        attRows.map(r => [
          `${r.student_id}:${r.section_id}`,
          {
            status: r.status,
            parent_present: !!r.parent_present,
            marked_at: r.marked_at,
            marked_by_name: r.marked_by_name
          }
        ])
      )

      // Get payment data
      const [payRows] = await db.query(
        `
        SELECT
          p.student_id,
          p.paid,
          p.payment_date,
          p.marked_at as payment_marked_at,
          aa.section_id,
          u.full_name as payment_marked_by_name
        FROM payments p
        JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
        LEFT JOIN users u ON u.id = p.marked_by
        WHERE aa.id IN (${aaIds.map(() => '?').join(',')})
          AND p.student_id IN (${studentIds.map(() => '?').join(',')})
      `,
        [...aaIds, ...studentIds]
      )
      paymentMap = new Map(
        payRows.map(r => [
          `${r.student_id}:${r.section_id}`,
          {
            paid: !!r.paid,
            payment_date: r.payment_date,
            payment_marked_at: r.payment_marked_at,
            payment_marked_by_name: r.payment_marked_by_name
          }
        ])
      )

      // Contributions (aggregate per student)
      const [contribRows] = await db.query(
        `
            SELECT
              c.student_id,
              aa.section_id,
              COUNT(*) AS contrib_count,
              COALESCE(SUM(c.hours_worked),0) AS hours_total,
              COALESCE(SUM(c.estimated_value),0) AS value_total
            FROM contributions c
            JOIN activity_assignments aa ON aa.id = c.activity_assignment_id
            WHERE aa.id IN (${aaIds.map(() => '?').join(',')})
              AND c.student_id IN (${studentIds.map(() => '?').join(',')})
            GROUP BY c.student_id, aa.section_id
          `,
        [...aaIds, ...studentIds]
      )
      contribMap = new Map(
        contribRows.map(r => [
          `${r.student_id}:${r.section_id}`,
          {
            count: Number(r.contrib_count || 0),
            hours_total: Number(r.hours_total || 0),
            value_total: Number(r.value_total || 0)
          }
        ])
      )
    }

    // Parents per student
    const [parentRows] = await db.query(
      `
      SELECT
        sp.student_id,
        sp.relation,
        p.first_name,
        p.last_name,
        p.contact_info
      FROM student_parents sp
      JOIN parents p ON p.id = sp.parent_id
      WHERE sp.student_id IN (${studentIds.length ? studentIds.map(() => '?').join(',') : 'NULL'})
        AND p.is_deleted = 0
      ORDER BY sp.student_id, sp.relation
    `,
      studentIds.length ? studentIds : []
    )

    const parentsByStudent = new Map()
    for (const r of parentRows) {
      const arr = parentsByStudent.get(r.student_id) || []

      const parentInfo = {
        name: `${r.first_name} ${r.last_name}`,
        relation: r.relation,
        contact_info: r.contact_info
      }
      arr.push(parentInfo)
      parentsByStudent.set(r.student_id, arr)
    }

    const out = rows.map(r => {
      const aaId = mapSectionToAa.get(r.section_id)
      const att = attendanceMap.get(`${r.id}:${r.section_id}`) || null
      const pay = paymentMap.get(`${r.id}:${r.section_id}`) || null
      const con = contribMap.get(`${r.id}:${r.section_id}`) || { count: 0, hours_total: 0, value_total: 0 }
      const parentsList = parentsByStudent.get(r.id) || []

      return {
        ...r,
        parents: parentsList.map(p => p.name).join(', '),
        parents_details: parentsList,
        attendance_status: att?.status ?? null,
        parent_present: att?.parent_present ?? false,
        attendance_marked_at: att?.marked_at ?? null,
        attendance_marked_by: att?.marked_by_name ?? null,
        contrib_count: con.count,
        contrib_hours_total: con.hours_total,
        contrib_estimated_total: con.value_total,
        payment_paid: pay?.paid ?? null,
        payment_date: pay?.payment_date ?? null,
        payment_marked_at: pay?.payment_marked_at ?? null,
        payment_marked_by: pay?.payment_marked_by_name ?? null,
        activity_assignment_id: aaId
      }
    })

    return res.status(200).json({ students: out, total })
  } catch (err) {
    console.error('activity students error', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
