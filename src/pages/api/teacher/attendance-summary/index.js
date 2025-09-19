// pages/api/teacher/attendance-summary.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const teacherId = session.user.id
  const { parent_ids } = req.query
  let parentIdList = []

  if (parent_ids) {
    parentIdList = parent_ids
      .split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id))
  }

  try {
    // Get activities for teacher's sections
    const sql = `
      SELECT DISTINCT a.id, a.title, a.activity_date
      FROM activities a
      JOIN activity_assignments aa ON aa.activity_id = a.id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id AND ts.user_id = ?
      WHERE a.is_deleted = 0
      ORDER BY a.activity_date DESC, a.title ASC
    `
    const [activities] = await db.query(sql, [teacherId])

    if (!activities.length) return res.status(200).json({ activities: [] })

    const activityIds = activities.map(a => a.id)

    // Totals query (with optional parent filter)
    let totalsQuery = `
      SELECT
          aa.activity_id,
          COALESCE(SUM(att.present_count),0)   AS present_count,
          COALESCE(SUM(att.absent_count),0)    AS absent_count,
          COALESCE(SUM(pay.paid_count),0)      AS paid_count,
          COALESCE(SUM(pay.unpaid_count),0)    AS unpaid_count
      FROM activity_assignments aa
      LEFT JOIN (
          SELECT
              at.activity_assignment_id,
              SUM(at.parent_present = 1) AS present_count,
              SUM(at.parent_present = 0) AS absent_count
          FROM attendance at
          INNER JOIN students s ON s.id = at.student_id AND s.is_deleted = 0
          ${
            parentIdList.length
              ? `INNER JOIN student_parents sp ON sp.student_id = s.id AND sp.parent_id IN (${parentIdList
                  .map(() => '?')
                  .join(',')})`
              : ''
          }
          GROUP BY at.activity_assignment_id
      ) att ON att.activity_assignment_id = aa.id
      LEFT JOIN (
          SELECT
              p.activity_assignment_id,
              SUM(p.paid = 1) AS paid_count,
              SUM(p.paid = 0) AS unpaid_count
          FROM payments p
          INNER JOIN students s ON s.id = p.student_id AND s.is_deleted = 0
          ${
            parentIdList.length
              ? `INNER JOIN student_parents sp2 ON sp2.student_id = s.id AND sp2.parent_id IN (${parentIdList
                  .map(() => '?')
                  .join(',')})`
              : ''
          }
          GROUP BY p.activity_assignment_id
      ) pay ON pay.activity_assignment_id = aa.id
      WHERE aa.activity_id IN (${activityIds.map(() => '?').join(',')})
        AND aa.section_id IN (
            SELECT section_id FROM teacher_sections WHERE user_id = ?
        )
      GROUP BY aa.activity_id
    `

    const totalsParams = [
      ...(parentIdList.length ? parentIdList : []),
      ...(parentIdList.length ? parentIdList : []),
      ...activityIds,
      teacherId
    ]

    const [totals] = await db.query(totalsQuery, totalsParams)

    // Map totals by activity_id
    const totalsByActivity = new Map()
    for (const t of totals) totalsByActivity.set(t.activity_id, t)

    const out = activities.map(a => {
      const t = totalsByActivity.get(a.id) || {}

      return {
        id: a.id,
        title: a.title,
        activity_date: a.activity_date,
        present_count: Number(t.present_count || 0),
        absent_count: Number(t.absent_count || 0),
        paid_count: Number(t.paid_count || 0),
        unpaid_count: Number(t.unpaid_count || 0)
      }
    })

    return res.status(200).json({ activities: out })
  } catch (err) {
    console.error('attendance-summary error', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
