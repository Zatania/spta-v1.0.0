// pages/api/teacher/attendance-summary.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

/**
 * GET /api/teacher/attendance-summary
 * Optional query: from_date, to_date (YYYY-MM-DD)
 * Returns activities visible to teacher (created_by = teacher OR assigned via teacher_sections)
 * with attendance & payment totals per activity.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const teacherId = session.user.id
  const { from_date, to_date } = req.query ?? {}

  try {
    // Activities that the teacher created
    // OR activities assigned to any of the teacher’s sections
    const params = [teacherId, teacherId]
    let dateClause = ''
    if (from_date) {
      dateClause += ' AND a.activity_date >= ?'
      params.push(from_date)
    }
    if (to_date) {
      dateClause += ' AND a.activity_date <= ?'
      params.push(to_date)
    }

    const sql = `
      WITH teacher_sections_cte AS (
        SELECT section_id FROM teacher_sections WHERE user_id = ?
      ),
      visible_activities AS (
        SELECT DISTINCT a.id, a.title, a.activity_date
        FROM activities a
        LEFT JOIN activity_assignments aa ON aa.activity_id = a.id
        LEFT JOIN teacher_sections_cte ts ON ts.section_id = aa.section_id
        WHERE (a.created_by = ? OR ts.section_id IS NOT NULL)
          AND a.is_deleted = 0
          ${dateClause}
      ),
      att AS (
        SELECT aa.activity_id,
               SUM(CASE WHEN at.status = 'present' THEN 1 ELSE 0 END) AS present_count,
               SUM(CASE WHEN at.status = 'absent'  THEN 1 ELSE 0 END) AS absent_count
        FROM attendance at
        JOIN activity_assignments aa ON aa.id = at.activity_assignment_id
        GROUP BY aa.activity_id
      ),
      pay AS (
        SELECT aa.activity_id,
               SUM(CASE WHEN p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
               SUM(CASE WHEN p.paid = 0 THEN 1 ELSE 0 END) AS unpaid_count
        FROM payments p
        JOIN activity_assignments aa ON aa.id = p.activity_assignment_id
        GROUP BY aa.activity_id
      )
      SELECT va.id, va.title, va.activity_date,
             COALESCE(att.present_count,0) AS present_count,
             COALESCE(att.absent_count,0)  AS absent_count,
             COALESCE(pay.paid_count,0)    AS paid_count,
             COALESCE(pay.unpaid_count,0)  AS unpaid_count
      FROM visible_activities va
      LEFT JOIN att ON att.activity_id = va.id
      LEFT JOIN pay ON pay.activity_id = va.id
      ORDER BY va.activity_date DESC, va.title ASC
    `
    const [rows] = await db.query(sql, params)

    return res.status(200).json({ activities: rows })
  } catch (err) {
    console.error('attendance-summary error', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
