// pages/api/teachers/[id].js
import bcrypt from 'bcryptjs'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

/**
 * PUT /api/teachers/:id
 *   body: { full_name, email, username, password? (optional), grade_id, section_id }
 * DELETE /api/teachers/:id  (soft-delete)
 *
 * Admin-only for update/delete
 */
export default async function handler(req, res) {
  const { id } = req.query
  const teacherId = Number(id)
  if (!teacherId || Number.isNaN(teacherId)) return res.status(400).json({ message: 'Invalid teacher id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    if (req.method === 'PUT') {
      const { full_name, email, username, password, grade_id, section_id } = req.body
      if (!full_name || !email || !username || !grade_id || !section_id) {
        return res.status(400).json({ message: 'Missing required fields' })
      }

      // Verify teacher exists
      const [uRows] = await db.query(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ? AND r.name = 'teacher' AND u.is_deleted = 0 LIMIT 1`,
        [teacherId]
      )
      if (!uRows.length) return res.status(404).json({ message: 'Teacher not found' })

      // uniqueness checks
      const [existing] = await db.query(
        'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ? AND is_deleted = 0 LIMIT 1',
        [username, email, teacherId]
      )
      if (existing.length) return res.status(409).json({ message: 'Username or email already used' })

      // verify section exists and not deleted
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        section_id
      ])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found or deleted' })
      if (String(secRows[0].grade_id) !== String(grade_id)) {
        return res.status(400).json({ message: 'Section does not belong to the given grade' })
      }

      // check section not assigned to someone else
      const [secAssign] = await db.query(
        'SELECT user_id FROM teacher_sections WHERE section_id = ? AND user_id != ? LIMIT 1',
        [section_id, teacherId]
      )
      if (secAssign.length) return res.status(400).json({ message: 'Section already assigned to another teacher' })

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        if (password && String(password).trim().length > 0) {
          const password_hash = await bcrypt.hash(password, 10)
          await conn.query(
            'UPDATE users SET full_name = ?, email = ?, username = ?, password_hash = ?, updated_at = NOW() WHERE id = ?',
            [full_name, email, username, password_hash, teacherId]
          )
        } else {
          await conn.query('UPDATE users SET full_name = ?, email = ?, username = ?, updated_at = NOW() WHERE id = ?', [
            full_name,
            email,
            username,
            teacherId
          ])
        }

        // Reassign teacher_sections: delete existing mapping(s), insert new one
        await conn.query('DELETE FROM teacher_sections WHERE user_id = ?', [teacherId])
        await conn.query('INSERT INTO teacher_sections (user_id, section_id) VALUES (?, ?)', [teacherId, section_id])

        await conn.commit()
        conn.release()

        return res.status(200).json({ message: 'Teacher updated' })
      } catch (err) {
        if (conn) {
          await conn.rollback().catch(() => {})
          conn.release().catch(() => {})
        }
        console.error(`PUT /api/teachers/${teacherId} error:`, err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    if (req.method === 'DELETE') {
      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        // 1. Soft delete teacher
        await conn.query('UPDATE users SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [teacherId])
        await conn.query('DELETE FROM user_roles WHERE user_id = ?', [teacherId])
        await conn.query('DELETE FROM teacher_sections WHERE user_id = ?', [teacherId])

        // 2. Find all activities created by this teacher
        const [activities] = await conn.query('SELECT id FROM activities WHERE created_by = ? AND is_deleted = 0', [
          teacherId
        ])
        const activityIds = activities.map(a => a.id)

        if (activityIds.length > 0) {
          // 2a. Delete assignments linked to those activities
          await conn.query('DELETE FROM activity_assignments WHERE activity_id IN (?)', [activityIds])

          // 2b. Soft delete the activities
          await conn.query('UPDATE activities SET is_deleted = 1, deleted_at = NOW() WHERE id IN (?)', [activityIds])
        }

        await conn.commit()
        conn.release()

        return res.status(200).json({ message: 'Teacher and related activities soft-deleted' })
      } catch (err) {
        if (conn) {
          try {
            await conn.rollback()
          } catch (_) {}
          try {
            conn.release()
          } catch (_) {}
        }

        console.error(`DELETE /api/teachers/${teacherId} error:`, err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Teachers [id] handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
