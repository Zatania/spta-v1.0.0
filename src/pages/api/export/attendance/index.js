// pages/api/export/attendance.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]' // adjust
import db from '../../db' // adjust
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { pipeline } from 'stream'
import { promisify } from 'util'

const pipelineAsync = promisify(pipeline)

function escapeCsvValue(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }

  return s
}

/**
 * GET /api/export/attendance?format=csv|xlsx|pdf&activity_assignment_id=&activity_id=&grade_id=&section_id=
 * Streams the matching attendance rows for the filters.
 */
export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { format = 'csv', activity_assignment_id, activity_id, grade_id, section_id } = req.query
    const fmt = String(format).toLowerCase()

    // Permission checks: if teacher, limit by their sections
    let where = ['st.is_deleted = 0']
    const params = []

    let assignmentFilter = ''
    if (activity_assignment_id) {
      where.push('atbl.activity_assignment_id = ?')
      params.push(activity_assignment_id)
      assignmentFilter = `AND aa.id = ${db.escape(activity_assignment_id)}`
    } else {
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
    }

    // If teacher, ensure they are allowed (we restrict by section via WHERE later, but also enforce they can access for exports)
    if (session.user.role === 'teacher') {
      // if section_id present ensure teacher has that section
      if (section_id) {
        const [ok] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
          session.user.id,
          section_id
        ])
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      } else if (activity_assignment_id) {
        // verify assignment belongs to their section
        const [assRows] = await db.query('SELECT section_id FROM activity_assignments WHERE id = ? LIMIT 1', [
          activity_assignment_id
        ])
        if (!assRows.length) return res.status(404).json({ message: 'Assignment not found' })
        const sectionId = assRows[0].section_id

        const [ok] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
          session.user.id,
          sectionId
        ])
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      } else {
        // no section filter - teacher can export only for their sections.
        where.push('aa.section_id IN (SELECT section_id FROM teacher_sections WHERE user_id = ?)')
        params.push(session.user.id)
      }
    }

    // Build SQL to stream attendance rows joined with students, assignments and payments
    const sql = `
      SELECT
        aa.id AS assignment_id, aa.activity_id, a.title AS activity_title, a.activity_date,
        aa.grade_id, g.name AS grade_name, aa.section_id, s.name AS section_name,
        st.id AS student_id, st.lrn, st.first_name, st.last_name,
        att.id AS attendance_id, att.status AS attendance_status, att.parent_present AS parent_present, att.marked_by AS attendance_marked_by, att.marked_at AS attendance_marked_at,
        pmt.id AS payment_id, pmt.paid AS payment_paid, pmt.payment_date AS payment_date, pmt.marked_by AS payment_marked_by
      FROM activity_assignments aa
      JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
      JOIN grades g ON g.id = aa.grade_id
      JOIN sections s ON s.id = aa.section_id
      JOIN students st ON st.grade_id = aa.grade_id AND st.section_id = aa.section_id AND st.is_deleted = 0
      LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
      LEFT JOIN payments pmt ON pmt.activity_assignment_id = aa.id AND pmt.student_id = st.id
      WHERE ${where.join(' AND ')}
      ORDER BY aa.activity_date DESC, aa.section_id, st.last_name, st.first_name
    `

    // Use a DB connection and stream rows
    const conn = await db.getConnection()
    try {
      const queryStream = conn.query(sql, params).stream({ highWaterMark: 5 })

      if (fmt === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="attendance_export.csv"`)

        // Write header
        res.write(
          [
            'assignment_id',
            'activity_id',
            'activity_title',
            'activity_date',
            'grade_id',
            'grade_name',
            'section_id',
            'section_name',
            'student_id',
            'lrn',
            'first_name',
            'last_name',
            'attendance_id',
            'attendance_status',
            'parent_present',
            'attendance_marked_by',
            'attendance_marked_at',
            'payment_id',
            'payment_paid',
            'payment_date',
            'payment_marked_by'
          ]
            .map(escapeCsvValue)
            .join(',') + '\n'
        )

        // Transform row objects to CSV strings and pipe to res
        queryStream.on('data', row => {
          const csvRow =
            [
              row.assignment_id,
              row.activity_id,
              row.activity_title,
              row.activity_date,
              row.grade_id,
              row.grade_name,
              row.section_id,
              row.section_name,
              row.student_id,
              row.lrn,
              row.first_name,
              row.last_name,
              row.attendance_id,
              row.attendance_status,
              row.parent_present ? 1 : 0,
              row.attendance_marked_by,
              row.attendance_marked_at,
              row.payment_id,
              row.payment_paid ? 1 : 0,
              row.payment_date,
              row.payment_marked_by
            ]
              .map(escapeCsvValue)
              .join(',') + '\n'
          if (!res.write(csvRow)) queryStream.pause()
        })
        res.on('drain', () => queryStream.resume())
        queryStream.on('end', () => {
          res.end()
        })
        queryStream.on('error', e => {
          console.error('queryStream error', e)
          try {
            res.end()
          } catch {}
        })

        return
      }

      if (fmt === 'xlsx') {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        res.setHeader('Content-Disposition', `attachment; filename="attendance_export.xlsx"`)

        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res })
        const sheet = workbook.addWorksheet('Attendance')

        // header row
        sheet
          .addRow([
            'assignment_id',
            'activity_id',
            'activity_title',
            'activity_date',
            'grade_id',
            'grade_name',
            'section_id',
            'section_name',
            'student_id',
            'lrn',
            'first_name',
            'last_name',
            'attendance_id',
            'attendance_status',
            'parent_present',
            'attendance_marked_by',
            'attendance_marked_at',
            'payment_id',
            'payment_paid',
            'payment_date',
            'payment_marked_by'
          ])
          .commit()

        // stream rows into sheet
        for await (const row of queryStream) {
          // queryStream is async-iterable in mysql2 v2 when using .stream()
          sheet
            .addRow([
              row.assignment_id,
              row.activity_id,
              row.activity_title,
              row.activity_date,
              row.grade_id,
              row.grade_name,
              row.section_id,
              row.section_name,
              row.student_id,
              row.lrn,
              row.first_name,
              row.last_name,
              row.attendance_id,
              row.attendance_status,
              row.parent_present ? 1 : 0,
              row.attendance_marked_by,
              row.attendance_marked_at,
              row.payment_id,
              row.payment_paid ? 1 : 0,
              row.payment_date,
              row.payment_marked_by
            ])
            .commit()
        }

        await workbook.commit()

        return
      }

      if (fmt === 'pdf') {
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `attachment; filename="attendance_export.pdf"`)

        const doc = new PDFDocument({ margin: 40, size: 'A4' })
        doc.pipe(res)

        // Simple layout: group by assignment (activity + section) and print student list per group
        let currentAssignmentKey = null
        let firstPage = true
        for await (const row of queryStream) {
          const key = `${row.assignment_id}-${row.section_id}`
          if (key !== currentAssignmentKey) {
            if (!firstPage) doc.addPage()
            firstPage = false

            // header
            doc.fontSize(14).text(`${row.activity_title} — ${row.activity_date}`, { underline: true })
            doc.moveDown(0.2)
            doc.fontSize(12).text(`Grade: ${row.grade_name} • Section: ${row.section_name}`)
            doc.moveDown(0.5)

            // table header
            doc.fontSize(10)
            doc.text('LRN', { continued: true, width: 80 })
            doc.text('Last Name', { continued: true, width: 180 })
            doc.text('First Name', { continued: true, width: 150 })
            doc.text('Attendance', { continued: true, width: 90 })
            doc.text('Parent Present', { width: 80 })
            doc.moveDown(0.2)
            currentAssignmentKey = key
          }

          // print one student row
          doc.fontSize(10)
          doc.text(row.lrn || '', { continued: true, width: 80 })
          doc.text(row.last_name || '', { continued: true, width: 180 })
          doc.text(row.first_name || '', { continued: true, width: 150 })
          doc.text(row.attendance_status || 'absent', { continued: true, width: 90 })
          doc.text(row.parent_present ? 'Yes' : 'No', { width: 80 })
        }

        doc.end()

        return
      }

      // unsupported format
      return res.status(400).json({ message: 'Invalid format' })
    } finally {
      try {
        conn.release()
      } catch {}
    }
  } catch (err) {
    console.error('Export attendance error:', err)

    // Avoid sending JSON after streaming started. If streaming not yet started, send error.
    if (!res.headersSent) return res.status(500).json({ message: 'Internal server error' })
  }
}
