import bcrypt from 'bcryptjs'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { resolveSchoolYearId } from '../lib/schoolYear'
import { auditLog } from '../lib/audit'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      const syId = await resolveSchoolYearId(req)
      const { search = '', grade_id = '', section_id = '', assignment = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(500, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['u.is_deleted = 0']
      const params = [syId]

      if (search) {
        where.push('(u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)')
        params.push(`%${search}%`, `%${search}%`, `%${search}%`)
      }
      if (grade_id) {
        where.push('s.grade_id = ?')
        params.push(grade_id)
      }
      if (section_id) {
        where.push('s.id = ?')
        params.push(section_id)
      }
      if (assignment === 'assigned') where.push('ts.id IS NOT NULL')
      if (assignment === 'unassigned') where.push('ts.id IS NULL')

      const whereSql = `WHERE ${where.join(' AND ')}`

      const [countRows] = await db.query(
        `SELECT COUNT(DISTINCT u.id) AS total
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id AND r.name = 'teacher'
           LEFT JOIN teacher_sections ts
             ON ts.user_id = u.id
            AND ts.school_year_id = ?
            AND ts.is_active = 1
           LEFT JOIN sections s ON s.id = ts.section_id
          ${whereSql}`,
        params
      )

      const [rows] = await db.query(
        `SELECT
            u.id,
            u.full_name,
            u.email,
            u.username,
            ts.id AS assignment_id,
            ts.school_year_id,
            ts.section_id,
            s.name AS section_name,
            s.grade_id,
            g.name AS grade_name,
            DATE_FORMAT(ts.assigned_at, '%Y-%m-%d %H:%i:%s') AS assigned_at
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id AND r.name = 'teacher'
           LEFT JOIN teacher_sections ts
             ON ts.user_id = u.id
            AND ts.school_year_id = ?
            AND ts.is_active = 1
           LEFT JOIN sections s ON s.id = ts.section_id
           LEFT JOIN grades g ON g.id = s.grade_id
          ${whereSql}
          ORDER BY u.full_name
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      )

      return res.status(200).json({ total: countRows[0]?.total || 0, page: Number(page), page_size: limit, teachers: rows })
    }

    if (req.method === 'POST') {
      if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      const { full_name, email, username, password } = req.body || {}
      if (!full_name || !username || !password) {
        return res.status(400).json({ message: 'Full name, username, and password are required' })
      }

      const [existing] = await db.query(
        `SELECT id
           FROM users
          WHERE is_deleted = 0
            AND (username = ? OR (? IS NOT NULL AND email = ?))
          LIMIT 1`,
        [username, email || null, email || null]
      )
      if (existing.length) return res.status(409).json({ message: 'Username or email already in use' })

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        const passwordHash = await bcrypt.hash(password, 10)
        const [insertUser] = await conn.query(
          `INSERT INTO users (full_name, email, username, password_hash, is_deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, NOW(), NOW())`,
          [String(full_name).trim(), email || null, String(username).trim(), passwordHash]
        )

        const [[role]] = await conn.query("SELECT id FROM roles WHERE name = 'teacher' LIMIT 1")
        if (!role) {
          await conn.rollback()
          conn.release()

          return res.status(500).json({ message: "Role 'teacher' not found. Seed roles first." })
        }

        await conn.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [insertUser.insertId, role.id])

        await auditLog(
          {
            actorUserId: session.user.id,
            action: 'teacher.create',
            entityType: 'user',
            entityId: insertUser.insertId,
            details: { full_name, email, username, role: 'teacher' }
          },
          conn
        )

        await conn.commit()
        conn.release()

        return res.status(201).json({ id: insertUser.insertId, message: 'Teacher created' })
      } catch (err) {
        if (conn) {
          try {
            await conn.rollback()
          } catch {}
          try {
            conn.release()
          } catch {}
        }

        if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Duplicate username or email' })
        console.error('POST /api/teachers error:', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('/api/teachers error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
