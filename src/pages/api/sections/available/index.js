// pages/api/sections/available.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'

/**
 * GET /api/sections/available?context=teacher&teacher_id=&search=&grade_id=&page=&page_size=
 * - context=teacher: admin only; return unassigned sections + optionally include teacher_id's assigned section
 * - context=student (or omitted): return all non-deleted sections (for student assignment)
 */
export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const {
      context = 'student',
      teacher_id = null,
      search = '',
      grade_id = null,
      page = 1,
      page_size = 100
    } = req.query

    const limit = Math.max(1, Math.min(500, Number(page_size) || 100))
    const offset = (Math.max(1, Number(page) || 1) - 1) * limit

    const params = []
    const where = ['s.is_deleted = 0']

    if (search) {
      where.push('(s.name LIKE ? OR g.name LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    if (grade_id) {
      where.push('s.grade_id = ?')
      params.push(grade_id)
    }

    if (context === 'teacher') {
      // admin-only endpoint
      if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      // include teacher's current section if teacher_id passed
      const tid = teacher_id ? Number(teacher_id) : null
      const includeClause = tid ? ` OR s.id IN (SELECT section_id FROM teacher_sections WHERE user_id = ?)` : ''
      if (tid) params.push(tid)

      const whereSql = where.length
        ? 'WHERE ' +
          where.join(' AND ') +
          ` AND (s.id NOT IN (SELECT section_id FROM teacher_sections) ${includeClause})`
        : ''
      const countSql = `SELECT COUNT(*) AS total FROM sections s JOIN grades g ON g.id = s.grade_id ${whereSql}`
      const [countRows] = await db.query(countSql, params)
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT s.id, s.name AS section_name, s.grade_id, g.name AS grade_name
        FROM sections s
        JOIN grades g ON g.id = s.grade_id
        ${whereSql}
        ORDER BY g.id, s.name
        LIMIT ? OFFSET ?
      `
      const finalParams = [...params, limit, offset]
      const [rows] = await db.query(sql, finalParams)

      return res.status(200).json({ total, page: Number(page), page_size: limit, sections: rows })
    }

    // student context (any authenticated user)
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
    const countSql = `SELECT COUNT(*) AS total FROM sections s JOIN grades g ON g.id = s.grade_id ${whereSql}`
    const [countRowsAll] = await db.query(countSql, params)
    const total = countRowsAll[0]?.total ?? 0

    const sql = `
      SELECT s.id, s.name AS section_name, s.grade_id, g.name AS grade_name,
             ts.user_id AS assigned_teacher_id, u.full_name AS assigned_teacher_name
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
      assigned_teacher: r.assigned_teacher_id ? { id: r.assigned_teacher_id, full_name: r.assigned_teacher_name } : null
    }))

    return res.status(200).json({ total, page: Number(page), page_size: limit, sections })
  } catch (err) {
    console.error('GET /api/sections/available error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
