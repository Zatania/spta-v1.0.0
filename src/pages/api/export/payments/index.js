// pages/api/export/payments.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import { getCurrentSchoolYearId } from '../../lib/schoolYear'
import db from '../../db'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

function escapeCsvValue(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }

  return s
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const currentSyId = await getCurrentSchoolYearId()

    const { format = 'csv', activity_assignment_id, activity_id, grade_id, section_id } = req.query
    const fmt = String(format).toLowerCase()

    // permission checks similar to attendance
    const where = ['a.is_deleted = 0', 'en.school_year_id = ?', "en.status = 'active'"]
    const params = [currentSyId]

    if (activity_assignment_id) {
      where.push('aa.id = ?')
      params.push(activity_assignment_id)
    }
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

    if (session.user.role === 'teacher') {
      where.push(`aa.section_id IN (
        SELECT section_id
        FROM teacher_sections
        WHERE user_id = ?
          AND (school_year_id = ? OR school_year_id IS NULL)
      )`)
      params.push(session.user.id, currentSyId)
    }

    const sql = `
      SELECT aa.id AS assignment_id, a.title AS activity_title, a.activity_date,
        aa.grade_id, g.name AS grade_name, aa.section_id, s.name AS section_name,
        st.id AS student_id, st.lrn, st.first_name, st.last_name,
        pmt.id AS payment_id, pmt.paid AS payment_paid, pmt.payment_date,
        pmt.marked_by AS payment_marked_by, pmt.marked_at
      FROM activity_assignments aa
      JOIN activities a ON a.id = aa.activity_id
      JOIN grades g ON g.id = aa.grade_id
      JOIN sections s ON s.id = aa.section_id
      JOIN student_enrollments en
        ON en.grade_id = aa.grade_id
      AND en.section_id = aa.section_id
      JOIN students st
        ON st.id = en.student_id
      AND st.is_deleted = 0
      LEFT JOIN payments pmt
        ON pmt.activity_assignment_id = aa.id
      AND pmt.student_id = st.id
      WHERE ${where.join(' AND ')}
      ORDER BY a.activity_date DESC, aa.section_id, st.last_name, st.first_name
    `

    const conn = await db.getConnection()
    try {
      const queryStream = conn.query(sql, params).stream({ highWaterMark: 5 })

      if (fmt === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', 'attachment; filename="payments_export.csv"')
        res.write(
          [
            'assignment_id',
            'activity_title',
            'activity_date',
            'grade',
            'section',
            'student_id',
            'lrn',
            'last',
            'first',
            'payment_id',
            'paid',
            'payment_date',
            'marked_by'
          ]
            .map(escapeCsvValue)
            .join(',') + '\n'
        )
        queryStream.on('data', row => {
          const csvRow =
            [
              row.assignment_id,
              row.activity_title,
              row.activity_date,
              row.grade_name,
              row.section_name,
              row.student_id,
              row.lrn,
              row.last_name,
              row.first_name,
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
        queryStream.on('end', () => res.end())

        return
      }

      if (fmt === 'xlsx') {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        res.setHeader('Content-Disposition', 'attachment; filename="payments_export.xlsx"')
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res })
        const sheet = workbook.addWorksheet('Payments')
        sheet
          .addRow([
            'assignment_id',
            'activity_title',
            'activity_date',
            'grade',
            'section',
            'student_id',
            'lrn',
            'last',
            'first',
            'payment_id',
            'paid',
            'payment_date',
            'marked_by'
          ])
          .commit()
        for await (const row of queryStream) {
          sheet
            .addRow([
              row.assignment_id,
              row.activity_title,
              row.activity_date,
              row.grade_name,
              row.section_name,
              row.student_id,
              row.lrn,
              row.last_name,
              row.first_name,
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
        res.setHeader('Content-Disposition', 'attachment; filename="payments_export.pdf"')
        const doc = new PDFDocument({ margin: 40, size: 'A4' })
        doc.pipe(res)
        let currentAssignmentKey = null
        for await (const row of queryStream) {
          const key = `${row.assignment_id}-${row.section_id}`
          if (key !== currentAssignmentKey) {
            if (currentAssignmentKey) doc.addPage()
            currentAssignmentKey = key
            doc.fontSize(14).text(`${row.activity_title} — ${row.activity_date}`, { underline: true })
            doc.fontSize(12).text(`Grade: ${row.grade_name} • Section: ${row.section_name}`)
            doc.moveDown(0.3)
            doc.fontSize(10)
            doc.text('LRN', { continued: true, width: 80 })
            doc.text('Name', { continued: true, width: 250 })
            doc.text('Paid', { width: 80 })
            doc.moveDown(0.2)
          }
          doc.fontSize(10)
          doc.text(row.lrn || '', { continued: true, width: 80 })
          doc.text(`${row.last_name}, ${row.first_name}` || '', { continued: true, width: 250 })
          doc.text(row.payment_paid ? 'Yes' : 'No', { width: 80 })
        }
        doc.end()

        return
      }

      return res.status(400).json({ message: 'Invalid format' })
    } finally {
      try {
        conn.release()
      } catch {}
    }
  } catch (err) {
    console.error('Export payments error:', err)
    if (!res.headersSent) return res.status(500).json({ message: 'Internal server error' })
  }
}
