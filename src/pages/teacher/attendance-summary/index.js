// pages/api/teacher/attendance-summary.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const teacherId = session.user.id
  try {
    // List activities that are assigned to the teacher's sections (or teacher created but only if assigned to their sections)
    // We join activity_assignments -> teacher_sections to ensure only activities assigned to teacher's sections are returned
    const sql = `
      SELECT DISTINCT a.id, a.title, a.activity_date
      FROM activities a
      JOIN activity_assignments aa ON aa.activity_id = a.id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id AND ts.user_id = ?
      WHERE a.is_deleted = 0
      ORDER BY a.activity_date DESC, a.title ASC
    `
    const [activities] = await db.query(sql, [teacherId])

    // For each activity compute present/absent/paid/unpaid totals (aggregate across teacher's sections)
    if (!activities.length) return res.status(200).json({ activities: [] })

    const activityIds = activities.map(a => a.id)

    const [totals] = await db.query(
      `
      SELECT aa.activity_id,
             SUM(CASE WHEN at.status='present' THEN 1 ELSE 0 END) AS present_count,
             SUM(CASE WHEN at.status='absent'  THEN 1 ELSE 0 END) AS absent_count,
             SUM(CASE WHEN p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
             SUM(CASE WHEN p.paid = 0 THEN 1 ELSE 0 END) AS unpaid_count
      FROM activity_assignments aa
      LEFT JOIN attendance at ON at.activity_assignment_id = aa.id
      LEFT JOIN payments p ON p.activity_assignment_id = aa.id
      WHERE aa.activity_id IN (${activityIds.map(() => '?').join(',')})
        AND aa.section_id IN (SELECT section_id FROM teacher_sections WHERE user_id = ?)
      GROUP BY aa.activity_id
    `,
      [...activityIds, teacherId]
    )

    // Map totals by activity_id
    const totalsByActivity = new Map()
    for (const t of totals) totalsByActivity.set(t.activity_id, t)

    // attach stats
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
