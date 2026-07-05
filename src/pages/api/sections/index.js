import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { resolveSchoolYearId } from '../lib/schoolYear'
import { auditLog } from '../lib/audit'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'POST') {
      if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      const { name, grade_id } = req.body || {}
      if (!name || !grade_id) return res.status(400).json({ message: 'Missing name or grade_id' })

      const [gradeRows] = await db.query('SELECT id FROM grades WHERE id = ? LIMIT 1', [grade_id])
      if (!gradeRows.length) return res.status(400).json({ message: 'Grade not found' })

      try {
        const [result] = await db.query(
          `INSERT INTO sections (name, grade_id, is_deleted)
           VALUES (?, ?, 0)`,
          [String(name).trim(), grade_id]
        )

        await auditLog({
          actorUserId: session.user.id,
          action: 'section.create',
          entityType: 'section',
          entityId: result.insertId,
          details: { name, grade_id }
        })

        return res.status(201).json({ id: result.insertId, name, grade_id })
      } catch (err) {
        if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Section already exists in this grade' })
        console.error('POST /api/sections error:', err)

        return res.status(500).json({ message: 'Failed to add section' })
      }
    }

    if (req.method === 'GET') {
      const syId = await resolveSchoolYearId(req)
      const { search = '', grade_id = '', assigned = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(500, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['s.is_deleted = 0']
      const params = [syId]

      if (grade_id) {
        where.push('s.grade_id = ?')
        params.push(grade_id)
      }
      if (search) {
        where.push('(s.name LIKE ? OR g.name LIKE ? OR u.full_name LIKE ?)')
        params.push(`%${search}%`, `%${search}%`, `%${search}%`)
      }
      if (assigned === '1') where.push('ts.id IS NOT NULL')
      if (assigned === '0') where.push('ts.id IS NULL')

      const whereSql = `WHERE ${where.join(' AND ')}`

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total
           FROM sections s
           JOIN grades g ON g.id = s.grade_id
           LEFT JOIN teacher_sections ts
             ON ts.section_id = s.id
            AND ts.school_year_id = ?
            AND ts.is_active = 1
           LEFT JOIN users u ON u.id = ts.user_id AND u.is_deleted = 0
          ${whereSql}`,
        params
      )

      const [rows] = await db.query(
        `SELECT
            s.id,
            s.name AS section_name,
            s.grade_id,
            g.name AS grade_name,
            CASE WHEN ts.id IS NULL THEN 0 ELSE 1 END AS assigned,
            ts.id AS assignment_id,
            ts.user_id AS assigned_teacher_id,
            u.full_name AS assigned_teacher_name,
            DATE_FORMAT(ts.assigned_at, '%Y-%m-%d %H:%i:%s') AS assigned_at
           FROM sections s
           JOIN grades g ON g.id = s.grade_id
           LEFT JOIN teacher_sections ts
             ON ts.section_id = s.id
            AND ts.school_year_id = ?
            AND ts.is_active = 1
           LEFT JOIN users u ON u.id = ts.user_id AND u.is_deleted = 0
          ${whereSql}
          ORDER BY g.id, s.name ASC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      )

      const sections = rows.map(r => ({
        id: r.id,
        section_name: r.section_name,
        grade_id: r.grade_id,
        grade_name: r.grade_name,
        assigned: Number(r.assigned),
        assignment_id: r.assignment_id,
        assigned_teacher: r.assigned_teacher_id
          ? { id: r.assigned_teacher_id, full_name: r.assigned_teacher_name, assigned_at: r.assigned_at }
          : null
      }))

      return res.status(200).json({ total: countRows[0]?.total || 0, page: Number(page), page_size: limit, sections })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('/api/sections error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
