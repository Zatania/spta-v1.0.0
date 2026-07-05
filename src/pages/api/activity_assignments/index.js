// pages/api/activity_assignments/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { resolveSchoolYearId } from '../lib/schoolYear'
import { auditLog } from '../lib/audit'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const syId = await resolveSchoolYearId(req)

    if (req.method === 'GET') {
      const { activity_id = '', grade_id = '', section_id = '', page = 1, page_size = 50 } = req.query
      const limit = Math.max(1, Math.min(1000, Number(page_size) || 50))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['a.school_year_id = ?', 'a.is_deleted = 0', 's.is_deleted = 0']
      const params = [syId]

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
      if (session.user.role === 'teacher') {
        where.push(`EXISTS (
          SELECT 1
            FROM teacher_sections ts
           WHERE ts.user_id = ?
             AND ts.school_year_id = ?
             AND ts.is_active = 1
             AND ts.section_id = aa.section_id
        )`)
        params.push(session.user.id, syId)
      }

      const whereSql = `WHERE ${where.join(' AND ')}`

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id
           JOIN sections s ON s.id = aa.section_id
          ${whereSql}`,
        params
      )

      const [rows] = await db.query(
        `SELECT
            aa.id,
            aa.activity_id,
            a.title,
            DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
            a.payments_enabled,
            a.fee_type,
            a.fee_amount,
            a.school_year_id,
            aa.grade_id,
            aa.section_id,
            g.name AS grade_name,
            s.name AS section_name
           FROM activity_assignments aa
           JOIN activities a ON a.id = aa.activity_id
           JOIN grades g ON g.id = aa.grade_id
           JOIN sections s ON s.id = aa.section_id
          ${whereSql}
          ORDER BY a.activity_date DESC, g.id, s.name
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      )

      return res.status(200).json({ total: countRows[0]?.total || 0, page: Number(page), page_size: limit, assignments: rows })
    }

    if (req.method === 'POST') {
      const { activity_id, section_id } = req.body || {}
      const activityId = Number(activity_id)
      const sectionId = Number(section_id)

      if (!Number.isInteger(activityId) || activityId <= 0 || !Number.isInteger(sectionId) || sectionId <= 0) {
        return res.status(400).json({ message: 'activity_id and section_id are required' })
      }

      const [[activity]] = await db.query(
        `SELECT id, created_by, school_year_id
           FROM activities
          WHERE id = ? AND is_deleted = 0
          LIMIT 1`,
        [activityId]
      )
      if (!activity) return res.status(404).json({ message: 'Activity not found' })
      if (Number(activity.school_year_id) !== Number(syId)) {
        return res.status(400).json({ message: 'Activity does not belong to the selected school year' })
      }

      const [[section]] = await db.query(
        `SELECT id, grade_id
           FROM sections
          WHERE id = ? AND is_deleted = 0
          LIMIT 1`,
        [sectionId]
      )
      if (!section) return res.status(404).json({ message: 'Section not found' })

      if (session.user.role === 'teacher') {
        const [[ok]] = await db.query(
          `SELECT 1
             FROM teacher_sections
            WHERE user_id = ?
              AND section_id = ?
              AND school_year_id = ?
              AND is_active = 1
            LIMIT 1`,
          [session.user.id, sectionId, syId]
        )
        if (!ok) return res.status(403).json({ message: 'Forbidden: cannot assign activity to this section' })
      } else if (session.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' })
      }

      try {
        const [inserted] = await db.query(
          `INSERT INTO activity_assignments (activity_id, grade_id, section_id)
           VALUES (?, ?, ?)`,
          [activityId, section.grade_id, sectionId]
        )

        await auditLog({
          actorUserId: session.user.id,
          action: 'activity_assignment.create',
          entityType: 'activity_assignment',
          entityId: inserted.insertId,
          details: { activity_id: activityId, grade_id: section.grade_id, section_id: sectionId, school_year_id: syId }
        })

        return res.status(201).json({ message: 'Assignment created', id: inserted.insertId })
      } catch (err) {
        if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Assignment already exists for this section' })
        console.error('Create activity assignment error:', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('/api/activity_assignments error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
