import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { resolveSchoolYearId } from '../../lib/schoolYear'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

function csv(v) {
  if (v == null) return ''
  const s = String(v)

  return s.includes('"') || s.includes(',') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const syId = await resolveSchoolYearId(req)
    const { format = 'csv', activity_assignment_id = '', activity_id = '', grade_id = '', section_id = '' } = req.query
    const fmt = String(format).toLowerCase()

    const where = ['a.is_deleted = 0', 'a.school_year_id = ?', 'en.school_year_id = ?', "en.status = 'active'"]
    const params = [syId, syId]

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
        SELECT section_id FROM teacher_sections WHERE user_id = ? AND school_year_id = ? AND is_active = 1
      )`)
      params.push(session.user.id, syId)
    }

    const sql = `
      SELECT
        aa.id AS assignment_id,
        a.title AS activity_title,
        DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
        g.name AS grade_name,
        s.name AS section_name,
        st.id AS student_id,
        st.lrn,
        st.first_name,
        st.last_name,
        COALESCE(att.status, 'unmarked') AS attendance_status,
        COALESCE(att.parent_present, 0) AS parent_present,
        DATE_FORMAT(att.marked_at, '%Y-%m-%d %H:%i:%s') AS marked_at
      FROM activity_assignments aa
      JOIN activities a ON a.id = aa.activity_id
      JOIN grades g ON g.id = aa.grade_id
      JOIN sections s ON s.id = aa.section_id
      JOIN student_enrollments en
        ON en.school_year_id = a.school_year_id
       AND en.grade_id = aa.grade_id
       AND en.section_id = aa.section_id
      JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
      LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
      WHERE ${where.join(' AND ')}
      ORDER BY a.activity_date DESC, g.id, s.name, st.last_name, st.first_name
    `

    const [rows] = await db.query(sql, params)

    if (fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="attendance_sy_${syId}.csv"`)
      res.write(['assignment_id', 'activity', 'date', 'grade', 'section', 'lrn', 'last', 'first', 'attendance', 'parent_present', 'marked_at'].map(csv).join(',') + '\n')
      for (const r of rows) {
        res.write([r.assignment_id, r.activity_title, r.activity_date, r.grade_name, r.section_name, r.lrn, r.last_name, r.first_name, r.attendance_status, r.parent_present, r.marked_at].map(csv).join(',') + '\n')
      }
      res.end()

      return
    }

    if (fmt === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="attendance_sy_${syId}.xlsx"`)
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res })
      const sheet = workbook.addWorksheet('Attendance')
      sheet.addRow(['Assignment ID', 'Activity', 'Date', 'Grade', 'Section', 'LRN', 'Last Name', 'First Name', 'Attendance', 'Parent Present', 'Marked At']).commit()
      for (const r of rows) sheet.addRow([r.assignment_id, r.activity_title, r.activity_date, r.grade_name, r.section_name, r.lrn, r.last_name, r.first_name, r.attendance_status, Number(r.parent_present), r.marked_at]).commit()
      await workbook.commit()

      return
    }

    if (fmt === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="attendance_sy_${syId}.pdf"`)
      const doc = new PDFDocument({ margin: 40, size: 'A4' })
      doc.pipe(res)
      doc.fontSize(14).text(`Attendance Export - School Year ${syId}`)
      doc.moveDown()
      doc.fontSize(9)
      for (const r of rows) {
        doc.text(`${r.activity_date} | ${r.activity_title} | ${r.grade_name}-${r.section_name} | ${r.lrn} ${r.last_name}, ${r.first_name} | ${r.attendance_status} | Parent: ${Number(r.parent_present) ? 'Yes' : 'No'}`)
        if (doc.y > doc.page.height - 50) doc.addPage()
      }
      doc.end()

      return
    }

    return res.status(400).json({ message: 'Unsupported format' })
  } catch (err) {
    console.error('Export attendance error:', err)
    if (!res.headersSent) return res.status(500).json({ message: 'Internal server error' })
  }
}
