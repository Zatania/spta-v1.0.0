import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { resolveSchoolYearId } from '../../lib/schoolYear'
import ExcelJS from 'exceljs'

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
    const { format = 'csv', grade_id = '', section_id = '', search = '', lrn = '' } = req.query
    const fmt = String(format).toLowerCase()

    const where = ['st.is_deleted = 0', 'en.school_year_id = ?', "en.status = 'active'"]
    const params = [syId]

    if (grade_id) {
      where.push('en.grade_id = ?')
      params.push(grade_id)
    }
    if (section_id) {
      where.push('en.section_id = ?')
      params.push(section_id)
    }
    if (lrn) {
      where.push('st.lrn = ?')
      params.push(lrn)
    }
    if (search) {
      where.push('(st.first_name LIKE ? OR st.last_name LIKE ? OR CONCAT(st.first_name, " ", st.last_name) LIKE ? OR st.lrn LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
    }

    if (session.user.role === 'teacher') {
      where.push(`en.section_id IN (
        SELECT section_id FROM teacher_sections
        WHERE user_id = ? AND school_year_id = ? AND is_active = 1
      )`)
      params.push(session.user.id, syId)
    }

    const sql = `
      SELECT
        st.id,
        st.lrn,
        st.first_name,
        st.last_name,
        g.name AS grade_name,
        sec.name AS section_name,
        GROUP_CONCAT(DISTINCT CONCAT(p.first_name, ' ', p.last_name) ORDER BY p.last_name SEPARATOR '; ') AS parents
      FROM student_enrollments en
      JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
      JOIN grades g ON g.id = en.grade_id
      JOIN sections sec ON sec.id = en.section_id
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents p ON p.id = sp.parent_id AND p.is_deleted = 0
      WHERE ${where.join(' AND ')}
      GROUP BY st.id, st.lrn, st.first_name, st.last_name, g.name, sec.name
      ORDER BY sec.name, st.last_name, st.first_name
    `

    if (fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="students_sy_${syId}.csv"`)
      res.write(['lrn', 'last_name', 'first_name', 'grade', 'section', 'parents'].map(csv).join(',') + '\n')

      const [rows] = await db.query(sql, params)
      for (const r of rows) {
        res.write([r.lrn, r.last_name, r.first_name, r.grade_name, r.section_name, r.parents].map(csv).join(',') + '\n')
      }
      res.end()

      return
    }

    if (fmt === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="students_sy_${syId}.xlsx"`)

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res })
      const sheet = workbook.addWorksheet('Students')
      sheet.addRow(['LRN', 'Last Name', 'First Name', 'Grade', 'Section', 'Parents']).commit()

      const [rows] = await db.query(sql, params)
      for (const r of rows) sheet.addRow([r.lrn, r.last_name, r.first_name, r.grade_name, r.section_name, r.parents]).commit()
      await workbook.commit()

      return
    }

    return res.status(400).json({ message: 'Unsupported format' })
  } catch (err) {
    console.error('Export students error:', err)
    if (!res.headersSent) return res.status(500).json({ message: 'Internal server error' })
  }
}
