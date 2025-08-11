// pages/api/login.js
import * as bcrypt from 'bcryptjs'
import db from '../db' // adjust path to your DB helper

/**
 * POST /api/login
 * Body: { username, password }
 *
 * - Authenticates against `users.password_hash`
 * - Ensures user.is_deleted = 0
 * - Loads single role from user_roles -> roles
 * - If role = 'teacher', also loads assigned sections from teacher_sections -> sections
 * - Returns sanitized user object (no password hash)
 */

const sanitizeUser = userRow => {
  const { password_hash, ...safe } = userRow

  return safe
}

const getUserByUsername = async username => {
  const sql = `
    SELECT id, username, password_hash, email, full_name, is_deleted
    FROM users
    WHERE username = ?
    LIMIT 1
  `
  const [rows] = await db.query(sql, [username])

  return rows[0] ?? null
}

const getUserRole = async userId => {
  const sql = `
    SELECT r.name
    FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
    LIMIT 1
  `
  const [rows] = await db.query(sql, [userId])

  return rows[0]?.name ?? null
}

const getTeacherSections = async userId => {
  const sql = `
    SELECT s.id, s.name AS section_name, s.grade_id
    FROM teacher_sections ts
    JOIN sections s ON ts.section_id = s.id
    WHERE ts.user_id = ?
  `
  const [rows] = await db.query(sql, [userId])

  return rows
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed. Use POST.' })
  }

  try {
    const { username, password } = req.body ?? {}

    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' })
    }

    // 1) Get user row
    const userRow = await getUserByUsername(username)
    if (!userRow) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    if (userRow.is_deleted) {
      return res.status(403).json({ message: 'Account is deactivated' })
    }

    // 2) Verify password
    const isMatch = await bcrypt.compare(password, userRow.password_hash)
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    // 3) Load single role
    const role = await getUserRole(userRow.id)

    // 4) If teacher, load sections
    let sections = []
    if (role === 'teacher') {
      sections = await getTeacherSections(userRow.id)
    }

    // 5) Build safe user object
    const user = sanitizeUser(userRow)
    user.role = role
    if (sections.length) user.sections = sections

    return res.status(200).json({ user })
  } catch (err) {
    console.error('Login error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
