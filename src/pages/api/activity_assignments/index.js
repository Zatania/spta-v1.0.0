// pages/api/activity_assignments/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db' // adjust path

/**
 * GET /api/activity_assignments
 *   params: activity_id, grade_id, section_id, page, page_size
 *   - returns assignments, with activity info and grade/section
 *
 * POST /api/activity_assignments
 *   body: { activity_id, grade_id, section_id }
 *   - Create an assignment (unique constraint on activity_id+grade+section)
 *   - Admins can assign any; teachers can only assign to their sections
 */
export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      const { activity_id = '', grade_id = '', section_id = '', page = 1, page_size = 50 } = req.query
      const limit = Math.max(1, Math.min(1000, Number(page_size) || 50))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = []
      const params = []

      if (activity_id) {
        where.push('aa.activity_id = ?')
        params.push(activity_id)
      }
      if (grade_id) {
        where.push('aa.grade_id = ?')
        params.push(grade_id)
      }
      if (section_id) {
        where.push('aa.section_id = ?')
        params.push(section_id)
      }

      // If teacher, only show assignments in their sections
      if (session.user.role === 'teacher') {
        where.push('aa.section_id IN (SELECT section_id FROM teacher_sections WHERE user_id = ?)')
        params.push(session.user.id)
      }

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      const countSql = `SELECT COUNT(*) AS total FROM activity_assignments aa ${whereSql}`
      const [countRows] = await db.query(countSql, params)
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT aa.id, aa.activity_id, a.title, a.activity_date, aa.grade_id, aa.section_id, g.name AS grade_name, s.name AS section_name
        FROM activity_assignments aa
        JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
        JOIN grades g ON g.id = aa.grade_id
        JOIN sections s ON s.id = aa.section_id
        ${whereSql}
        ORDER BY a.activity_date DESC, a.title
        LIMIT ? OFFSET ?
      `
      const finalParams = [...params, limit, offset]
      const [rows] = await db.query(sql, finalParams)

      return res.status(200).json({ total, page: Number(page), page_size: limit, assignments: rows })
    }

    if (req.method === 'POST') {
      const { activity_id, grade_id, section_id } = req.body
      if (!activity_id || !grade_id || !section_id)
        return res.status(400).json({ message: 'activity_id, grade_id and section_id are required' })

      // validate activity exists
      const [aRows] = await db.query('SELECT id, created_by FROM activities WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        activity_id
      ])
      if (!aRows.length) return res.status(400).json({ message: 'Activity not found' })

      // check section exists and matches grade
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? LIMIT 1', [section_id])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found' })
      if (String(secRows[0].grade_id) !== String(grade_id))
        return res.status(400).json({ message: 'Section does not belong to grade' })

      // teachers may only assign to their assigned sections
      if (session.user.role === 'teacher') {
        const [ok] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
          session.user.id,
          section_id
        ])
        if (!ok.length) return res.status(403).json({ message: 'Forbidden: cannot assign activity to this section' })
      }

      try {
        const [ins] = await db.query(
          'INSERT INTO activity_assignments (activity_id, grade_id, section_id) VALUES (?, ?, ?)',
          [activity_id, grade_id, section_id]
        )
        const id = ins.insertId

        const [row] = await db.query(
          'SELECT aa.id, aa.activity_id, a.title, a.activity_date, aa.grade_id, aa.section_id FROM activity_assignments aa JOIN activities a ON a.id = aa.activity_id WHERE aa.id = ? LIMIT 1',
          [id]
        )

        return res.status(201).json({ assignment: row[0] ?? row })
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Assignment already exists' })
        console.error('Create assignment error', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('activity_assignments index error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
