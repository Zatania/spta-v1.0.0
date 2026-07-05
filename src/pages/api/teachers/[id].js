import bcrypt from 'bcryptjs'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { auditLog } from '../lib/audit'

export default async function handler(req, res) {
  const teacherId = Number(req.query.id)
  if (!Number.isInteger(teacherId) || teacherId <= 0) return res.status(400).json({ message: 'Invalid teacher id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    const [[teacher]] = await db.query(
      `SELECT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.name = 'teacher'
        WHERE u.id = ? AND u.is_deleted = 0
        LIMIT 1`,
      [teacherId]
    )
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' })

    if (req.method === 'PUT') {
      const { full_name, email, username, password } = req.body || {}
      if (!full_name || !username) return res.status(400).json({ message: 'Full name and username are required' })

      const [existing] = await db.query(
        `SELECT id
           FROM users
          WHERE id <> ?
            AND is_deleted = 0
            AND (username = ? OR (? IS NOT NULL AND email = ?))
          LIMIT 1`,
        [teacherId, username, email || null, email || null]
      )
      if (existing.length) return res.status(409).json({ message: 'Username or email already in use' })

      if (password && String(password).trim()) {
        const passwordHash = await bcrypt.hash(password, 10)
        await db.query(
          `UPDATE users
              SET full_name = ?, email = ?, username = ?, password_hash = ?, updated_at = NOW()
            WHERE id = ?`,
          [String(full_name).trim(), email || null, String(username).trim(), passwordHash, teacherId]
        )
      } else {
        await db.query(
          `UPDATE users
              SET full_name = ?, email = ?, username = ?, updated_at = NOW()
            WHERE id = ?`,
          [String(full_name).trim(), email || null, String(username).trim(), teacherId]
        )
      }

      await auditLog({
        actorUserId: session.user.id,
        action: 'teacher.update_profile',
        entityType: 'user',
        entityId: teacherId,
        details: { full_name, email, username, password_changed: !!password }
      })

      return res.status(200).json({ message: 'Teacher profile updated' })
    }

    if (req.method === 'DELETE') {
      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        await conn.query('UPDATE users SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [teacherId])
        await conn.query(
          `UPDATE teacher_sections
              SET is_active = 0, unassigned_at = NOW()
            WHERE user_id = ?
              AND is_active = 1`,
          [teacherId]
        )

        await auditLog(
          {
            actorUserId: session.user.id,
            action: 'teacher.deactivate',
            entityType: 'user',
            entityId: teacherId
          },
          conn
        )

        await conn.commit()
        conn.release()

        return res.status(200).json({ message: 'Teacher deactivated and active assignments removed' })
      } catch (err) {
        if (conn) {
          try {
            await conn.rollback()
          } catch {}
          try {
            conn.release()
          } catch {}
        }
        console.error(`DELETE /api/teachers/${teacherId} error:`, err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error(`/api/teachers/${teacherId} error:`, err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
