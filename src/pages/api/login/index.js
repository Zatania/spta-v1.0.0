// pages/api/login/index.js
import * as bcrypt from 'bcryptjs'
import { getCurrentSchoolYearId } from '../lib/schoolYear'
import db from '../db'

const sanitizeUser = userRow => {
  const { password_hash, ...safe } = userRow

  return safe
}

const getUserByUsername = async username => {
  const [rows] = await db.query(
    `SELECT id, username, password_hash, email, full_name, is_deleted
       FROM users
      WHERE username = ?
      LIMIT 1`,
    [username]
  )

  return rows[0] ?? null
}

const getUserRole = async userId => {
  const [rows] = await db.query(
    `SELECT r.name
       FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
      ORDER BY r.id
      LIMIT 1`,
    [userId]
  )

  return rows[0]?.name ?? null
}

const getTeacherSections = async userId => {
  const currentSyId = await getCurrentSchoolYearId()

  const [rows] = await db.query(
    `SELECT
        ts.id AS assignment_id,
        s.id,
        s.name AS section_name,
        s.name AS name,
        s.grade_id,
        g.name AS grade_name
       FROM teacher_sections ts
       JOIN sections s ON ts.section_id = s.id AND s.is_deleted = 0
       JOIN grades g ON g.id = s.grade_id
      WHERE ts.user_id = ?
        AND ts.school_year_id = ?
        AND ts.is_active = 1
      ORDER BY g.id, s.name`,
    [userId, currentSyId]
  )

  return rows
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed. Use POST.' })

  try {
    const { username, password } = req.body ?? {}

    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' })
    }

    const userRow = await getUserByUsername(username)
    if (!userRow) return res.status(401).json({ message: 'Invalid credentials' })
    if (userRow.is_deleted) return res.status(403).json({ message: 'Account is deactivated' })

    const isMatch = await bcrypt.compare(password, userRow.password_hash)
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' })

    const role = await getUserRole(userRow.id)
    const sections = role === 'teacher' ? await getTeacherSections(userRow.id) : []

    const user = sanitizeUser(userRow)
    user.role = role
    user.sections = sections

    return res.status(200).json({ user })
  } catch (err) {
    console.error('Login error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
