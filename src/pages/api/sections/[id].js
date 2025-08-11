// pages/api/sections/[id].js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db' // adjust path as needed

export default async function handler(req, res) {
  const { id } = req.query
  const sectionId = Number(id)
  if (!sectionId || Number.isNaN(sectionId)) return res.status(400).json({ message: 'Invalid section id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user || session.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden. Admins only.' })
    }

    if (req.method === 'PUT') {
      const { grade_id, name } = req.body
      if (!grade_id || !name) return res.status(400).json({ message: 'grade_id and name are required' })

      // verify section exists (even if soft-deleted, we treat as existing)
      const [srows] = await db.query('SELECT id FROM sections WHERE id = ? LIMIT 1', [sectionId])
      if (!srows.length) return res.status(404).json({ message: 'Section not found' })

      // verify grade exists
      const [grows] = await db.query('SELECT id FROM grades WHERE id = ? LIMIT 1', [grade_id])
      if (!grows.length) return res.status(400).json({ message: 'grade_id not found' })

      // check uniqueness within grade (exclude this section), only among non-deleted
      const [exists] = await db.query(
        'SELECT id FROM sections WHERE grade_id = ? AND name = ? AND id != ? AND is_deleted = 0 LIMIT 1',
        [grade_id, name, sectionId]
      )
      if (exists.length)
        return res.status(409).json({ message: 'Another section with this name exists in the selected grade' })

      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        await conn.query(
          'UPDATE sections SET grade_id = ?, name = ?, updated_at = NOW(), is_deleted = 0, deleted_at = NULL WHERE id = ?',
          [grade_id, name, sectionId]
        ) // also "undelete" if edited
        await conn.commit()
        conn.release()

        const [row] = await db.query(
          `SELECT s.id, s.name AS section_name, s.grade_id, g.name AS grade_name FROM sections s JOIN grades g ON g.id = s.grade_id WHERE s.id = ? LIMIT 1`,
          [sectionId]
        )

        return res.status(200).json({ section: row[0] })
      } catch (err) {
        await conn.rollback().catch(() => {})
        conn.release()
        if (err && err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Duplicate section name in grade' })
        }
        console.error(`PUT /api/sections/${sectionId} error:`, err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    if (req.method === 'DELETE') {
      // check blockers (students not soft-deleted, activity assignments, teacher_sections)
      const blockers = []

      const [stuRows] = await db.query('SELECT COUNT(*) AS cnt FROM students WHERE section_id = ? AND is_deleted = 0', [
        sectionId
      ])
      if (stuRows[0].cnt > 0) blockers.push({ type: 'students', count: stuRows[0].cnt })

      const [aaRows] = await db.query('SELECT COUNT(*) AS cnt FROM activity_assignments WHERE section_id = ?', [
        sectionId
      ])
      if (aaRows[0].cnt > 0) blockers.push({ type: 'activity_assignments', count: aaRows[0].cnt })

      const [tsRows] = await db.query('SELECT COUNT(*) AS cnt FROM teacher_sections WHERE section_id = ?', [sectionId])
      if (tsRows[0].cnt > 0) blockers.push({ type: 'teacher_assignments', count: tsRows[0].cnt })

      if (blockers.length) {
        return res.status(400).json({ message: 'Section cannot be deleted because it is referenced', blockers })
      }

      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        await conn.query('UPDATE sections SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [
          sectionId
        ])
        await conn.commit()
        conn.release()

        return res.status(200).json({ message: 'Section soft-deleted successfully' })
      } catch (err) {
        await conn.rollback().catch(() => {})
        conn.release()
        console.error(`DELETE /api/sections/${sectionId} error:`, err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method Not Allowed' })
  } catch (err) {
    console.error('Sections [id] handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
