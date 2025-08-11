// pages/api/activity/details.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { activity_id, section_id, page = 1, page_size = 50, search = '' } = req.query
    if (!activity_id || !section_id) return res.status(400).json({ message: 'activity_id and section_id are required' })

    // Confirm assignment exists
    const [aaRows] = await db.query(
      `SELECT id FROM activity_assignments WHERE activity_id = ? AND section_id = ? LIMIT 1`,
      [activity_id, section_id]
    )
    if (!aaRows || aaRows.length === 0) return res.status(200).json({ total: 0, students: [] })
    const assignmentId = aaRows[0].id

    // Build search clause
    const searchClause = search ? `AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)` : ''
    const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []

    // Count total
    const countSql = `
      SELECT COUNT(DISTINCT st.id) AS total
      FROM students st
      WHERE st.section_id = ? AND st.is_deleted = 0 ${search ? ' ' + searchClause : ''}
    `
    const [countRows] = await db.query(countSql, [section_id, ...searchParams])
    const total = countRows[0]?.total ?? 0

    // Pagination calc
    const limit = Math.max(1, Math.min(500, Number(page_size) || 50))
    const offset = (Math.max(1, Number(page) || 1) - 1) * limit

    // Fetch page
    const sql = `
      SELECT
        st.id AS student_id,
        st.first_name,
        st.last_name,
        st.lrn,
        att.status AS attendance_status,
        att.parent_present,
        att.marked_by AS attendance_marked_by,
        att.marked_at AS attendance_marked_at,
        pay.paid AS payment_paid,
        pay.payment_date AS payment_date,
        GROUP_CONCAT(CONCAT(pa.first_name, ' ', pa.last_name) SEPARATOR '; ') AS parents
      FROM students st
      LEFT JOIN attendance att ON att.student_id = st.id AND att.activity_assignment_id = ?
      LEFT JOIN payments pay ON pay.student_id = st.id AND pay.activity_assignment_id = ?
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents pa ON pa.id = sp.parent_id
      WHERE st.section_id = ? AND st.is_deleted = 0
      ${search ? ` ${searchClause}` : ''}
      GROUP BY st.id
      ORDER BY st.last_name, st.first_name
      LIMIT ? OFFSET ?
    `
    const params = [assignmentId, assignmentId, section_id, ...searchParams, limit, offset]
    const [rows] = await db.query(sql, params)

    return res.status(200).json({ total, page: Number(page), page_size: limit, students: rows })
  } catch (err) {
    console.error('Activity details error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
