// pages/api/teacher/activity/[activityId]/assignments.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../auth/[...nextauth]'
import db from '../../../db'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const teacherId = session.user.id
  const activityId = Number(req.query.activityId)

  if (!activityId) return res.status(400).json({ message: 'activityId required' })

  try {
    const [rows] = await db.query(
      `
      SELECT aa.id AS activity_assignment_id, aa.section_id, s.name AS section_name, s.grade_id, g.name AS grade_name
      FROM activity_assignments aa
      JOIN sections s ON s.id = aa.section_id
      JOIN grades g ON g.id = s.grade_id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id AND ts.user_id = ?
      WHERE aa.activity_id = ?
      ORDER BY g.name, s.name
    `,
      [teacherId, activityId]
    )

    return res.status(200).json({ assignments: rows })
  } catch (err) {
    console.error('assignments error', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
