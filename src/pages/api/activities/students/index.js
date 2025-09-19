// pages/api/activities/students.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method !== 'GET') {
      return res.status(405).json({ message: 'Method not allowed' })
    }

    const { activity_id, section_id, page = 1, page_size = 50, search = '', parent_ids = '' } = req.query

    if (!activity_id) {
      return res.status(400).json({ message: 'activity_id is required' })
    }

    if (!section_id) {
      return res.status(400).json({ message: 'section_id is required' })
    }

    // Convert pagination params to integers
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const pageSize = Math.max(1, Math.min(1000, parseInt(page_size, 10) || 50))
    const offset = (pageNum - 1) * pageSize

    // Parse parent_ids if present
    let parentIdsList = []
    if (parent_ids && String(parent_ids).trim() !== '') {
      parentIdsList = String(parent_ids)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(v => parseInt(v, 10))
        .filter(Number.isFinite)

      const MAX_PARENTS = 50
      if (parentIdsList.length > MAX_PARENTS) {
        return res.status(400).json({ message: `Too many parent_ids (max ${MAX_PARENTS})` })
      }
    }

    // Base query to get students with attendance and payment data
    // We'll use LEFT JOINs and GROUP_CONCAT(DISTINCT ...) to avoid duplicate parent rows
    let studentQuery = `
      SELECT
        s.id AS student_id,
        s.first_name,
        s.last_name,
        s.lrn,
        s.grade_id,
        s.section_id,
        g.name AS grade_name,
        sec.name AS section_name,
        -- Attendance data (use att for the activity assignment)
        att.status AS attendance_status,
        att.parent_present,
        att.marked_at AS attendance_marked_at,
        -- Payment data (assumes payments table may have multiple records; we'll pick latest payment_date & max paid flag)
        MAX(p.amount) AS payment_amount,
        MAX(p.payment_date) AS payment_date,
        MAX(p.paid) AS payment_paid,
        MAX(p.marked_at) AS payment_marked_at,
        -- Parent information (concatenated, distinct)
        GROUP_CONCAT(DISTINCT CONCAT(par.last_name, ', ', par.first_name,
          CASE WHEN sp.relation IS NOT NULL THEN CONCAT(' (', sp.relation, ')') ELSE '' END
        ) SEPARATOR '; ') AS parents
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

    // Add parent filter (only include students that have any of the given parents)
    if (parentIdsList.length > 0) {
      const placeholders = parentIdsList.map(() => '?').join(',')

      // Use EXISTS to avoid breaking the grouping
      studentQuery += ` AND EXISTS (
        SELECT 1 FROM student_parents sp2
        WHERE sp2.student_id = s.id AND sp2.parent_id IN (${placeholders})
      ) `
      queryParams.push(...parentIdsList)
    }

    // Add search filter if provided (include LRN explicitly)
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

    // Group by student and add pagination / ordering
    studentQuery += `
      GROUP BY s.id, s.first_name, s.last_name, s.lrn, s.grade_id, s.section_id,
               g.name, sec.name, att.status, att.parent_present, att.marked_at
      ORDER BY s.last_name, s.first_name
      LIMIT ? OFFSET ?
    `
    queryParams.push(pageSize, offset)

    // Count query (similar filter but without LIMIT)
    let countQuery = `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM students s
      INNER JOIN activity_assignments aa ON aa.grade_id = s.grade_id AND aa.section_id = s.section_id
      WHERE s.is_deleted = 0
        AND aa.activity_id = ?
        AND s.section_id = ?
    `

    const countParams = [activity_id, section_id]

    if (parentIdsList.length > 0) {
      const placeholders = parentIdsList.map(() => '?').join(',')
      countQuery += ` AND EXISTS (
        SELECT 1 FROM student_parents sp2
        WHERE sp2.student_id = s.id AND sp2.parent_id IN (${placeholders})
      ) `
      countParams.push(...parentIdsList)
    }

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

    // Execute queries
    const [students] = await db.query(studentQuery, queryParams)
    const [countResult] = await db.query(countQuery, countParams)
    const total = countResult?.[0]?.total ?? 0

    // Format response
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
      attendance_status: student.attendance_status,
      parent_present: Boolean(student.parent_present),
      attendance_marked_at: student.attendance_marked_at,
      payment_amount: student.payment_amount ? Number(student.payment_amount) : null,
      payment_date: student.payment_date,
      payment_paid: student.payment_paid === null ? null : Number(student.payment_paid),
      payment_marked_at: student.payment_marked_at
    }))

    return res.status(200).json({
      students: formattedStudents,
      pagination: {
        page: pageNum,
        page_size: pageSize,
        total: Number(total),
        total_pages: Math.ceil(total / pageSize)
      },
      total: Number(total)
    })
  } catch (err) {
    console.error('GET /api/activities/students error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
