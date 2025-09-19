// pages/api/sections/available.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { getCurrentSchoolYearId } from '../../lib/schoolYear'

/**
 * GET /api/sections/available?context=teacher&teacher_id=&search=&grade_id=&page=&page_size=
 * - context=teacher: admin only; return sections UNASSIGNED for current SY,
 *   plus (if teacher_id provided) include the section currently assigned to that teacher.
 * - context=student (or omitted): return ALL non-deleted sections with the teacher assigned
 *   for the current SY (or null if none).
 *
 * Notes:
 * - Year-aware via school_years.is_current=1
 * - Avoids only_full_group_by issues (no illegal GROUP BY).
 */
export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method !== 'GET') {
      return res.status(405).json({ message: 'Method not allowed' })
    }

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

    const currentSyId = await getCurrentSchoolYearId()

    // Common filters
    const where = ['s.is_deleted = 0']
    const params = []

    if (search) {
      where.push('(s.name LIKE ? OR g.name LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    if (grade_id) {
      where.push('s.grade_id = ?')
      params.push(grade_id)
    }

    if (context === 'teacher') {
      // admin-only
      if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      // We want: sections that are unassigned in current SY,
      // plus (if teacher_id given) the section that this teacher currently holds (to allow keep/replace).
      const tid = teacher_id ? Number(teacher_id) : null

      // Unassigned this SY OR assigned to this teacher (this SY)
      // Use NOT EXISTS to avoid only_full_group_by traps and respect unique (section_id, school_year_id).
      const teacherFilterSql = tid
        ? `NOT EXISTS (
             SELECT 1 FROM teacher_sections tsx
             WHERE tsx.section_id = s.id
               AND tsx.school_year_id = ?
               AND tsx.user_id <> ?
           )`
        : `NOT EXISTS (
             SELECT 1 FROM teacher_sections tsx
             WHERE tsx.section_id = s.id
               AND tsx.school_year_id = ?
           )`

      const whereSql = 'WHERE ' + [...where, teacherFilterSql].join(' AND ')

      // COUNT
      const countSql = `
        SELECT COUNT(*) AS total
        FROM sections s
        JOIN grades g ON g.id = s.grade_id
        ${whereSql}
      `
      const countParams = tid ? [...params, currentSyId, tid] : [...params, currentSyId]
      const [countRows] = await db.query(countSql, countParams)
      const total = countRows[0]?.total ?? 0

      // PAGE
      const sql = `
        SELECT s.id, s.name AS section_name, s.grade_id, g.name AS grade_name
        FROM sections s
        JOIN grades g ON g.id = s.grade_id
        ${whereSql}
        ORDER BY g.id, s.name
        LIMIT ? OFFSET ?
      `

      const finalParams = tid ? [...params, currentSyId, tid, limit, offset] : [...params, currentSyId, limit, offset]

      const [rows] = await db.query(sql, finalParams)

      return res.status(200).json({ total, page: Number(page), page_size: limit, sections: rows })
    }

    // ---------- student (or default) context ----------
    // Return all sections + the teacher assigned for the CURRENT SY
    // LEFT JOIN teacher_sections filtered by current SY ensures at most 1 row due to unique (section_id, school_year_id)
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    // COUNT (without joins that could multiply rows)
    const countSql = `
      SELECT COUNT(*) AS total
      FROM sections s
      JOIN grades g ON g.id = s.grade_id
      ${whereSql}
    `
    const [countRowsAll] = await db.query(countSql, params)
    const total = countRowsAll[0]?.total ?? 0

    // PAGE (safe: one row per section thanks to filtered join on current SY)
    const sql = `
      SELECT
        s.id,
        s.name AS section_name,
        s.grade_id,
        g.name AS grade_name,
        ts.user_id AS assigned_teacher_id,
        u.full_name AS assigned_teacher_name
      FROM sections s
      JOIN grades g ON g.id = s.grade_id
      LEFT JOIN teacher_sections ts
        ON ts.section_id = s.id
       AND ts.school_year_id = ?
      LEFT JOIN users u
        ON u.id = ts.user_id
       AND u.is_deleted = 0
      ${whereSql}
      ORDER BY g.id, s.name
      LIMIT ? OFFSET ?
    `
    const finalParams = [currentSyId, ...params, limit, offset]
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
