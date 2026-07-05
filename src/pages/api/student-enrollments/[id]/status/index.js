// pages/api/student-enrollments/[id]/status.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../auth/[...nextauth]'
import db from '../../../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

    const enrollmentId = req.query.id
    if (!enrollmentId) return res.status(400).json({ message: 'Missing enrollment id' })

    const { status, completion_school_year_id, completion_grade_id, completion_section_id } = req.body || {}

    const allowed = new Set(['retained', 'withdrawn', 'transferred', 'completed'])
    if (!allowed.has(status)) return res.status(400).json({ message: 'Invalid status' })

    // Fetch enrollment to validate permissions and get current info
    const [rows] = await db.query(
      `SELECT en.id, en.student_id, en.school_year_id, en.grade_id, en.section_id,
                 g.name AS grade_name
            FROM student_enrollments en
            JOIN grades g ON g.id = en.grade_id
           WHERE en.id = ?
           LIMIT 1`,
      [enrollmentId]
    )
    if (!rows.length) return res.status(404).json({ message: 'Enrollment not found' })

    const en = rows[0]

    // Teachers can only update if they are actively assigned to that section in the same SY
    if (session.user.role === 'teacher') {
      const [ok] = await db.query(
        `SELECT 1
           FROM teacher_sections
          WHERE user_id = ?
            AND section_id = ?
            AND school_year_id = ?
           AND is_active = 1
          LIMIT 1`,
        [session.user.id, en.section_id, en.school_year_id]
      )
      if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
    }

    // Validate completion fields if needed
    let compSyId = null,
      compGradeId = null,
      compSecId = null

    if (status === 'completed') {
      // 1) Only Grade 6 enrollments can be completed (graduation)
      //    You can also check by grade name if IDs vary: g.name = 'Grade 6'
      //    If you prefer checking by ID, query Grade 6 ID once and compare.
      if (!/6\b/.test(en.grade_name)) {
        return res.status(400).json({ message: 'Only Grade 6 students can be marked as Completed (graduated).' })
      }

      // If client didn’t send these, default to the current enrollment’s values
      const compSyBody = completion_school_year_id || en.school_year_id
      const compGradeBody = completion_grade_id || en.grade_id
      const compSecBody = completion_section_id || en.section_id

      // Ensure SY exists
      const [sy] = await db.query('SELECT id FROM school_years WHERE id = ? LIMIT 1', [compSyBody])
      if (!sy.length) return res.status(400).json({ message: 'Completion School Year not found' })

      // Ensure Grade exists
      const [gr] = await db.query('SELECT id FROM grades WHERE id = ? LIMIT 1', [compGradeBody])
      if (!gr.length) return res.status(400).json({ message: 'Completion Grade Level not found' })

      // Enforce that completion grade is Grade 6 (graduation)
      const [g6] = await db.query("SELECT id FROM grades WHERE name = 'Grade 6' LIMIT 1")
      if (!g6.length || String(gr[0].id) !== String(g6[0].id)) {
        return res.status(400).json({ message: 'Completion Grade Level must be Grade 6.' })
      }

      // Section is optional, but if provided, check it belongs to the grade
      if (compSecBody) {
        const [sec] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
          compSecBody
        ])
        if (!sec.length) return res.status(400).json({ message: 'Completion Section not found or deleted' })
        if (String(sec[0].grade_id) !== String(compGradeBody)) {
          return res.status(400).json({ message: 'Completion Section does not belong to the selected Grade' })
        }
        compSecId = compSecBody
      }

      compSyId = compSyBody
      compGradeId = compGradeBody

      // 2) Optional: block completion if a next-SY enrollment already exists
      const [nx] = await db.query(
        'SELECT 1 FROM student_enrollments WHERE student_id = ? AND school_year_id > ? LIMIT 1',
        [en.student_id, en.school_year_id]
      )
      if (nx.length) {
        return res
          .status(400)
          .json({ message: 'Next school year enrollment already exists. Remove it before marking Completed.' })
      }
    }

    // Do the update
    await db.query(
      `UPDATE student_enrollments
          SET status = ?,
              completion_school_year_id = ?,
              completion_grade_id = ?,
              completion_section_id = ?
        WHERE id = ?`,
      [
        status,
        status === 'completed' ? compSyId : null,
        status === 'completed' ? compGradeId : null,
        status === 'completed' ? compSecId : null,
        enrollmentId
      ]
    )

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Set status error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
