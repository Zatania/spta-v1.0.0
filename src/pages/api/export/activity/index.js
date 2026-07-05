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
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const syId = await resolveSchoolYearId(req)
    const { activity_id, section_id = '', format = 'csv', search = '' } = req.query
    const fmt = String(format).toLowerCase()
    if (!activity_id) return res.status(400).json({ message: 'activity_id is required' })

    const where = ['a.id = ?', 'a.school_year_id = ?', 'a.is_deleted = 0', 'en.school_year_id = ?', "en.status = 'active'"]
    const params = [activity_id, syId, syId]

    if (section_id) {
      where.push('aa.section_id = ?')
      params.push(section_id)
    }
    if (search) {
      where.push('(st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (session.user.role === 'teacher') {
      where.push(`aa.section_id IN (
        SELECT section_id FROM teacher_sections WHERE user_id = ? AND school_year_id = ? AND is_active = 1
      )`)
      params.push(session.user.id, syId)
    }

    const sql = `
      SELECT
        a.title,
        DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
        g.name AS grade_name,
        sec.name AS section_name,
        st.lrn,
        st.last_name,
        st.first_name,
        GROUP_CONCAT(DISTINCT CONCAT(pa.first_name, ' ', pa.last_name) ORDER BY pa.last_name SEPARATOR '; ') AS parents,
        COALESCE(att.status, 'unmarked') AS attendance_status,
        COALESCE(att.parent_present, 0) AS parent_present,
        CASE
          WHEN a.fee_type NOT IN ('fee','mixed') THEN 'not_required'
          WHEN pay.paid = 1 THEN 'paid'
          WHEN c.id IS NOT NULL THEN 'contribution'
          ELSE 'unpaid'
        END AS payment_status,
        COALESCE(pay.amount, 0) AS amount,
        DATE_FORMAT(pay.payment_date, '%Y-%m-%d') AS payment_date
      FROM activity_assignments aa
      JOIN activities a ON a.id = aa.activity_id
      JOIN grades g ON g.id = aa.grade_id
      JOIN sections sec ON sec.id = aa.section_id
      JOIN student_enrollments en
        ON en.school_year_id = a.school_year_id
       AND en.grade_id = aa.grade_id
       AND en.section_id = aa.section_id
      JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents pa ON pa.id = sp.parent_id AND pa.is_deleted = 0
      LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
      LEFT JOIN payments pay ON pay.activity_assignment_id = aa.id AND pay.student_id = st.id
      LEFT JOIN contributions c ON c.activity_assignment_id = aa.id AND c.student_id = st.id
      WHERE ${where.join(' AND ')}
      GROUP BY a.title, a.activity_date, g.name, sec.name, st.id, st.lrn, st.last_name, st.first_name,
               att.status, att.parent_present, pay.paid, pay.amount, pay.payment_date, c.id, a.fee_type
      ORDER BY g.id, sec.name, st.last_name, st.first_name
    `

    const [rows] = await db.query(sql, params)

    if (fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="activity_${activity_id}_sy_${syId}.csv"`)
      res.write(['activity', 'date', 'grade', 'section', 'lrn', 'last', 'first', 'parents', 'attendance', 'parent_present', 'payment_status', 'amount', 'payment_date'].map(csv).join(',') + '\n')
      for (const r of rows) res.write([r.title, r.activity_date, r.grade_name, r.section_name, r.lrn, r.last_name, r.first_name, r.parents, r.attendance_status, r.parent_present, r.payment_status, r.amount, r.payment_date].map(csv).join(',') + '\n')
      res.end()

      return
    }

    if (fmt === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="activity_${activity_id}_sy_${syId}.xlsx"`)
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res })
      const sheet = workbook.addWorksheet('Activity Export')
      sheet.addRow(['Activity', 'Date', 'Grade', 'Section', 'LRN', 'Last Name', 'First Name', 'Parents', 'Attendance', 'Parent Present', 'Payment Status', 'Amount', 'Payment Date']).commit()
      for (const r of rows) sheet.addRow([r.title, r.activity_date, r.grade_name, r.section_name, r.lrn, r.last_name, r.first_name, r.parents, r.attendance_status, Number(r.parent_present), r.payment_status, Number(r.amount || 0), r.payment_date]).commit()
      await workbook.commit()

      return
    }

    if (fmt === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="activity_${activity_id}_sy_${syId}.pdf"`)
      const doc = new PDFDocument({ margin: 40, size: 'A4' })
      doc.pipe(res)
      doc.fontSize(14).text(`Activity Export - ${rows[0]?.title || activity_id}`)
      doc.moveDown()
      doc.fontSize(9)
      for (const r of rows) {
        doc.text(`${r.grade_name}-${r.section_name} | ${r.lrn} ${r.last_name}, ${r.first_name} | ${r.attendance_status} | ${r.payment_status}`)
        if (doc.y > doc.page.height - 50) doc.addPage()
      }
      doc.end()

      return
    }

    return res.status(400).json({ message: 'Unsupported format' })
  } catch (err) {
    console.error('Export activity error:', err)
    if (!res.headersSent) return res.status(500).json({ message: 'Internal server error' })
  }
}
