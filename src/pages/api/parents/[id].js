// pages/api/parents/[id].js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import { resolveSchoolYearId } from '../lib/schoolYear'
import { auditLog } from '../lib/audit'
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
      const currentSyId = await resolveSchoolYearId(req)

      const [students] = await db.query(
        `SELECT
            st.id,
            st.first_name,
            st.last_name,
            st.lrn,
            en.grade_id,
            en.section_id,
            g.name AS grade_name,
            sec.name AS section_name,
            sp.relation
        FROM students st
        JOIN student_parents sp ON sp.student_id = st.id
        JOIN student_enrollments en
          ON en.student_id = st.id
          AND en.school_year_id = ?
        LEFT JOIN grades g ON g.id = en.grade_id
        LEFT JOIN sections sec ON sec.id = en.section_id
        WHERE sp.parent_id = ?
          AND st.is_deleted = 0
        ORDER BY st.last_name, st.first_name`,
        [currentSyId, parentId]
      )
      const parent = rows[0]
      parent.students = students

      return res.status(200).json(parent)
    }

    if (req.method === 'PUT') {
      if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      const { first_name, last_name, contact_info } = req.body
      if (!first_name || !last_name) return res.status(400).json({ message: 'Missing required fields' })
      await db.query(
        'UPDATE parents SET first_name = ?, last_name = ?, contact_info = ?, updated_at = NOW() WHERE id = ?',
        [first_name, last_name, contact_info || null, parentId]
      )

      await auditLog({ actorUserId: session.user.id, action: 'parent.update', entityType: 'parent', entityId: parentId, details: { first_name, last_name, contact_info } })

      return res.status(200).json({ message: 'Parent updated' })
    }

    if (req.method === 'DELETE') {
      if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      const [[linked]] = await db.query(
        `SELECT COUNT(*) AS count
           FROM student_parents sp
           JOIN students st ON st.id = sp.student_id AND st.is_deleted = 0
          WHERE sp.parent_id = ?`,
        [parentId]
      )
      if (Number(linked.count) > 0 && req.query.force !== '1') {
        return res.status(400).json({ message: 'Parent is linked to active students. Use force=1 to confirm soft delete.', linked_students: Number(linked.count) })
      }

      await db.query('UPDATE parents SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [parentId])
      await auditLog({ actorUserId: session.user.id, action: 'parent.delete', entityType: 'parent', entityId: parentId, details: { force: req.query.force === '1', linked_students: Number(linked.count) } })

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
