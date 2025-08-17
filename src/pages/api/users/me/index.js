// pages/api/users/me.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import bcrypt from 'bcryptjs'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const userId = session.user.id

    if (req.method === 'GET') {
      const [rows] = await db.query('SELECT id, username, full_name, email FROM users WHERE id = ? LIMIT 1', [userId])
      if (!rows.length) return res.status(404).json({ message: 'User not found' })

      return res.status(200).json({ user: rows[0] })
    }

    if (req.method === 'PUT') {
      const { username, email, full_name, currentPassword, newPassword } = req.body || {}

      // Prepare field error container
      const errors = {}

      // Basic required validation
      if (!username || String(username).trim().length === 0) {
        errors.username = 'Username is required'
      }
      if (!email || String(email).trim().length === 0) {
        errors.email = 'Email is required'
      }

      if (Object.keys(errors).length) {
        return res.status(400).json({ message: 'Validation error', errors })
      }

      // Check uniqueness of username
      const [uRows] = await db.query('SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1', [username, userId])
      if (uRows.length) {
        errors.username = 'Username already taken'
      }

      // Check uniqueness of email (if provided)
      if (email) {
        const [eRows] = await db.query('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [email, userId])
        if (eRows.length) {
          errors.email = 'Email already in use'
        }
      }

      if (Object.keys(errors).length) {
        return res.status(409).json({ message: 'Conflict', errors })
      }

      // If changing password, validate currentPassword
      let passwordHashToSave = null
      if (newPassword && newPassword.length > 0) {
        if (!currentPassword || currentPassword.length === 0) {
          errors.currentPassword = 'Current password is required to change password'

          return res.status(400).json({ message: 'Validation error', errors })
        }

        // Get current password hash
        const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [userId])
        if (!rows.length) return res.status(404).json({ message: 'User not found' })
        const currentHash = rows[0].password_hash || ''
        const valid = await bcrypt.compare(currentPassword, currentHash)
        if (!valid) {
          errors.currentPassword = 'Current password is incorrect'

          return res.status(403).json({ message: 'Authentication error', errors })
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10)
        passwordHashToSave = await bcrypt.hash(newPassword, salt)
      }

      // Build update query
      const fields = ['username = ?', 'email = ?', 'full_name = ?']
      const params = [username, email, full_name]

      if (passwordHashToSave) {
        fields.push('password_hash = ?')
        params.push(passwordHashToSave)
      }

      params.push(userId)

      const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`
      await db.query(sql, params)

      // Return updated user
      const [updatedRows] = await db.query('SELECT id, username, full_name, email FROM users WHERE id = ? LIMIT 1', [
        userId
      ])

      return res.status(200).json({ user: updatedRows[0], message: 'Updated' })
    }

    res.setHeader('Allow', ['GET', 'PUT'])

    return res.status(405).end(`Method ${req.method} Not Allowed`)
  } catch (err) {
    console.error('API /api/users/me error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
