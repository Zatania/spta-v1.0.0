// pages/api/teacher/forms/parent-checklist.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../auth/[...nextauth]'
import db from '../../../db'
import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'

/**
 * GET /api/teacher/forms/parent-checklist?student_id=...&school_year=YYYY-YYYY
 * - Embeds transparent PNG logos (if present)
 * - Aligns logos vertically to the center of the header text block
 * - Lists only activities created by the logged-in teacher assigned to the student's section
 * - Groups activities by date (desc) and adds a Parent Present checkbox + Signature column
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const teacherId = session.user.id
  const studentId = Number(req.query.student_id)
  const schoolYear = (req.query.school_year || '').trim()

  if (!studentId) return res.status(400).json({ message: 'student_id is required' })

  try {
    // --- Load student info ---
    const [studentRows] = await db.query(
      `
      SELECT st.id, st.first_name, st.last_name, st.lrn, st.grade_id, st.section_id,
             g.name AS grade_name, s.name AS section_name
      FROM students st
      JOIN grades g ON g.id = st.grade_id
      JOIN sections s ON s.id = st.section_id
      WHERE st.id = ? AND st.is_deleted = 0
      LIMIT 1
    `,
      [studentId]
    )
    const student = studentRows[0]
    if (!student) return res.status(404).json({ message: 'Student not found' })

    // --- Permission: teacher must be assigned to the student's section ---
    const [ownRows] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
      teacherId,
      student.section_id
    ])
    if (!ownRows.length) return res.status(403).json({ message: 'Not allowed to generate form for this student' })

    // --- Parents ---
    const [parentRows] = await db.query(
      `
      SELECT p.first_name, p.last_name
      FROM student_parents sp
      JOIN parents p ON p.id = sp.parent_id
      WHERE sp.student_id = ?
    `,
      [studentId]
    )
    const parentNames = parentRows.map(p => `${p.first_name} ${p.last_name}`)

    // --- Determine date range from schoolYear (optional) ---
    let dateClause = ''
    const params = [teacherId, student.section_id]
    if (schoolYear) {
      const parts = schoolYear.split('-').map(p => Number(p))
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const start = `${parts[0]}-06-01`
        const end = `${parts[1]}-05-31`
        dateClause = ' AND a.activity_date BETWEEN ? AND ? '
        params.push(start, end)
      }
    } else {
      // default to current calendar year
      dateClause = ' AND YEAR(a.activity_date) = YEAR(CURDATE()) '
    }

    // --- Activities created by teacher and assigned to this section ---
    const [actRows] = await db.query(
      `
      SELECT DISTINCT a.id AS activity_id, a.title, a.activity_date, aa.id AS activity_assignment_id
      FROM activities a
      JOIN activity_assignments aa ON aa.activity_id = a.id
      WHERE a.created_by = ?
        AND aa.section_id = ?
        AND a.is_deleted = 0
        ${dateClause}
      ORDER BY a.activity_date ASC
    `,
      params
    )

    // --- Attendance map for pre-checking Parent Present ---
    const aaIds = actRows.map(r => r.activity_assignment_id).filter(Boolean)
    let attendanceMap = new Map()
    if (aaIds.length) {
      const [attRows] = await db.query(
        `
        SELECT activity_assignment_id, parent_present
        FROM attendance
        WHERE activity_assignment_id IN (${aaIds.map(() => '?').join(',')})
          AND student_id = ?
        `,
        [...aaIds, studentId]
      )
      for (const r of attRows) attendanceMap.set(Number(r.activity_assignment_id), !!r.parent_present)
    }

    // --- Group activities by date (YYYY-MM-DD) preserving descending order ---
    const groups = []
    for (const r of actRows) {
      const dateKey = r.activity_date ? new Date(r.activity_date).toISOString().slice(0, 10) : 'No date'
      let grp = groups.find(g => g.dateKey === dateKey)
      if (!grp) {
        grp = {
          dateKey,
          dateLabel: r.activity_date ? new Date(r.activity_date).toLocaleDateString() : '',
          activities: []
        }
        groups.push(grp)
      }
      grp.activities.push({
        activity_assignment_id: r.activity_assignment_id,
        activity_id: r.activity_id,
        title: r.title,
        date: r.activity_date,
        parent_present: attendanceMap.get(Number(r.activity_assignment_id)) || false
      })
    }

    // --- PDF setup: logos + tunables ---
    const publicDir = path.join(process.cwd(), 'public')
    const logoLeftRel = process.env.LOGO_LEFT || 'logos/left.png'
    const logoRightRel = process.env.LOGO_RIGHT || 'logos/right.png'
    const logoLeftPath = path.join(publicDir, logoLeftRel)
    const logoRightPath = path.join(publicDir, logoRightRel)
    const leftLogoExists = fs.existsSync(logoLeftPath)
    const rightLogoExists = fs.existsSync(logoRightPath)

    // Tunable sizes / offsets (env vars)
    const logoWidth = Number(process.env.LOGO_WIDTH || 72) // px
    const logoHeight = Number(process.env.LOGO_HEIGHT || 72)

    const schoolDepEd = 'Republic of the Philippines'
    const schoolDepEdSub = 'Department of Education'
    const schoolRegion = process.env.SCHOOL_REGION || 'CARAGA Region'
    const schoolCity = process.env.SCHOOL_CITY || 'BAYUGAN CITY'
    const schoolName = process.env.SCHOOL_NAME || 'Bayugan Central Elementary School - SPED Center'
    const formTitle = 'SCHOOL PARENT-TEACHER ASSOCIATION'

    const filename = `SPTA_Checklist_${student.last_name}_${student.first_name}_${student.grade_name}_${
      student.section_name
    }${schoolYear ? `_${schoolYear}` : ''}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/\s+/g, '_')}"`)

    const doc = new PDFDocument({ size: 'A4', margin: 36 })
    doc.pipe(res)

    // --- HEADER LAYOUT (logos vertically centered with text block) ---
    const pageWidth = doc.page.width
    const left = doc.page.margins.left
    const right = pageWidth - doc.page.margins.right
    const contentWidth = right - left

    // Pre-calculate header text heights using the actual fonts/sizes we'll draw with
    // We'll treat each line separately to account for different font sizes.
    const headerLines = [
      { text: schoolDepEd, font: 'Helvetica-Bold', size: 11 },
      { text: schoolDepEdSub, font: 'Helvetica', size: 10 },
      { text: schoolRegion, font: 'Helvetica', size: 10 },
      { text: schoolCity, font: 'Helvetica', size: 10 },
      { text: schoolName, font: 'Helvetica-Bold', size: 12 },
      { text: formTitle, font: 'Helvetica-Bold', size: 14 } // we'll underline when drawing
    ]

    const lineGap = 2 // small gap in px between lines
    let totalHeaderTextHeight = 0

    // measure each line height
    for (const ln of headerLines) {
      doc.font(ln.font).fontSize(ln.size)
      const h = doc.heightOfString(ln.text, { width: contentWidth, align: 'center' })
      totalHeaderTextHeight += h + lineGap
    }
    totalHeaderTextHeight -= lineGap // remove last gap

    // Decide header Y start (current doc.y)
    const headerStartY = doc.y

    // Determine logo vertical position that centers logos with the header text block
    const logosHeight = Math.max(leftLogoExists ? logoHeight : 0, rightLogoExists ? logoHeight : 0)

    // vertical center of header text block:
    const headerTextCenterY = headerStartY + totalHeaderTextHeight / 2

    // top Y to draw logos so logos are vertically centered with headerTextCenterY
    const logoTopY = Math.max(headerStartY, Math.round(headerTextCenterY - logosHeight / 2))

    // Place left logo if present (left margin)
    if (leftLogoExists) {
      try {
        doc.image(logoLeftPath, left, logoTopY, { width: logoWidth, height: logoHeight })
      } catch (e) {
        console.warn('Left logo load failed', e)
      }
    }

    // Place right logo if present (right aligned)
    if (rightLogoExists) {
      try {
        doc.image(logoRightPath, right - logoWidth, logoTopY, { width: logoWidth, height: logoHeight })
      } catch (e) {
        console.warn('Right logo load failed', e)
      }
    }

    // Now draw the header text block starting at headerStartY, center-aligned
    let yCursor = headerStartY
    for (const ln of headerLines) {
      doc.font(ln.font).fontSize(ln.size)

      // For the form title (last line) underline it by drawing a separate underline after rendering
      const options = { width: contentWidth, align: 'center' }

      // Compute the height of this line to know how much to advance yCursor
      const h = doc.heightOfString(ln.text, options)
      doc.text(ln.text, left, yCursor, options)

      // If this is the formTitle, draw underline under the text (thin)
      if (ln.text === formTitle) {
        const titleWidth = doc.widthOfString(ln.text)

        // center x start
        const titleStartX = left + (contentWidth - titleWidth) / 2
        const underlineY = yCursor + h + 2
        doc
          .moveTo(titleStartX, underlineY)
          .lineTo(titleStartX + titleWidth, underlineY)
          .lineWidth(0.8)
          .stroke()
      }
      yCursor += h + lineGap
    }

    // Move doc.y to after the header block (plus small spacing)
    doc.y = Math.max(yCursor, logoTopY + logosHeight) + 8

    // --- Info lines with fixed two-column layout to ensure alignment ---
    const labelColWidth = 190
    const valueColStartX = left + labelColWidth + 8
    const underlineRight = right
    doc.font('Helvetica').fontSize(10)

    const infoRows = [
      { label: 'Name of Parent/ Guardian:', value: parentNames.join(', ') || '________________________' },
      { label: 'Name of Pupils Enrolled:', value: `${student.last_name}, ${student.first_name}` },
      { label: 'Grade and Section:', value: `${student.grade_name} - ${student.section_name}` },
      { label: 'School Year:', value: schoolYear || '________________' }
    ]

    for (const row of infoRows) {
      const yBefore = doc.y
      doc.text(row.label, left, yBefore, { width: labelColWidth - 8, align: 'left' })
      const maxValueWidth = underlineRight - valueColStartX
      doc.text(row.value, valueColStartX, yBefore, { width: maxValueWidth })
      const underlineY = Math.max(yBefore, doc.y) + 8
      doc.moveTo(valueColStartX, underlineY).lineTo(underlineRight, underlineY).lineWidth(0.4).stroke()
      doc.moveDown(0.6)
    }

    doc.moveDown(0.4)

    // --- Activity table header and body (unchanged logic) ---
    const tableLeft = left
    const tableWidth = right - tableLeft
    const colActivity = Math.round(tableWidth * 0.4)
    const colDate = Math.round(tableWidth * 0.15)
    const colParentPresent = Math.round(tableWidth * 0.3)
    const colSignature = tableWidth - colActivity - colDate - colParentPresent
    const rowHeight = 22
    let y = doc.y + 6

    // header row box
    doc.rect(tableLeft, y, tableWidth, rowHeight).stroke()
    doc.font('Helvetica-Bold').fontSize(10)
    doc.text('ACTIVITY', tableLeft + 6, y + 6, { width: colActivity - 12 })
    doc.text('DATE', tableLeft + colActivity + 6, y + 6, { width: colDate - 12 })
    doc.text('PARENT PRESENT', tableLeft + colActivity + colDate + 6, y + 6, {
      width: colParentPresent - 12,
      align: 'center'
    })
    doc.text('SIGNATURE', tableLeft + colActivity + colDate + colParentPresent + 6, y + 6, { width: colSignature - 12 })
    y += rowHeight
    doc.font('Helvetica').fontSize(10)

    if (!groups.length) {
      const blankRows = 8
      for (let i = 0; i < blankRows; i++) {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 60) {
          doc.addPage()
          y = doc.y + 6
        }
        doc.rect(tableLeft, y, tableWidth, rowHeight).stroke()
        y += rowHeight
      }
    } else {
      for (const grp of groups) {
        /* if (y + 18 > doc.page.height - doc.page.margins.bottom - 60) {
          doc.addPage()
          y = doc.y + 6
        }
        doc.font('Helvetica-Bold').fontSize(10)
        doc.text(grp.dateLabel || grp.dateKey || 'No date', tableLeft, y, { width: tableWidth })
        y += 16
        doc.font('Helvetica').fontSize(10) */

        for (const act of grp.activities) {
          if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 60) {
            doc.addPage()
            y = doc.y + 6
          }
          doc.rect(tableLeft, y, tableWidth, rowHeight).stroke()
          doc.text(act.title || '', tableLeft + 6, y + 6, { width: colActivity - 12, height: rowHeight - 6 })
          const dateStr = act.date ? new Date(act.date).toLocaleDateString() : ''
          doc.text(dateStr, tableLeft + colActivity + 6, y + 6, { width: colDate - 12 })

          const boxSize = 12
          const boxX = tableLeft + colActivity + colDate + Math.round((colParentPresent - boxSize) / 2)
          const boxY = y + Math.round((rowHeight - boxSize) / 2)
          doc.rect(boxX, boxY, boxSize, boxSize).stroke()
          if (act.parent_present) {
            doc
              .moveTo(boxX + 2, boxY + 2)
              .lineTo(boxX + boxSize - 2, boxY + boxSize - 2)
              .stroke()
            doc
              .moveTo(boxX + boxSize - 2, boxY + 2)
              .lineTo(boxX + 2, boxY + boxSize - 2)
              .stroke()
          }
          y += rowHeight
        }
        y += 6
      }
    }

    // Footer lines
    if (y + 80 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage()
      y = doc.y + 6
    }
    const footerY = y + 16
    const mid = tableLeft + tableWidth / 2

    doc.text('Prepared By:', tableLeft, footerY)
    doc
      .moveTo(tableLeft + 80, footerY + 12)
      .lineTo(mid - 12, footerY + 12)
      .lineWidth(0.4)
      .stroke()
    doc.text('HRPTA Secretary', tableLeft + 80, footerY + 16)

    doc.text('Approved By:', mid + 12, footerY)
    doc
      .moveTo(mid + 100, footerY + 12)
      .lineTo(right, footerY + 12)
      .lineWidth(0.4)
      .stroke()

    doc.end()
  } catch (err) {
    console.error('parent-checklist error', err)
    if (!res.headersSent) return res.status(500).json({ message: 'Internal server error' })
  }
}
