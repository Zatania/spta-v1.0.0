// pages/api/teacher/activity/[activityId]/students.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../auth/[...nextauth]'
import db from '../../../../db'

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

  try {
    // Validate teacher visibility: created_by or assigned section
    const [visible] = await db.query(
      `
      SELECT DISTINCT a.id
      FROM activities a
      LEFT JOIN activity_assignments aa ON aa.activity_id = a.id
      LEFT JOIN teacher_sections ts ON ts.section_id = aa.section_id
      WHERE a.id = ?
        AND (a.created_by = ? OR ts.user_id = ?)
        AND a.is_deleted = 0
    `,
      [activityId, teacherId, teacherId]
    )

    if (visible.length === 0) return res.status(404).json({ message: 'Activity not found' })

    // Build list of activity_assignment_ids the teacher can view
    const params = [activityId, teacherId]
    let aaWhere = ' WHERE aa.activity_id = ? AND ts.user_id = ? '
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

    // If multiple sections, aggregate students across them; we’ll return a flat list with section fields
    const aaIds = assignments.map(a => a.activity_assignment_id)

    // Count for pagination
    const like = `%${search}%`

    const [countRows] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM students st
      JOIN sections s ON s.id = st.section_id
      WHERE st.section_id IN (${assignments.map(() => '?').join(',')})
        AND st.is_deleted = 0
        ${search ? 'AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)' : ''}
    `,
      search ? [...assignments.map(a => a.section_id), like, like, like] : assignments.map(a => a.section_id)
    )
    const total = countRows[0]?.total ?? 0

    // Page rows
    const offset = (page - 1) * pageSize

    const [rows] = await db.query(
      `
      SELECT st.id, st.lrn, st.first_name, st.last_name,
             st.grade_id, st.section_id, s.name AS section_name, g.name AS grade_name
      FROM students st
      JOIN sections s ON s.id = st.section_id
      JOIN grades g   ON g.id = st.grade_id
      WHERE st.section_id IN (${assignments.map(() => '?').join(',')})
        AND st.is_deleted = 0
        ${search ? 'AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)' : ''}
      ORDER BY st.last_name ASC, st.first_name ASC
      LIMIT ? OFFSET ?
    `,
      search
        ? [...assignments.map(a => a.section_id), like, like, like, pageSize, offset]
        : [...assignments.map(a => a.section_id), pageSize, offset]
    )

    // Attendance + payments for each student per its matching activity_assignment
    // Build map: section_id -> aa_id
    const mapSectionToAa = new Map()
    assignments.forEach(a => mapSectionToAa.set(a.section_id, a.activity_assignment_id))

    const studentIds = rows.map(r => r.id)
    let attendanceMap = new Map()
    let paymentMap = new Map()

    if (studentIds.length) {
      const [attRows] = await db.query(
        `
        SELECT at.student_id, at.parent_present, at.status, aa.section_id
        FROM attendance at
        JOIN activity_assignments aa ON aa.id = at.activity_assignment_id
        WHERE aa.id IN (${aaIds.map(() => '?').join(',')})
          AND at.student_id IN (${studentIds.map(() => '?').join(',')})
      `,
        [...aaIds, ...studentIds]
      )
      attendanceMap = new Map(
        attRows.map(r => [`${r.student_id}:${r.section_id}`, { status: r.status, parent_present: !!r.parent_present }])
      )

      const [payRows] = await db.query(
        `
        SELECT p.student_id, p.paid, p.payment_date, aa.section_id
        FROM payments p
        JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
        WHERE aa.id IN (${aaIds.map(() => '?').join(',')})
          AND p.student_id IN (${studentIds.map(() => '?').join(',')})
      `,
        [...aaIds, ...studentIds]
      )
      paymentMap = new Map(
        payRows.map(r => [`${r.student_id}:${r.section_id}`, { paid: !!r.paid, payment_date: r.payment_date }])
      )
    }

    // Parents per student
    const [parentRows] = await db.query(
      `
      SELECT sp.student_id, p.first_name, p.last_name
      FROM student_parents sp
      JOIN parents p ON p.id = sp.parent_id
      WHERE sp.student_id IN (${studentIds.length ? studentIds.map(() => '?').join(',') : 'NULL'})
    `,
      studentIds.length ? studentIds : []
    )
    const parentsByStudent = new Map()
    for (const r of parentRows) {
      const arr = parentsByStudent.get(r.student_id) || []
      arr.push(`${r.first_name} ${r.last_name}`)
      parentsByStudent.set(r.student_id, arr)
    }

    const out = rows.map(r => {
      const aaId = mapSectionToAa.get(r.section_id)
      const att = attendanceMap.get(`${r.id}:${r.section_id}`) || null
      const pay = paymentMap.get(`${r.id}:${r.section_id}`) || null

      return {
        ...r,
        parents: (parentsByStudent.get(r.id) || []).join(', '),
        attendance_status: att?.status ?? null,
        parent_present: att?.parent_present ?? false,
        payment_paid: pay?.paid ?? null,
        payment_date: pay?.payment_date ?? null,
        activity_assignment_id: aaId
      }
    })

    return res.status(200).json({ students: out, total })
  } catch (err) {
    console.error('activity students error', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
