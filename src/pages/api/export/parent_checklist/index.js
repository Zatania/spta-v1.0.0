// pages/api/export/parent_checklist.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import PDFDocument from 'pdfkit'

/**
 * GET /api/export/parent_checklist?assignment_id=...
 * Returns a PDF with rows:
 *   Activity | Date | Student LRN | Student Name | Parent Signature (blank) | Remarks
 *
 * Permissions: admin or teacher assigned to the assignment.section
 */
export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const assignmentId = Number(req.query.assignment_id)
    if (!assignmentId) return res.status(400).json({ message: 'assignment_id is required' })

    // verify assignment exists
    const [assRows] = await db.query(
      `
      SELECT aa.id, aa.activity_id, aa.grade_id, aa.section_id, a.title, a.activity_date, g.name AS grade_name, s.name AS section_name
      FROM activity_assignments aa
      JOIN activities a ON a.id = aa.activity_id
      JOIN grades g ON g.id = aa.grade_id
      JOIN sections s ON s.id = aa.section_id
      WHERE aa.id = ? LIMIT 1
    `,
      [assignmentId]
    )
    if (!assRows.length) return res.status(404).json({ message: 'Assignment not found' })
    const ass = assRows[0]

    if (session.user.role === 'teacher') {
      const [ok] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
        session.user.id,
        ass.section_id
      ])
      if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
    }

    // fetch students & parent names (one row per student; parent list can be shown on separate lines if multiple parents)
    const [rows] = await db.query(
      `
      SELECT st.id AS student_id, st.lrn, st.last_name, st.first_name,
        p.id AS parent_id, p.first_name AS parent_first, p.last_name AS parent_last
      FROM students st
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents p ON p.id = sp.parent_id AND p.is_deleted = 0
      WHERE st.is_deleted = 0 AND st.grade_id = ? AND st.section_id = ?
      ORDER BY st.last_name, st.first_name
    `,
      [ass.grade_id, ass.section_id]
    )

    // group parents per student
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.student_id))
        map.set(r.student_id, { lrn: r.lrn, name: `${r.last_name}, ${r.first_name}`, parents: [] })
      if (r.parent_id) map.get(r.student_id).parents.push(`${r.parent_last}, ${r.parent_first}`)
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="parent_checklist_assignment_${assignmentId}.pdf"`)

    const doc = new PDFDocument({ margin: 40, size: 'A4' })
    doc.pipe(res)

    // Header
    doc.fontSize(16).text('Parent Attendance Checklist', { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Activity: ${ass.title}`)
    doc.text(`Date: ${ass.activity_date}`)
    doc.text(`Grade: ${ass.grade_name}  •  Section: ${ass.section_name}`)
    doc.moveDown(0.5)

    // Table header
    const startX = doc.x
    doc.fontSize(10).text('LRN', startX, doc.y, { width: 80, continued: true })
    doc.text('Student Name', { continued: true, width: 220 })
    doc.text('Parent(s)', { continued: true, width: 180 })
    doc.text('Parent Signature', { width: 120 })
    doc.moveDown(0.5)

    // rows: print 1 student per line, but if multiple parents we print them in the same parents cell separated by semicolons
    for (const [studentId, info] of map.entries()) {
      doc.fontSize(10).text(info.lrn || '', { continued: true, width: 80 })
      doc.text(info.name, { continued: true, width: 220 })
      doc.text(info.parents.join('; ') || '', { continued: true, width: 180 })

      // Signature line (blank)
      const sigX = doc.x
      const sigY = doc.y
      doc.moveDown(0.6)
      doc
        .moveTo(sigX - 5, sigY + 8)
        .lineTo(sigX + 110, sigY + 8)
        .stroke()
      doc.moveDown(0.2)

      // small space before next row
      doc.moveDown(0.1)
    }

    doc.end()
  } catch (err) {
    console.error('Parent checklist export error:', err)
    if (!res.headersSent) return res.status(500).json({ message: 'Internal server error' })
  }
}
