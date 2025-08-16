// pages/api/activities/section.js
import db from '../../db'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const { section_id, from_date, to_date } = req.query

    if (!section_id) {
      return res.status(400).json({ message: 'section_id is required' })
    }

    // Base query to get activities for a specific section
    let query = `
      SELECT
        a.id,
        a.title,
        a.activity_date,
        a.created_at,
        -- Count attendance statistics
        COUNT(CASE WHEN att.status = 'present' THEN 1 END) as present_count,
        COUNT(CASE WHEN att.status = 'absent' THEN 1 END) as absent_count,
        COUNT(CASE WHEN att.parent_present = 1 THEN 1 END) as parent_present_count,
        -- Count payment statistics
        COUNT(CASE WHEN p.paid = 1 THEN 1 END) as paid_count,
        COUNT(CASE WHEN p.paid = 0 THEN 1 END) as unpaid_count,
        -- Total students assigned to this activity
        COUNT(DISTINCT s.id) as total_students
      FROM activities a
      INNER JOIN activity_assignments aa ON a.id = aa.activity_id
      INNER JOIN sections sec ON aa.section_id = sec.id
      INNER JOIN students s ON s.section_id = sec.id AND s.is_deleted = 0
      LEFT JOIN attendance att ON aa.id = att.activity_assignment_id AND att.student_id = s.id
      LEFT JOIN payments p ON aa.id = p.activity_assignment_id AND p.student_id = s.id
      WHERE a.is_deleted = 0
        AND aa.section_id = ?
    `

    const queryParams = [section_id]

    // Add date filters if provided
    if (from_date) {
      query += ' AND a.activity_date >= ?'
      queryParams.push(from_date)
    }

    if (to_date) {
      query += ' AND a.activity_date <= ?'
      queryParams.push(to_date)
    }

    // Group by activity and order by date
    query += `
      GROUP BY a.id, a.title, a.activity_date, a.created_at
      ORDER BY a.activity_date DESC, a.created_at DESC
    `

    const [activities] = await db.query(query, queryParams)

    // Format the response
    const formattedActivities = activities.map(activity => ({
      id: activity.id,
      title: activity.title,
      activity_date: activity.activity_date,
      present_count: parseInt(activity.present_count) || 0,
      absent_count: parseInt(activity.absent_count) || 0,
      parent_present_count: parseInt(activity.parent_present_count) || 0,
      paid_count: parseInt(activity.paid_count) || 0,
      unpaid_count: parseInt(activity.unpaid_count) || 0,
      total_students: parseInt(activity.total_students) || 0
    }))

    res.status(200).json({ activities: formattedActivities })
  } catch (err) {
    console.error('GET /api/activities/section error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
}
