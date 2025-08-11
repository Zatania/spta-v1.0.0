// pages/api/parents/[id].js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  const { id } = req.query
  const parentId = Number(id)
  if (!parentId || Number.isNaN(parentId)) return res.status(400).json({ message: 'Invalid parent id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      const [rows] = await db.query(
        'SELECT id, first_name, last_name, contact_info FROM parents WHERE id = ? AND is_deleted = 0 LIMIT 1',
        [parentId]
      )
      if (!rows.length) return res.status(404).json({ message: 'Parent not found' })

      // also list their students
      const [students] = await db.query(
        `SELECT st.id, st.first_name, st.last_name, st.lrn, st.grade_id, st.section_id
         FROM students st
         JOIN student_parents sp ON sp.student_id = st.id
         WHERE sp.parent_id = ? AND st.is_deleted = 0`,
        [parentId]
      )
      const parent = rows[0]
      parent.students = students

      return res.status(200).json(parent)
    }

    if (req.method === 'PUT') {
      const { first_name, last_name, contact_info } = req.body
      if (!first_name || !last_name) return res.status(400).json({ message: 'Missing required fields' })
      await db.query(
        'UPDATE parents SET first_name = ?, last_name = ?, contact_info = ?, updated_at = NOW() WHERE id = ?',
        [first_name, last_name, contact_info || null, parentId]
      )

      return res.status(200).json({ message: 'Parent updated' })
    }

    if (req.method === 'DELETE') {
      // soft delete
      await db.query('UPDATE parents SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [parentId])

      // you may also want to remove student_parents links, but keeping links may be useful historically; optionally remove:
      // await db.query('DELETE FROM student_parents WHERE parent_id = ?', [parentId])
      return res.status(200).json({ message: 'Parent soft-deleted' })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Parents [id] handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
