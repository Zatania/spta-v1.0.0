// pages/api/teacher/activity/[activityId]/summary.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../api/auth/[...nextauth]' // adjust path to your nextauth file
import db from '../../../api/db' // adjust path to your db helper

/**
 * GET /api/teacher/activity/:activityId/summary
 * Returns attendance/payment summary grouped by section for the given activity.
 * Query params: none
 *
 * Response:
 * {
 *   activity: { id, title, activity_date },
 *   sections: [
 *     { section_id, section_name, grade_id, grade_name, present_count, absent_count, parent_present_count, paid_count, unpaid_count, total_students }
 *   ]
 * }
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const teacherId = session.user.id
  const activityId = Number(req.query.activityId)
  if (!activityId) return res.status(400).json({ message: 'activityId required' })

  try {
    // Verify teacher visibility: either created_by or assigned via teacher_sections for assignment's sections
    const [visibleRows] = await db.query(
      `
      SELECT DISTINCT a.id, a.title, a.activity_date
      FROM activities a
      LEFT JOIN activity_assignments aa ON aa.activity_id = a.id
      LEFT JOIN teacher_sections ts ON ts.section_id = aa.section_id
      WHERE a.id = ? AND (a.created_by = ? OR ts.user_id = ?)
        AND a.is_deleted = 0
      LIMIT 1
    `,
      [activityId, teacherId, teacherId]
    )
    if (!visibleRows || visibleRows.length === 0)
      return res.status(404).json({ message: 'Activity not found or not visible' })
    const activity = visibleRows[0]

    // For each activity_assignment for that activity that the teacher can see,
    // compute counts for that section (total students, present/absent etc.)
    const [rows] = await db.query(
      `
      SELECT
        aa.id AS activity_assignment_id,
        aa.section_id,
        s.name AS section_name,
        g.id AS grade_id,
        g.name AS grade_name,
        COUNT(DISTINCT st.id) AS total_students,
        SUM(CASE WHEN at.status = 'present' THEN 1 ELSE 0 END) AS present_count,
        SUM(CASE WHEN at.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
        SUM(CASE WHEN at.parent_present = 1 THEN 1 ELSE 0 END) AS parent_present_count,
        SUM(CASE WHEN p.paid = 1 THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN p.paid = 0 THEN 1 ELSE 0 END) AS unpaid_count
      FROM activity_assignments aa
      JOIN sections s ON s.id = aa.section_id
      JOIN grades g ON g.id = s.grade_id
      LEFT JOIN students st ON st.section_id = s.id AND st.is_deleted = 0
      LEFT JOIN attendance at ON at.activity_assignment_id = aa.id AND at.student_id = st.id
      LEFT JOIN payments p ON p.activity_assignment_id = aa.id AND p.student_id = st.id
      LEFT JOIN teacher_sections ts ON ts.section_id = aa.section_id
      WHERE aa.activity_id = ?
        AND ( ? = (SELECT a.created_by FROM activities a WHERE a.id = ?) OR ts.user_id = ? )
      GROUP BY aa.id, aa.section_id, s.name, g.id, g.name
      ORDER BY g.name, s.name
      `,
      [activityId, teacherId, activityId, teacherId]
    )

    return res.status(200).json({ activity, sections: rows })
  } catch (err) {
    console.error('activity summary error', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
