// pages/api/activities/students.js
import db from '../../db'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const { activity_id, section_id, page = 1, page_size = 50, search = '' } = req.query

    if (!activity_id) {
      return res.status(400).json({ message: 'activity_id is required' })
    }

    if (!section_id) {
      return res.status(400).json({ message: 'section_id is required' })
    }

    // Convert pagination params to integers
    const pageNum = parseInt(page) || 1
    const pageSize = parseInt(page_size) || 50
    const offset = (pageNum - 1) * pageSize

    // Base query to get students with attendance and payment data
    let studentQuery = `
      SELECT
        s.id as student_id,
        s.first_name,
        s.last_name,
        s.lrn,
        s.grade_id,
        s.section_id,
        g.name as grade_name,
        sec.name as section_name,
        -- Attendance data
        att.status as attendance_status,
        att.parent_present,
        att.marked_at as attendance_marked_at,
        -- Payment data
        p.paid as payment_paid,
        p.payment_date,
        p.marked_at as payment_marked_at,
        -- Parent information (concatenated)
        GROUP_CONCAT(
          CONCAT(par.first_name, ' ', par.last_name,
          CASE WHEN sp.relation IS NOT NULL THEN CONCAT(' (', sp.relation, ')') ELSE '' END)
          SEPARATOR ', '
        ) as parents
      FROM students s
      INNER JOIN grades g ON s.grade_id = g.id
      INNER JOIN sections sec ON s.section_id = sec.id
      INNER JOIN activity_assignments aa ON aa.grade_id = s.grade_id AND aa.section_id = s.section_id
      LEFT JOIN attendance att ON aa.id = att.activity_assignment_id AND att.student_id = s.id
      LEFT JOIN payments p ON aa.id = p.activity_assignment_id AND p.student_id = s.id
      LEFT JOIN student_parents sp ON s.id = sp.student_id
      LEFT JOIN parents par ON sp.parent_id = par.id AND par.is_deleted = 0
      WHERE s.is_deleted = 0
        AND aa.activity_id = ?
        AND s.section_id = ?
    `

    const queryParams = [activity_id, section_id]

    // Add search filter if provided
    if (search && search.trim() !== '') {
      studentQuery += ` AND (
        s.first_name LIKE ? OR
        s.last_name LIKE ? OR
        s.lrn LIKE ? OR
        CONCAT(s.first_name, ' ', s.last_name) LIKE ? OR
        CONCAT(s.last_name, ', ', s.first_name) LIKE ?
      )`
      const searchTerm = `%${search.trim()}%`
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm)
    }

    // Group by student and add pagination
    studentQuery += `
      GROUP BY s.id, s.first_name, s.last_name, s.lrn, s.grade_id, s.section_id,
               g.name, sec.name, att.status, att.parent_present, att.marked_at,
               p.paid, p.payment_date, p.marked_at
      ORDER BY s.last_name, s.first_name
      LIMIT ? OFFSET ?
    `
    queryParams.push(pageSize, offset)

    // Count query for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT s.id) as total
      FROM students s
      INNER JOIN activity_assignments aa ON aa.grade_id = s.grade_id AND aa.section_id = s.section_id
      WHERE s.is_deleted = 0
        AND aa.activity_id = ?
        AND s.section_id = ?
    `

    const countParams = [activity_id, section_id]

    if (search && search.trim() !== '') {
      countQuery += ` AND (
        s.first_name LIKE ? OR
        s.last_name LIKE ? OR
        s.lrn LIKE ? OR
        CONCAT(s.first_name, ' ', s.last_name) LIKE ? OR
        CONCAT(s.last_name, ', ', s.first_name) LIKE ?
      )`
      const searchTerm = `%${search.trim()}%`
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm)
    }

    // Execute both queries
    const [students] = await db.query(studentQuery, queryParams)
    const [countResult] = await db.query(countQuery, countParams)

    const total = countResult[0]?.total || 0

    // Format the response
    const formattedStudents = students.map(student => ({
      student_id: student.student_id,
      first_name: student.first_name,
      last_name: student.last_name,
      lrn: student.lrn,
      grade_id: student.grade_id,
      section_id: student.section_id,
      grade_name: student.grade_name,
      section_name: student.section_name,
      parents: student.parents || '',

      // Attendance information
      attendance_status: student.attendance_status,
      parent_present: student.parent_present === 1,
      attendance_marked_at: student.attendance_marked_at,

      // Payment information
      payment_paid: student.payment_paid, // 1 = paid, 0 = unpaid, null = not recorded
      payment_date: student.payment_date,
      payment_marked_at: student.payment_marked_at
    }))

    res.status(200).json({
      students: formattedStudents,
      pagination: {
        page: pageNum,
        page_size: pageSize,
        total: parseInt(total),
        total_pages: Math.ceil(total / pageSize)
      },
      total: parseInt(total) // For backward compatibility with the dashboard
    })
  } catch (err) {
    console.error('GET /api/activity/students error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
}
