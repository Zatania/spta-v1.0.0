// pages/api/sections/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db' // adjust path

/**
 * GET /api/sections
 * Query params:
 *  - search (optional) : searches section name and grade name (LIKE)
 *  - grade_id (optional)
 *  - assigned (optional) : '1' -> only sections that have a teacher, '0' -> only sections without a teacher
 *  - page (optional, default 1)
 *  - page_size (optional, default 25)
 *
 * Returns:
 *  { total, page, page_size, sections: [ { id, section_name, grade_id, grade_name, assigned (0/1), assigned_teacher: { id, full_name } | null } ] }
 */
export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    // Handle adding a section
    if (req.method === 'POST') {
      // Optional: restrict to admin only
      // if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      const { name, grade_id } = req.body
      if (!name || !grade_id) {
        return res.status(400).json({ message: 'Missing name or grade_id' })
      }

      // Insert into DB
      const insertSql = `
        INSERT INTO sections (name, grade_id, is_deleted)
        VALUES (?, ?, 0)
      `
      try {
        const [result] = await db.query(insertSql, [name, grade_id])

        return res.status(201).json({
          id: result.insertId,
          name,
          grade_id
        })
      } catch (dbErr) {
        console.error('POST /api/sections insert error:', dbErr)

        return res.status(500).json({ message: 'Failed to add section' })
      }
    }

    // Handle fetching sections (GET)
    if (req.method === 'GET') {
      const { search = '', grade_id = null, assigned = null, page = 1, page_size = 25 } = req.query

      const limit = Math.max(1, Math.min(500, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['s.is_deleted = 0']
      const params = []

      if (grade_id) {
        where.push('s.grade_id = ?')
        params.push(grade_id)
      }

      if (search) {
        where.push('(s.name LIKE ? OR g.name LIKE ?)')
        params.push(`%${search}%`, `%${search}%`)
      }

      if (assigned === '1') {
        where.push('s.id IN (SELECT section_id FROM teacher_sections)')
      } else if (assigned === '0') {
        where.push('s.id NOT IN (SELECT section_id FROM teacher_sections)')
      }

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      const countSql = `
        SELECT COUNT(*) AS total
        FROM sections s
        JOIN grades g ON g.id = s.grade_id
        ${whereSql}
      `
      const [countRows] = await db.query(countSql, params)
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT
          s.id,
          s.name AS section_name,
          s.grade_id,
          g.name AS grade_name,
          CASE WHEN ts.user_id IS NULL THEN 0 ELSE 1 END AS assigned,
          u.id AS assigned_teacher_id,
          u.full_name AS assigned_teacher_name
        FROM sections s
        JOIN grades g ON g.id = s.grade_id
        LEFT JOIN teacher_sections ts ON ts.section_id = s.id
        LEFT JOIN users u ON u.id = ts.user_id AND u.is_deleted = 0
        ${whereSql}
        GROUP BY s.id
        ORDER BY g.id, s.name
        LIMIT ? OFFSET ?
      `
      const finalParams = [...params, limit, offset]
      const [rows] = await db.query(sql, finalParams)

      const sections = rows.map(r => ({
        id: r.id,
        section_name: r.section_name,
        grade_id: r.grade_id,
        grade_name: r.grade_name,
        assigned: Number(r.assigned),
        assigned_teacher: r.assigned_teacher_id
          ? { id: r.assigned_teacher_id, full_name: r.assigned_teacher_name }
          : null
      }))

      return res.status(200).json({ total, page: Number(page), page_size: limit, sections })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('API /api/sections error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
