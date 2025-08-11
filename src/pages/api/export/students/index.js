// pages/api/export/students.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db' // adjust path if needed
import ExcelJS from 'exceljs'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const {
      format = 'csv', // 'csv' or 'xlsx'
      grade_id = null,
      section_id = null,
      search = '',
      lrn = ''
    } = req.query

    // Build base where & params, similar to /api/students
    const where = ['st.is_deleted = 0']
    const params = []

    if (grade_id) {
      where.push('st.grade_id = ?')
      params.push(grade_id)
    }
    if (section_id) {
      where.push('st.section_id = ?')
      params.push(section_id)
    }
    if (lrn) {
      where.push('st.lrn = ?')
      params.push(lrn)
    }
    if (search) {
      where.push('(st.first_name LIKE ? OR st.last_name LIKE ? OR CONCAT(st.first_name, " ", st.last_name) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    // teacher restriction: only allow export of assigned sections
    if (session.user.role === 'teacher') {
      where.push('st.section_id IN (SELECT section_id FROM teacher_sections WHERE user_id = ?)')
      params.push(session.user.id)
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    // We'll query in chunks using LIMIT/OFFSET
    const CHUNK = 1000
    let offset = 0

    // SQL to fetch students with parents (GROUP_CONCAT)
    const sql = `
      SELECT
        st.id,
        st.lrn,
        st.first_name,
        st.last_name,
        st.grade_id,
        st.section_id,
        g.name AS grade_name,
        s.name AS section_name,
        GROUP_CONCAT(CONCAT(p.first_name, ' ', p.last_name) SEPARATOR '; ') AS parents
      FROM students st
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents p ON p.id = sp.parent_id AND p.is_deleted = 0
      LEFT JOIN grades g ON g.id = st.grade_id
      LEFT JOIN sections s ON s.id = st.section_id
      ${whereSql}
      GROUP BY st.id
      ORDER BY st.last_name, st.first_name
      LIMIT ? OFFSET ?
    `

    // CSV export
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename=students_export.csv`)

      // header row
      const header = ['lrn', 'last_name', 'first_name', 'grade_name', 'section_name', 'parents']
      res.write(header.join(',') + '\n')

      while (true) {
        const rows = (await db.query(sql, [...params, CHUNK, offset]))[0]
        if (!rows || rows.length === 0) break

        for (const r of rows) {
          const vals = [
            r.lrn ?? '',
            r.last_name ?? '',
            r.first_name ?? '',
            r.grade_name ?? '',
            r.section_name ?? '',
            r.parents ?? ''
          ].map(v => {
            if (v === null || v === undefined) return ''
            const s = String(v)

            // escape if needed
            if (s.includes('"') || s.includes(',') || s.includes('\n')) {
              return `"${s.replace(/"/g, '""')}"`
            }

            return s
          })
          res.write(vals.join(',') + '\n')
        }

        offset += CHUNK
      }

      res.end()

      return
    }

    // XLSX export
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename=students_export.xlsx`)

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res })
      const sheet = workbook.addWorksheet('Students')

      // add header row
      sheet.addRow(['LRN', 'Last Name', 'First Name', 'Grade', 'Section', 'Parents']).commit()

      while (true) {
        const rows = (await db.query(sql, [...params, CHUNK, offset]))[0]
        if (!rows || rows.length === 0) break

        for (const r of rows) {
          sheet
            .addRow([
              r.lrn ?? '',
              r.last_name ?? '',
              r.first_name ?? '',
              r.grade_name ?? '',
              r.section_name ?? '',
              r.parents ?? ''
            ])
            .commit()
        }

        offset += CHUNK
      }

      await workbook.commit()

      // response will end when workbook finishes streaming
      return
    }

    return res.status(400).json({ message: 'Unsupported format' })
  } catch (err) {
    console.error('Export students error:', err)

    // If headers already sent, attempt to end response
    try {
      if (!res.headersSent) res.status(500).json({ message: 'Internal server error' })
    } catch (e) {}
  }
}
