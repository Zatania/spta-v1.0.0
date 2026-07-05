import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import PDFDocument from 'pdfkit'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const assignmentId = Number(req.query.assignment_id)
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) return res.status(400).json({ message: 'assignment_id is required' })

    const [[assignment]] = await db.query(
      `SELECT
          aa.id,
          aa.activity_id,
          aa.grade_id,
          aa.section_id,
          a.school_year_id,
          a.title,
          DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
          g.name AS grade_name,
          s.name AS section_name
         FROM activity_assignments aa
         JOIN activities a ON a.id = aa.activity_id AND a.is_deleted = 0
         JOIN grades g ON g.id = aa.grade_id
         JOIN sections s ON s.id = aa.section_id
        WHERE aa.id = ?
        LIMIT 1`,
      [assignmentId]
    )
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

    if (session.user.role === 'teacher') {
      const [[ok]] = await db.query(
        `SELECT 1
           FROM teacher_sections
          WHERE user_id = ?
            AND section_id = ?
            AND school_year_id = ?
            AND is_active = 1
          LIMIT 1`,
        [session.user.id, assignment.section_id, assignment.school_year_id]
      )
      if (!ok) return res.status(403).json({ message: 'Forbidden' })
    }

    const [rows] = await db.query(
      `SELECT
          st.id AS student_id,
          st.lrn,
          st.last_name,
          st.first_name,
          p.id AS parent_id,
          p.first_name AS parent_first,
          p.last_name AS parent_last
         FROM student_enrollments en
         JOIN students st ON st.id = en.student_id AND st.is_deleted = 0
         LEFT JOIN student_parents sp ON sp.student_id = st.id
         LEFT JOIN parents p ON p.id = sp.parent_id AND p.is_deleted = 0
        WHERE en.school_year_id = ?
          AND en.status = 'active'
          AND en.grade_id = ?
          AND en.section_id = ?
        ORDER BY st.last_name, st.first_name, p.last_name`,
      [assignment.school_year_id, assignment.grade_id, assignment.section_id]
    )

    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.student_id)) {
        map.set(r.student_id, { lrn: r.lrn, name: `${r.last_name}, ${r.first_name}`, parents: [] })
      }
      if (r.parent_id) map.get(r.student_id).parents.push(`${r.parent_last}, ${r.parent_first}`)
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="parent_checklist_assignment_${assignmentId}.pdf"`)

    const doc = new PDFDocument({ margin: 40, size: 'A4' })
    doc.pipe(res)

    doc.fontSize(16).text('Parent Attendance Checklist', { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Activity: ${assignment.title}`)
    doc.text(`Date: ${assignment.activity_date}`)
    doc.text(`Grade/Section: ${assignment.grade_name} - ${assignment.section_name}`)
    doc.moveDown(0.5)

    doc.fontSize(10).text('LRN', { continued: true, width: 90 })
    doc.text('Student Name', { continued: true, width: 190 })
    doc.text('Parent(s)', { continued: true, width: 170 })
    doc.text('Parent Signature', { width: 120 })
    doc.moveDown(0.5)

    for (const info of map.values()) {
      doc.text(info.lrn || '', { continued: true, width: 90 })
      doc.text(info.name, { continued: true, width: 190 })
      doc.text(info.parents.join('; ') || '', { continued: true, width: 170 })
      const y = doc.y
      const x = doc.x
      doc.moveTo(x, y + 8).lineTo(x + 110, y + 8).stroke()
      doc.moveDown(1)
      if (doc.y > doc.page.height - 60) doc.addPage()
    }

    doc.end()
  } catch (err) {
    console.error('Parent checklist export error:', err)
    if (!res.headersSent) return res.status(500).json({ message: 'Internal server error' })
  }
}
