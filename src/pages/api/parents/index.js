// pages/api/parents/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      // Get parents for dropdown / search with pagination
      const { search = '', page = 1, page_size = 100 } = req.query
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const limit = Math.max(1, Math.min(1000, parseInt(page_size, 10) || 100))
      const offset = (pageNum - 1) * limit

      const where = ['p.is_deleted = 0']
      const params = []

      if (search && search.trim() !== '') {
        const s = `%${search.trim()}%`
        where.push(
          '(p.first_name LIKE ? OR p.last_name LIKE ? OR CONCAT(p.first_name," ",p.last_name) LIKE ? OR p.contact_info LIKE ?)'
        )
        params.push(s, s, s, s)
      }

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      // total count for pagination
      const countSql = `SELECT COUNT(DISTINCT p.id) AS total FROM parents p ${whereSql}`
      const [countRows] = await db.query(countSql, params)
      const total = countRows?.[0]?.total ?? 0

      const sql = `
        SELECT
          p.id,
          p.first_name,
          p.last_name,
          p.contact_info,
          -- Concatenate relation(s) if any (DISTINCT)
          GROUP_CONCAT(DISTINCT COALESCE(sp.relation, '') SEPARATOR ',') AS relations,
          COUNT(DISTINCT sp.student_id) AS student_count
        FROM parents p
        LEFT JOIN student_parents sp ON sp.parent_id = p.id
        ${whereSql}
        GROUP BY p.id, p.first_name, p.last_name, p.contact_info
        ORDER BY p.last_name, p.first_name
        LIMIT ? OFFSET ?
      `
      const finalParams = [...params, limit, offset]
      const [rows] = await db.query(sql, finalParams)

      // normalize relations to array (if needed by UI)
      const parents = rows.map(r => ({
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        contact_info: r.contact_info,
        relations: r.relations ? r.relations.split(',').filter(Boolean) : [],
        student_count: Number(r.student_count || 0)
      }))

      return res.status(200).json({
        parents,
        pagination: {
          page: pageNum,
          page_size: limit,
          total: Number(total),
          total_pages: Math.ceil(total / limit)
        }
      })
    }

    if (req.method === 'POST') {
      // Create new parent
      const { first_name, last_name, contact_info = '' } = req.body

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
