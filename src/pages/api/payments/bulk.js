import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { auditLog } from '../lib/audit'

async function getAssignment(assignmentId) {
  const [[assignment]] = await db.query(
    `SELECT
        aa.id,
        aa.grade_id,
        aa.section_id,
        aa.activity_id,
        a.school_year_id,
        a.title,
        a.payments_enabled,
        a.fee_type,
        a.fee_amount
       FROM activity_assignments aa
       JOIN activities a ON a.id = aa.activity_id AND a.school_year_id = aa.school_year_id AND a.is_deleted = 0
      WHERE aa.id = ?
      LIMIT 1`,
    [assignmentId]
  )

  return assignment
}

async function validateTeacherAccess(userId, sectionId, schoolYearId) {
  const [[ok]] = await db.query(
    `SELECT 1
       FROM teacher_sections
      WHERE user_id = ?
        AND section_id = ?
        AND school_year_id = ?
        AND is_active = 1
      LIMIT 1`,
    [userId, sectionId, schoolYearId]
  )

  return !!ok
}

async function validateStudents(records, assignment) {
  const submittedStudentIds = [...new Set(records.map(r => Number(r.student_id)).filter(Number.isInteger))]
  if (!submittedStudentIds.length) return { valid: false, message: 'No valid student IDs submitted' }

  const placeholders = submittedStudentIds.map(() => '?').join(',')
  const [validRows] = await db.query(
    `SELECT st.id
       FROM students st
       JOIN student_enrollments en ON en.student_id = st.id
      WHERE st.id IN (${placeholders})
        AND st.is_deleted = 0
        AND en.school_year_id = ?
        AND en.status = 'active'
        AND en.grade_id = ?
        AND en.section_id = ?`,
    [...submittedStudentIds, assignment.school_year_id, assignment.grade_id, assignment.section_id]
  )

  const validIds = new Set(validRows.map(r => Number(r.id)))
  const invalidIds = submittedStudentIds.filter(id => !validIds.has(id))

  if (invalidIds.length) {
    return {
      valid: false,
      message: 'Some students do not belong to this assignment section and school year',
      invalid_student_ids: invalidIds
    }
  }

  return { valid: true }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (!['admin', 'teacher'].includes(session.user.role)) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const { activity_assignment_id, records } = req.body || {}
    const assignmentId = Number(activity_assignment_id)
    if (!Number.isInteger(assignmentId) || assignmentId <= 0 || !Array.isArray(records)) {
      return res.status(400).json({ message: 'Invalid payload' })
    }

    const assignment = await getAssignment(assignmentId)
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

    if (session.user.role === 'teacher') {
      const allowed = await validateTeacherAccess(session.user.id, assignment.section_id, assignment.school_year_id)
      if (!allowed) return res.status(403).json({ message: 'Forbidden' })
    }

    const validation = await validateStudents(records, assignment)
    if (!validation.valid) return res.status(400).json(validation)

    const paymentsOff = Number(assignment.payments_enabled) === 0 || String(assignment.fee_type) === 'none'
    const values = []
    const params = []

    for (const r of records) {
      const studentId = Number(r.student_id)
      if (!Number.isInteger(studentId)) continue

      const paid = paymentsOff ? 0 : r.paid ? 1 : 0
      let amount = 0

      if (paid) {
        const submittedAmount = Number(r.amount)
        if (Number.isFinite(submittedAmount) && submittedAmount > 0) {
          amount = submittedAmount
        } else if (['fee', 'mixed'].includes(String(assignment.fee_type)) && assignment.fee_amount != null) {
          amount = Number(assignment.fee_amount)
        } else {
          return res.status(400).json({ message: 'Amount must be greater than 0 when paid is checked', student_id: studentId })
        }
      }

      const paymentDate = paid ? r.payment_date || new Date().toISOString().slice(0, 10) : null
      values.push('(?, ?, ?, ?, ?, ?, NOW())')
      params.push(assignmentId, studentId, paid, amount, paymentDate, session.user.id)
    }

    if (!values.length) return res.status(400).json({ message: 'No records to save' })

    await db.query(
      `INSERT INTO payments (activity_assignment_id, student_id, paid, amount, payment_date, marked_by, marked_at)
       VALUES ${values.join(', ')}
       ON DUPLICATE KEY UPDATE
         paid = VALUES(paid),
         amount = VALUES(amount),
         payment_date = VALUES(payment_date),
         marked_by = VALUES(marked_by),
         marked_at = VALUES(marked_at)`,
      params
    )

    await auditLog({
      actorUserId: session.user.id,
      action: 'payments.bulk_save',
      entityType: 'activity_assignment',
      entityId: assignmentId,
      details: { count: values.length, school_year_id: assignment.school_year_id, section_id: assignment.section_id }
    })

    return res.status(200).json({ message: 'Payments saved', count: values.length })
  } catch (err) {
    console.error('payments bulk error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
