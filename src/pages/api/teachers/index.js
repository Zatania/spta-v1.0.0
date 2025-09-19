// pages/api/teachers/index.js
import bcrypt from 'bcryptjs'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { getCurrentSchoolYearId } from '../lib/schoolYear' // ensure this path exists

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      // LIST (supports search + filters + pagination) — scoped to current SY
      const { search = '', grade_id = '', section_id = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(500, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const currentSyId = await getCurrentSchoolYearId()

      const where = ['u.is_deleted = 0']
      const params = []

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

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      const countSql = `
        SELECT COUNT(DISTINCT u.id) AS total
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id AND r.name = 'teacher'
        LEFT JOIN teacher_sections ts
          ON ts.user_id = u.id AND ts.school_year_id = ?
        LEFT JOIN sections s
          ON s.id = ts.section_id
        ${whereSql}
      `
      const [countRows] = await db.query(countSql, [currentSyId, ...params])
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT DISTINCT
          u.id, u.full_name, u.email, u.username,
          s.id AS section_id, s.name AS section_name, s.grade_id,
          g.name AS grade_name
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id AND r.name = 'teacher'
        LEFT JOIN teacher_sections ts
          ON ts.user_id = u.id AND ts.school_year_id = ?
        LEFT JOIN sections s
          ON s.id = ts.section_id
        LEFT JOIN grades g
          ON g.id = s.grade_id
        ${whereSql}
        ORDER BY u.full_name
        LIMIT ? OFFSET ?
      `
      const [rows] = await db.query(sql, [currentSyId, ...params, limit, offset])

      return res.status(200).json({ total, page: Number(page), page_size: limit, teachers: rows })
    }

    if (req.method === 'POST') {
      // CREATE new teacher (admin-only) — assign section for current SY
      if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      const { full_name, email, username, password, grade_id, section_id } = req.body
      if (!full_name || !email || !username || !password || !grade_id || !section_id) {
        return res.status(400).json({ message: 'Missing required fields' })
      }

      const currentSyId = await getCurrentSchoolYearId()

      // Unique username/email
      const [existing] = await db.query(
        'SELECT id FROM users WHERE (username = ? OR email = ?) AND is_deleted = 0 LIMIT 1',
        [username, email]
      )
      if (existing.length) return res.status(409).json({ message: 'Username or email already in use' })

      // Verify section exists & matches grade
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        section_id
      ])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found or deleted' })
      if (String(secRows[0].grade_id) !== String(grade_id)) {
        return res.status(400).json({ message: 'Section does not belong to the given grade' })
      }

      // Ensure section isn’t assigned for this school year
      const [secAssigned] = await db.query(
        'SELECT user_id FROM teacher_sections WHERE section_id = ? AND school_year_id = ? LIMIT 1',
        [section_id, currentSyId]
      )
      if (secAssigned.length) return res.status(400).json({ message: 'Section already assigned (current SY)' })

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        // Create user
        const password_hash = await bcrypt.hash(password, 10)

        const [insUser] = await conn.query(
          'INSERT INTO users (full_name, email, username, password_hash, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NOW(), NOW())',
          [full_name, email, username, password_hash]
        )
        const userId = insUser.insertId

        // Ensure teacher role exists
        const [roleRows] = await conn.query("SELECT id FROM roles WHERE name = 'teacher' LIMIT 1")
        if (!roleRows.length) {
          await conn.rollback()
          try {
            conn.release()
          } catch {}

          return res.status(500).json({ message: "Role 'teacher' not found" })
        }
        const roleId = roleRows[0].id

        await conn.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId])

        // Year-aware assignment
        await conn.query('INSERT INTO teacher_sections (user_id, section_id, school_year_id) VALUES (?, ?, ?)', [
          userId,
          section_id,
          currentSyId
        ])

        await conn.commit()
        try {
          conn.release()
        } catch {}

        return res.status(201).json({ id: userId, full_name, email, username, section_id, school_year_id: currentSyId })
      } catch (err) {
        // Safe cleanup (no .catch() chaining on release)
        try {
          if (conn) await conn.rollback()
        } catch {}
        try {
          if (conn) conn.release()
        } catch {}
        if (err?.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Duplicate entry' })
        }
        console.error('POST /api/teachers error:', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Teachers index error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
