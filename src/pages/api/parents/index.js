// pages/api/parents/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      // GET /api/parents?search=&page=&page_size=
      const { search = '', page = 1, page_size = 50 } = req.query
      const limit = Math.max(1, Math.min(500, Number(page_size) || 50))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['p.is_deleted = 0']
      const params = []
      if (search) {
        where.push('(p.first_name LIKE ? OR p.last_name LIKE ? OR p.contact_info LIKE ?)')
        params.push(`%${search}%`, `%${search}%`, `%${search}%`)
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
      const [count] = await db.query(`SELECT COUNT(*) AS total FROM parents p ${whereSql}`, params)
      const total = count[0].total ?? 0

      const sql = `SELECT p.id, p.first_name, p.last_name, p.contact_info FROM parents p ${whereSql} ORDER BY p.last_name, p.first_name LIMIT ? OFFSET ?`
      const [rows] = await db.query(sql, [...params, limit, offset])

      return res.status(200).json({ total, page: Number(page), page_size: limit, parents: rows })
    }

    if (req.method === 'POST') {
      const { first_name, last_name, contact_info } = req.body
      if (!first_name || !last_name) return res.status(400).json({ message: 'Missing required fields' })

      const [ins] = await db.query(
        'INSERT INTO parents (first_name, last_name, contact_info, is_deleted, created_at, updated_at) VALUES (?, ?, ?, 0, NOW(), NOW())',
        [first_name, last_name, contact_info || null]
      )

      return res.status(201).json({ id: ins.insertId })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Parents index handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
