// pages/api/export/activity.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import streamifier from 'streamifier'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { activity_id, section_id = null, format = 'csv', search = '' } = req.query
    if (!activity_id) return res.status(400).json({ message: 'activity_id is required' })

    // If teacher, ensure they have access to requested section (if provided) or at least one assignment (if section not provided)
    if (session.user.role === 'teacher') {
      if (section_id) {
        const [check] = await db.query(
          `SELECT 1 FROM activity_assignments aa JOIN teacher_sections ts ON ts.section_id = aa.section_id WHERE aa.activity_id = ? AND aa.section_id = ? AND ts.user_id = ? LIMIT 1`,
          [activity_id, section_id, session.user.id]
        )
        if (!check || check.length === 0) return res.status(403).json({ message: 'Forbidden' })
      } else {
        // ensure teacher has at least one assignment for this activity
        const [check] = await db.query(
          `SELECT 1 FROM activity_assignments aa JOIN teacher_sections ts ON ts.section_id = aa.section_id WHERE aa.activity_id = ? AND ts.user_id = ? LIMIT 1`,
          [activity_id, session.user.id]
        )
        if (!check || check.length === 0) return res.status(403).json({ message: 'Forbidden' })
      }
    }

    // find assignment(s)
    const assignmentSql = section_id
      ? `SELECT id FROM activity_assignments WHERE activity_id = ? AND section_id = ? LIMIT 1`
      : `SELECT id FROM activity_assignments WHERE activity_id = ?`

    const [assignRows] = section_id
      ? await db.query(assignmentSql, [activity_id, section_id])
      : await db.query(assignmentSql, [activity_id])

    if (!assignRows || assignRows.length === 0) return res.status(200).json({ message: 'No data' })

    // We'll export across assignment rows (if multiple sections) — accumulate assignment ids
    const assignmentIds = assignRows.map(r => r.id)

    // CSV export (chunked)
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=activity_${activity_id}${section_id ? `_sec_${section_id}` : ''}.csv`
      )

      // header row
      res.write('lrn,student_last,student_first,parents,attendance_status,parent_present,paid,payment_date\n')

      const CHUNK = 1000
      let offset = 0
      while (true) {
        // fetch a chunk of rows across assignmentIds
        const sql = `
          SELECT st.lrn, st.last_name, st.first_name,
            GROUP_CONCAT(CONCAT(pa.first_name,' ',pa.last_name) SEPARATOR '; ') AS parents,
            att.status AS attendance_status, att.parent_present,
            pay.paid, pay.payment_date
          FROM students st
          LEFT JOIN student_parents sp ON sp.student_id = st.id
          LEFT JOIN parents pa ON pa.id = sp.parent_id
          LEFT JOIN attendance att ON att.student_id = st.id AND att.activity_assignment_id IN (?)
          LEFT JOIN payments pay ON pay.student_id = st.id AND pay.activity_assignment_id IN (?)
          WHERE st.is_deleted = 0 AND st.section_id IN (
            SELECT section_id FROM activity_assignments WHERE activity_id = ?
          )
          ${search ? `AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)` : ''}
          GROUP BY st.id
          ORDER BY st.last_name, st.first_name
          LIMIT ? OFFSET ?
        `
        const params = [assignmentIds, assignmentIds, activity_id]
        if (search) params.push(`%${search}%`, `%${search}%`, `%${search}%`)
        params.push(CHUNK, offset)
        const [rows] = await db.query(sql, params)

        if (!rows || rows.length === 0) break

        for (const r of rows) {
          const vals = [
            r.lrn ?? '',
            r.last_name ?? '',
            r.first_name ?? '',
            (r.parents ?? '').replace(/"/g, '""'),
            r.attendance_status ?? '',
            r.parent_present ? '1' : '0',
            r.paid === 1 ? '1' : r.paid === 0 ? '0' : '',
            r.payment_date ? new Date(r.payment_date).toISOString().split('T')[0] : ''
          ]

          // CSV escaping
          const csvLine =
            vals
              .map(v =>
                typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))
                  ? `"${v.replace(/"/g, '""')}"`
                  : v
              )
              .join(',') + '\n'
          res.write(csvLine)
        }

        offset += CHUNK
      }

      // finish
      res.end()

      return
    }

    // XLSX export using exceljs streaming
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=activity_${activity_id}${section_id ? `_sec_${section_id}` : ''}.xlsx`
      )

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res })
      const sheet = workbook.addWorksheet('Activity Export')
      sheet
        .addRow(['LRN', 'Last Name', 'First Name', 'Parents', 'Attendance', 'Parent Present', 'Paid', 'Payment Date'])
        .commit()

      // stream in chunks (same chunk logic)
      const CHUNK = 1000
      let offset = 0
      while (true) {
        const sql = `
          SELECT st.lrn, st.last_name, st.first_name,
            GROUP_CONCAT(CONCAT(pa.first_name,' ',pa.last_name) SEPARATOR '; ') AS parents,
            att.status AS attendance_status, att.parent_present,
            pay.paid, pay.payment_date
          FROM students st
          LEFT JOIN student_parents sp ON sp.student_id = st.id
          LEFT JOIN parents pa ON pa.id = sp.parent_id
          LEFT JOIN attendance att ON att.student_id = st.id AND att.activity_assignment_id IN (?)
          LEFT JOIN payments pay ON pay.student_id = st.id AND pay.activity_assignment_id IN (?)
          WHERE st.is_deleted = 0 AND st.section_id IN (
            SELECT section_id FROM activity_assignments WHERE activity_id = ?
          )
          ${search ? `AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)` : ''}
          GROUP BY st.id
          ORDER BY st.last_name, st.first_name
          LIMIT ? OFFSET ?
        `
        const params = [assignmentIds, assignmentIds, activity_id]
        if (search) params.push(`%${search}%`, `%${search}%`, `%${search}%`)
        params.push(CHUNK, offset)
        const [rows] = await db.query(sql, params)

        if (!rows || rows.length === 0) break

        for (const r of rows) {
          sheet
            .addRow([
              r.lrn ?? '',
              r.last_name ?? '',
              r.first_name ?? '',
              r.parents ?? '',
              r.attendance_status ?? '',
              r.parent_present ? 1 : 0,
              r.paid === 1 ? 1 : r.paid === 0 ? 0 : '',
              r.payment_date ? new Date(r.payment_date).toISOString().split('T')[0] : ''
            ])
            .commit()
        }
        offset += CHUNK
      }

      await workbook.commit()

      // response ends when workbook stream ends
      return
    }

    // PDF export using pdfkit (stream)
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=activity_${activity_id}${section_id ? `_sec_${section_id}` : ''}.pdf`
      )

      const doc = new PDFDocument({ margin: 30, size: 'A4' })
      doc.pipe(res)

      doc.fontSize(14).text(`Activity ${activity_id} — Export`, { align: 'left' })
      doc.moveDown(0.5)
      doc.fontSize(10)

      // table header
      const header = ['LRN', 'Last', 'First', 'Parents', 'Attend', 'Parent Present', 'Paid', 'Payment Date']
      doc.text(header.join(' | '))
      doc.moveDown(0.2)
      doc
        .moveTo(doc.x, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke()

      const CHUNK = 500
      let offset = 0
      while (true) {
        const sql = `
          SELECT st.lrn, st.last_name, st.first_name,
            GROUP_CONCAT(CONCAT(pa.first_name,' ',pa.last_name) SEPARATOR '; ') AS parents,
            att.status AS attendance_status, att.parent_present,
            pay.paid, pay.payment_date
          FROM students st
          LEFT JOIN student_parents sp ON sp.student_id = st.id
          LEFT JOIN parents pa ON pa.id = sp.parent_id
          LEFT JOIN attendance att ON att.student_id = st.id AND att.activity_assignment_id IN (?)
          LEFT JOIN payments pay ON pay.student_id = st.id AND pay.activity_assignment_id IN (?)
          WHERE st.is_deleted = 0 AND st.section_id IN (
            SELECT section_id FROM activity_assignments WHERE activity_id = ?
          )
          ${search ? `AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.lrn LIKE ?)` : ''}
          GROUP BY st.id
          ORDER BY st.last_name, st.first_name
          LIMIT ? OFFSET ?
        `
        const params = [assignmentIds, assignmentIds, activity_id]
        if (search) params.push(`%${search}%`, `%${search}%`, `%${search}%`)
        params.push(CHUNK, offset)
        const [rows] = await db.query(sql, params)

        if (!rows || rows.length === 0) break

        for (const r of rows) {
          const line = [
            r.lrn ?? '',
            (r.last_name ?? '').slice(0, 15),
            (r.first_name ?? '').slice(0, 15),
            (r.parents ?? '').slice(0, 40),
            r.attendance_status ?? '',
            r.parent_present ? 'Y' : 'N',
            r.paid === 1 ? 'Y' : r.paid === 0 ? 'N' : '',
            r.payment_date ? new Date(r.payment_date).toISOString().split('T')[0] : ''
          ]
          doc.text(line.join(' | '))

          // page break if necessary
          if (doc.y > doc.page.height - doc.page.margins.bottom - 20) doc.addPage()
        }

        offset += CHUNK
      }

      doc.end()

      return
    }

    return res.status(400).json({ message: 'Unsupported format' })
  } catch (err) {
    console.error('Export error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
