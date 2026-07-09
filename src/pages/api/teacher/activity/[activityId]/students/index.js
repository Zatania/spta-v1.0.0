import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../../auth/[...nextauth]'
import db from '../../../../db'
import { resolveSchoolYearId } from '../../../../lib/schoolYear'

function parseParentIds(raw) {
  return String(raw || '')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => Number.isInteger(v) && v > 0)
}

function toPositiveInt(value, fallback = null) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

    const teacherId = Number(session.user.id)
    const activityId = toPositiveInt(req.query.activityId)
    const sectionId = toPositiveInt(req.query.section_id)
    const syId = await resolveSchoolYearId(req)
    const page = Math.max(1, toPositiveInt(req.query.page, 1))
    const pageSize = Math.min(1000, Math.max(1, toPositiveInt(req.query.page_size, 50)))
    const offset = (page - 1) * pageSize
    const search = String(req.query.search || '').trim()
    const like = `%${search}%`
    const parentIds = parseParentIds(req.query.parent_ids)

    if (!activityId) return res.status(400).json({ message: 'Invalid activity id' })

    const assignmentParams = [activityId, teacherId, syId]
    const assignmentWhere = ['aa.activity_id = ?', 'ts.user_id = ?', 'ts.school_year_id = ?', 'ts.is_active = 1', 'a.is_deleted = 0', 'a.school_year_id = ?']
    assignmentParams.push(syId)

    if (sectionId) {
      assignmentWhere.push('aa.section_id = ?')
      assignmentParams.push(sectionId)
    }

    const [assignments] = await db.query(
      `SELECT
          aa.id AS activity_assignment_id,
          aa.section_id,
          aa.grade_id,
          s.name AS section_name,
          g.name AS grade_name,
          a.id AS activity_id,
          a.title,
          DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
          a.fee_type,
          a.fee_amount,
          a.payments_enabled
         FROM activity_assignments aa
         JOIN activities a ON a.id = aa.activity_id
         JOIN sections s ON s.id = aa.section_id
         JOIN grades g ON g.id = aa.grade_id
         JOIN teacher_sections ts
           ON ts.section_id = aa.section_id
          AND ts.school_year_id = aa.school_year_id
        WHERE ${assignmentWhere.join(' AND ')}
        ORDER BY g.id, s.name`,
      assignmentParams
    )

    if (!assignments.length) {
      return res.status(200).json({
        students: [],
        total: 0,
        page,
        page_size: pageSize,
        school_year_id: syId,
        assignments: []
      })
    }

    const sectionIds = assignments.map(a => a.section_id)
    const assignmentIds = assignments.map(a => a.activity_assignment_id)
    const assignmentBySection = new Map(assignments.map(a => [Number(a.section_id), a]))

    const studentWhere = [
      `en.school_year_id = ?`,
      `en.status = 'active'`,
      `en.section_id IN (${sectionIds.map(() => '?').join(',')})`,
      `st.is_deleted = 0`
    ]
    const baseParams = [syId, ...sectionIds]

    if (search) {
      studentWhere.push('(st.first_name LIKE ? OR st.last_name LIKE ? OR CONCAT(st.first_name, " ", st.last_name) LIKE ? OR st.lrn LIKE ?)')
      baseParams.push(like, like, like, like)
    }

    if (parentIds.length) {
      studentWhere.push(`EXISTS (
        SELECT 1
          FROM student_parents sp_filter
         WHERE sp_filter.student_id = st.id
           AND sp_filter.parent_id IN (${parentIds.map(() => '?').join(',')})
      )`)
      baseParams.push(...parentIds)
    }

    const [[countRow]] = await db.query(
      `SELECT COUNT(DISTINCT st.id) AS total
         FROM student_enrollments en
         JOIN students st ON st.id = en.student_id
        WHERE ${studentWhere.join(' AND ')}`,
      baseParams
    )

    const [students] = await db.query(
      `SELECT
          st.id,
          st.lrn,
          st.first_name,
          st.last_name,
          st.picture_url,
          en.grade_id,
          en.section_id,
          g.name AS grade_name,
          s.name AS section_name
         FROM student_enrollments en
         JOIN students st ON st.id = en.student_id
         JOIN grades g ON g.id = en.grade_id
         JOIN sections s ON s.id = en.section_id
        WHERE ${studentWhere.join(' AND ')}
        ORDER BY g.id, s.name, st.last_name, st.first_name
        LIMIT ? OFFSET ?`,
      [...baseParams, pageSize, offset]
    )

    const studentIds = students.map(s => s.id)
    const attendanceMap = new Map()
    const paymentMap = new Map()
    const contribMap = new Map()
    const parentsMap = new Map()

    if (studentIds.length) {
      const [attendanceRows] = await db.query(
        `SELECT
            at.student_id,
            aa.section_id,
            at.status,
            at.parent_present,
            DATE_FORMAT(at.marked_at, '%Y-%m-%d %H:%i:%s') AS marked_at
           FROM attendance at
           JOIN activity_assignments aa ON aa.id = at.activity_assignment_id
          WHERE at.activity_assignment_id IN (${assignmentIds.map(() => '?').join(',')})
            AND at.student_id IN (${studentIds.map(() => '?').join(',')})`,
        [...assignmentIds, ...studentIds]
      )
      for (const row of attendanceRows) attendanceMap.set(`${row.student_id}:${row.section_id}`, row)

      const [paymentRows] = await db.query(
        `SELECT
            p.student_id,
            aa.section_id,
            p.paid,
            p.amount,
            DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS payment_date
           FROM payments p
           JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
          WHERE p.activity_assignment_id IN (${assignmentIds.map(() => '?').join(',')})
            AND p.student_id IN (${studentIds.map(() => '?').join(',')})`,
        [...assignmentIds, ...studentIds]
      )
      for (const row of paymentRows) paymentMap.set(`${row.student_id}:${row.section_id}`, row)

      const [contribRows] = await db.query(
        `SELECT
            c.student_id,
            aa.section_id,
            COUNT(*) AS contrib_count,
            COALESCE(SUM(c.hours_worked), 0) AS contrib_hours_total,
            COALESCE(SUM(c.estimated_value), 0) AS contrib_estimated_total
           FROM contributions c
           JOIN activity_assignments aa ON aa.id = c.activity_assignment_id
          WHERE c.activity_assignment_id IN (${assignmentIds.map(() => '?').join(',')})
            AND c.student_id IN (${studentIds.map(() => '?').join(',')})
          GROUP BY c.student_id, aa.section_id`,
        [...assignmentIds, ...studentIds]
      )
      for (const row of contribRows) contribMap.set(`${row.student_id}:${row.section_id}`, row)

      const [parentRows] = await db.query(
        `SELECT
            sp.student_id,
            sp.relation,
            p.first_name,
            p.last_name,
            p.contact_info
           FROM student_parents sp
           JOIN parents p ON p.id = sp.parent_id AND p.is_deleted = 0
          WHERE sp.student_id IN (${studentIds.map(() => '?').join(',')})
          ORDER BY sp.student_id, sp.relation, p.last_name, p.first_name`,
        studentIds
      )
      for (const row of parentRows) {
        const arr = parentsMap.get(row.student_id) || []
        arr.push({
          name: `${row.first_name} ${row.last_name}`,
          relation: row.relation,
          contact_info: row.contact_info
        })
        parentsMap.set(row.student_id, arr)
      }
    }

    const output = students.map(student => {
      const assignment = assignmentBySection.get(Number(student.section_id))
      const key = `${student.id}:${student.section_id}`
      const att = attendanceMap.get(key)
      const pay = paymentMap.get(key)
      const contrib = contribMap.get(key)
      const parents = parentsMap.get(student.id) || []

      return {
        ...student,
        activity_assignment_id: assignment?.activity_assignment_id || null,
        activity_id: assignment?.activity_id || activityId,
        attendance_status: att?.status || null,
        parent_present: att ? !!att.parent_present : false,
        attendance_marked_at: att?.marked_at || null,
        payment_paid: pay ? !!pay.paid : null,
        payment_amount: pay?.amount == null ? null : Number(pay.amount),
        payment_date: pay?.payment_date || null,
        contrib_count: Number(contrib?.contrib_count || 0),
        contrib_hours_total: Number(contrib?.contrib_hours_total || 0),
        contrib_estimated_total: Number(contrib?.contrib_estimated_total || 0),
        parents: parents.map(p => p.name).join(', '),
        parents_details: parents
      }
    })

    return res.status(200).json({
      students: output,
      total: Number(countRow?.total || 0),
      page,
      page_size: pageSize,
      school_year_id: syId,
      assignments,
      activity: assignments[0]
        ? {
            id: assignments[0].activity_id,
            title: assignments[0].title,
            activity_date: assignments[0].activity_date,
            fee_type: assignments[0].fee_type,
            fee_amount: assignments[0].fee_amount,
            payments_enabled: assignments[0].payments_enabled
          }
        : null
    })
  } catch (err) {
    console.error('GET /api/teacher/activity/:activityId/students error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
