// pages/api/parents/pupils.js  (alternate using student_enrollments + optional school_year)
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

    const { parent_ids = '', school_year_id } = req.query

    if (!parent_ids || String(parent_ids).trim() === '') {
      return res.status(400).json({ message: 'parent_ids query parameter is required (comma-separated)' })
    }

    const ids = String(parent_ids)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(v => parseInt(v, 10))
      .filter(Number.isFinite)

    if (!ids.length) return res.status(400).json({ message: 'No valid parent ids provided' })
    if (ids.length > 50) return res.status(400).json({ message: 'Too many parent ids (max 50)' })

    // Determine school_year_id: use supplied param, otherwise fetch current
    let syId = null
    if (school_year_id && !Number.isNaN(parseInt(school_year_id, 10))) {
      syId = parseInt(school_year_id, 10)
    } else {
      const [rows] = await db.query('SELECT id FROM school_years WHERE is_current = 1 LIMIT 1')
      syId = rows?.[0]?.id || null
    }

    if (!syId) {
      // If you prefer, return empty mapping instead of error. Here we return empty pupils set:
      const emptyMapping = {}
      for (const id of ids) emptyMapping[String(id)] = []

      return res.status(200).json(emptyMapping)
    }

    const placeholders = ids.map(() => '?').join(',')

    // SQL using enrollments for the resolved school_year_id
    const sql = `
      SELECT
        sp.parent_id,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        s.lrn,
        se.grade_id,
        se.section_id,
        g.name AS grade_name,
        sec.name AS section_name
      FROM student_parents sp
      JOIN student_enrollments se
        ON se.student_id = sp.student_id
        AND se.school_year_id = ?
      JOIN students s
        ON s.id = se.student_id AND s.is_deleted = 0
      LEFT JOIN grades g ON g.id = se.grade_id
      LEFT JOIN sections sec ON sec.id = se.section_id
      WHERE sp.parent_id IN (${placeholders})
      ORDER BY sp.parent_id, s.last_name, s.first_name
    `
    const params = [syId, ...ids]
    const [rows] = await db.query(sql, params)

    const mapping = {}
    for (const id of ids) mapping[String(id)] = []
    for (const r of rows) {
      const pid = String(r.parent_id)
      mapping[pid] = mapping[pid] || []
      mapping[pid].push({
        id: r.student_id,
        first_name: r.first_name,
        last_name: r.last_name,
        lrn: r.lrn,
        grade_id: r.grade_id,
        section_id: r.section_id,
        grade_name: r.grade_name,
        section_name: r.section_name
      })
    }

    return res.status(200).json(mapping)
  } catch (err) {
    console.error('GET /api/parents/pupils (enrollments) error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
