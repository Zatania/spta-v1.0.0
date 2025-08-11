// pages/api/students/[id].js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  const { id } = req.query
  const studentId = Number(id)
  if (!studentId || Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      // teacher check: only allowed if student in teacher's section
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          'SELECT 1 FROM students st JOIN teacher_sections ts ON ts.section_id = st.section_id WHERE st.id = ? AND ts.user_id = ? LIMIT 1',
          [studentId, session.user.id]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      }

      const [rows] = await db.query(
        'SELECT st.id, st.first_name, st.last_name, st.lrn, st.grade_id, st.section_id, g.name AS grade_name, s.name AS section_name FROM students st LEFT JOIN grades g ON g.id = st.grade_id LEFT JOIN sections s ON s.id = st.section_id WHERE st.id = ? AND st.is_deleted = 0 LIMIT 1',
        [studentId]
      )
      if (!rows.length) return res.status(404).json({ message: 'Student not found' })
      const student = rows[0]

      const [parents] = await db.query(
        'SELECT p.id, p.first_name, p.last_name, p.contact_info, sp.relation FROM parents p JOIN student_parents sp ON sp.parent_id = p.id WHERE sp.student_id = ? AND p.is_deleted = 0',
        [studentId]
      )
      student.parents = parents

      return res.status(200).json(student)
    }

    if (req.method === 'PUT') {
      const { first_name, last_name, lrn, grade_id, section_id, parents = [] } = req.body
      if (!first_name || !last_name || !lrn || !grade_id || !section_id)
        return res.status(400).json({ message: 'Missing required fields' })

      // verify section exists & matches grade
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        section_id
      ])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found or deleted' })
      if (String(secRows[0].grade_id) !== String(grade_id))
        return res.status(400).json({ message: 'Section does not belong to grade' })

      // teacher restriction: can only edit students in their assigned sections
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          'SELECT 1 FROM students st JOIN teacher_sections ts ON ts.section_id = st.section_id WHERE st.id = ? AND ts.user_id = ? LIMIT 1',
          [studentId, session.user.id]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      }

      // LRN uniqueness excluding this student
      const [lrnCheck] = await db.query(
        'SELECT id FROM students WHERE lrn = ? AND id != ? AND is_deleted = 0 LIMIT 1',
        [lrn, studentId]
      )
      if (lrnCheck.length) return res.status(409).json({ message: 'LRN already in use' })

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        await conn.query(
          'UPDATE students SET first_name = ?, last_name = ?, lrn = ?, grade_id = ?, section_id = ?, updated_at = NOW() WHERE id = ?',
          [first_name, last_name, lrn, grade_id, section_id, studentId]
        )

        // replace parent links: remove present links and recreate
        await conn.query('DELETE FROM student_parents WHERE student_id = ?', [studentId])
        for (const p of parents) {
          if (p.id) {
            const [prow] = await conn.query('SELECT id FROM parents WHERE id = ? AND is_deleted = 0 LIMIT 1', [p.id])
            if (!prow.length) {
              await conn.rollback()

              return res.status(400).json({ message: `Parent id ${p.id} not found` })
            }
            await conn.query('INSERT INTO student_parents (student_id, parent_id, relation) VALUES (?, ?, ?)', [
              studentId,
              p.id,
              p.relation || null
            ])
          } else {
            const [newP] = await conn.query(
              'INSERT INTO parents (first_name, last_name, contact_info, is_deleted, created_at, updated_at) VALUES (?, ?, ?, 0, NOW(), NOW())',
              [p.first_name, p.last_name, p.contact_info || null]
            )
            await conn.query('INSERT INTO student_parents (student_id, parent_id, relation) VALUES (?, ?, ?)', [
              studentId,
              newP.insertId,
              p.relation || null
            ])
          }
        }

        await conn.commit()
        conn.release()

        return res.status(200).json({ message: 'Student updated' })
      } catch (err) {
        if (conn) {
          await conn.rollback().catch(() => {})
          conn.release().catch(() => {})
        }
        console.error('Update student error', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    if (req.method === 'DELETE') {
      // teachers can only delete their students
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          'SELECT 1 FROM students st JOIN teacher_sections ts ON ts.section_id = st.section_id WHERE st.id = ? AND ts.user_id = ? LIMIT 1',
          [studentId, session.user.id]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      }
      await db.query('UPDATE students SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [studentId])

      return res.status(200).json({ message: 'Student soft-deleted' })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Students [id] handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
