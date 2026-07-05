import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { auditLog } from '../lib/audit'

const allowedTypes = new Set(['service', 'materials', 'labor', 'other'])

async function getAssignment(assignmentId) {
  const [[assignment]] = await db.query(
    `SELECT
        aa.id,
        aa.grade_id,
        aa.section_id,
        aa.activity_id,
        a.school_year_id,
        a.title
       FROM activity_assignments aa
       JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
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
  const submittedStudentIds = [...new Set(records.map(r => Number(r.student_id)).filter(Number.isFinite))]
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

    const values = []
    const params = []
    const skippedStudentsWithoutParent = []

    for (const r of records) {
      const studentId = Number(r.student_id)
      if (!Number.isInteger(studentId)) continue

      if (!allowedTypes.has(r.contribution_type)) {
        return res.status(400).json({ message: 'Invalid contribution type', student_id: studentId })
      }

      const hasAnyDetail =
        (r.description && String(r.description).trim() !== '') ||
        (r.estimated_value != null && r.estimated_value !== '') ||
        (r.hours_worked != null && r.hours_worked !== '') ||
        (r.materials_details && String(r.materials_details).trim() !== '')

      if (!hasAnyDetail) continue

      const [[parent]] = await db.query(
        `SELECT sp.parent_id
           FROM student_parents sp
          WHERE sp.student_id = ?
          ORDER BY sp.parent_id ASC
          LIMIT 1`,
        [studentId]
      )

      if (!parent) {
        skippedStudentsWithoutParent.push(studentId)
        continue
      }

      values.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())')
      params.push(
        assignmentId,
        studentId,
        parent.parent_id,
        r.contribution_type,
        r.description ? String(r.description).trim() : null,
        r.estimated_value == null || r.estimated_value === '' ? null : Number(r.estimated_value),
        r.hours_worked == null || r.hours_worked === '' ? null : Number(r.hours_worked),
        r.materials_details ? String(r.materials_details).trim() : null,
        session.user.id
      )
    }

    if (!values.length) {
      return res.status(400).json({
        message: 'No contributions to save',
        skipped_students_without_parent: skippedStudentsWithoutParent
      })
    }

    await db.query(
      `INSERT INTO contributions
         (activity_assignment_id, student_id, parent_id, contribution_type,
          description, estimated_value, hours_worked, materials_details,
          verified_by, verified_at, contributed_at)
       VALUES ${values.join(', ')}`,
      params
    )

    await auditLog({
      actorUserId: session.user.id,
      action: 'contributions.bulk_save',
      entityType: 'activity_assignment',
      entityId: assignmentId,
      details: {
        count: values.length,
        school_year_id: assignment.school_year_id,
        section_id: assignment.section_id,
        skipped_students_without_parent: skippedStudentsWithoutParent
      }
    })

    return res.status(200).json({
      message: 'Contributions saved',
      count: values.length,
      skipped_students_without_parent: skippedStudentsWithoutParent
    })
  } catch (err) {
    console.error('contributions bulk error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
