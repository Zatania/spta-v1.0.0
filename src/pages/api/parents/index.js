// pages/api/parents/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      // Get all non-deleted parents for dropdown selection
      const { search = '', page = 1, page_size = 1000 } = req.query
      const limit = Math.max(1, Math.min(1000, Number(page_size) || 1000))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['p.is_deleted = 0']
      const params = []

      if (search) {
        where.push(
          '(p.first_name LIKE ? OR p.last_name LIKE ? OR CONCAT(p.first_name," ",p.last_name) LIKE ? OR p.contact_info LIKE ?)'
        )
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
      }

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      const sql = `
        SELECT p.id, p.first_name, p.last_name, p.contact_info, sp.relation,
               COUNT(sp.student_id) as student_count
        FROM parents p
        LEFT JOIN student_parents sp ON sp.parent_id = p.id
        ${whereSql}
        GROUP BY p.id, p.first_name, p.last_name, p.contact_info, sp.relation
        ORDER BY p.last_name, p.first_name
        LIMIT ? OFFSET ?
      `
      const finalParams = [...params, limit, offset]
      const [rows] = await db.query(sql, finalParams)

      return res.status(200).json(rows)
    }

    if (req.method === 'POST') {
      // Create new parent
      const { first_name, last_name, contact_info = '', relation = '' } = req.body

      if (!first_name || !last_name) {
        return res.status(400).json({ message: 'First name and last name are required' })
      }

      try {
        const [result] = await db.query(
          'INSERT INTO parents (first_name, last_name, contact_info, is_deleted, created_at, updated_at) VALUES (?, ?, ?, 0, NOW(), NOW())',
          [first_name, last_name, contact_info]
        )

        return res.status(201).json({
          id: result.insertId,
          message: 'Parent created successfully'
        })
      } catch (err) {
        console.error('Create parent error', err)

        return res.status(500).json({ message: 'Failed to create parent' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Parents handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
