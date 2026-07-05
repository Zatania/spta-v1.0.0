// pages/api/contributions/bulk.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { getCurrentSchoolYearId } from '../lib/schoolYear'

/**
 * POST /api/contributions/bulk
 * Body: {
 *   activity_assignment_id: number,
 *   records: [
 *     {
 *       student_id: number,
 *       contribution_type: 'service'|'materials'|'labor'|'other',
 *       description?: string|null,
 *       estimated_value?: number|null,
 *       hours_worked?: number|null,
 *       materials_details?: string|null
 *     }, ...
 *   ]
 * }
 */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
    const allowedTypes = new Set(['service', 'materials', 'labor', 'other'])

    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { activity_assignment_id, records } = req.body || {}
    if (!activity_assignment_id || !Array.isArray(records)) {
      return res.status(400).json({ message: 'Invalid payload' })
    }

    // Get assignment and its section / grade (for permission)
    const [assRows] = await db.query(
      `SELECT aa.id, aa.section_id, aa.grade_id, a.school_year_id
        FROM activity_assignments aa
        JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
        WHERE aa.id = ?
        LIMIT 1`,
      [activity_assignment_id]
    )
    if (!assRows.length) return res.status(404).json({ message: 'Assignment not found' })
    const assignment = assRows[0]

    const syId = await getCurrentSchoolYearId()

    // Teacher must be assigned to the section (current SY)
    if (session.user.role === 'teacher') {
      const [ok] = await db.query(
        `SELECT 1 FROM teacher_sections
          WHERE user_id = ? AND section_id = ? AND school_year_id = ?
          LIMIT 1`,
        [session.user.id, assignment.section_id, syId]
      )
      if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
    }

    const submittedStudentIds = [...new Set(records.map(r => Number(r.student_id)).filter(Number.isFinite))]

    if (!submittedStudentIds.length) {
      return res.status(400).json({ message: 'No valid student IDs submitted' })
    }

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
      [...submittedStudentIds, syId, assignment.grade_id, assignment.section_id]
    )

    const validIds = new Set(validRows.map(r => Number(r.id)))
    const invalidIds = submittedStudentIds.filter(id => !validIds.has(id))
    if (invalidIds.length) {
      return res.status(400).json({
        message: 'Some students do not belong to this assignment section/current school year',
        invalid_student_ids: invalidIds
      })
    }

    // Build values; resolve parent_id per student
    const values = []
    const params = []
    const skipped = [] // students with no parent linked

    for (const r of records) {
      const studentId = Number(r.student_id)
      if (!studentId || !r.contribution_type) continue

      if (!allowedTypes.has(r.contribution_type)) {
        return res.status(400).json({ message: 'Invalid contribution type', student_id: studentId })
      }

      // Require at least one non-empty field; otherwise skip
      const hasAnyDetail =
        (r.description && r.description.trim() !== '') ||
        (r.estimated_value != null && r.estimated_value !== '') ||
        (r.hours_worked != null && r.hours_worked !== '') ||
        (r.materials_details && r.materials_details.trim() !== '')
      if (!hasAnyDetail) continue

      // Resolve parent_id (choose any linked parent; here we pick the lowest id)
      const [pRows] = await db.query(
        `SELECT sp.parent_id
           FROM student_parents sp
          WHERE sp.student_id = ?
          ORDER BY sp.parent_id ASC
          LIMIT 1`,
        [studentId]
      )
      if (!pRows.length) {
        skipped.push(studentId)
        continue
      }
      const parentId = pRows[0].parent_id

      values.push('(?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NOW())')
      params.push(
        activity_assignment_id,
        studentId,
        parentId,
        r.contribution_type,
        r.description ?? null,
        r.estimated_value == null || r.estimated_value === '' ? null : Number(r.estimated_value),
        r.hours_worked == null || r.hours_worked === '' ? null : Number(r.hours_worked)

        // materials_details goes in the next param (see below)
      )

      // push materials_details separately to keep ordering clear
      params.push(r.materials_details ?? null)
    }

    if (!values.length) {
      return res.status(400).json({
        message: 'No contributions to save',
        skipped_students_without_parent: skipped
      })
    }

    const sql = `
      INSERT INTO contributions
        (activity_assignment_id, student_id, parent_id, contribution_type,
         description, estimated_value, hours_worked, materials_details,
         verified_by, verified_at, contributed_at)
      VALUES ${values.join(', ')}
    `
    await db.query(sql, params)

    return res.status(200).json({
      message: 'Contributions saved',
      skipped_students_without_parent: skipped
    })
  } catch (err) {
    console.error('contributions bulk error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
