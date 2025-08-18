// pages/api/teacher/reports/attendance.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../auth/[...nextauth]'
import db from '../../../db'
import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const teacherId = session.user.id
  const activityId = Number(req.query.activity_id)

  if (!activityId) {
    return res.status(400).json({ message: 'Activity ID is required' })
  }

  try {
    // Verify teacher has access to this activity AND get payments_enabled status
    const [activityCheck] = await db.query(
      `
      SELECT DISTINCT a.id, a.title, a.activity_date, a.payments_enabled
      FROM activities a
      JOIN activity_assignments aa ON aa.activity_id = a.id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id
      WHERE a.id = ? AND ts.user_id = ? AND a.is_deleted = 0
    `,
      [activityId, teacherId]
    )

    if (activityCheck.length === 0) {
      return res.status(404).json({ message: 'Activity not found or access denied' })
    }

    const activity = activityCheck[0]

    // Get teacher information
    const [teacherInfo] = await db.query(
      `
      SELECT full_name, email FROM users WHERE id = ?
    `,
      [teacherId]
    )

    // Get activity assignments with sections and grades
    const [sections] = await db.query(
      `
      SELECT DISTINCT aa.id as assignment_id, s.name as section_name, g.name as grade_name
      FROM activity_assignments aa
      JOIN sections s ON s.id = aa.section_id
      JOIN grades g ON g.id = s.grade_id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id
      WHERE aa.activity_id = ? AND ts.user_id = ?
    `,
      [activityId, teacherId]
    )

    // Get students with attendance and payment data
    const assignmentIds = sections.map(s => s.assignment_id)

    const [students] = await db.query(
      `
      SELECT
        st.lrn,
        st.first_name,
        st.last_name,
        g.name as grade_name,
        s.name as section_name,
        COALESCE(att.status, 'not_marked') as attendance_status,
        COALESCE(att.parent_present, 0) as parent_present,
        p.paid as payment_paid,
        p.payment_date,
        GROUP_CONCAT(CONCAT(par.first_name, ' ', par.last_name) SEPARATOR ', ') as parents
      FROM students st
      JOIN sections s ON s.id = st.section_id
      JOIN grades g ON g.id = s.grade_id
      JOIN activity_assignments aa ON aa.section_id = st.section_id AND aa.activity_id = ?
      LEFT JOIN attendance att ON att.activity_assignment_id = aa.id AND att.student_id = st.id
      LEFT JOIN payments p ON p.activity_assignment_id = aa.id AND p.student_id = st.id
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents par ON par.id = sp.parent_id AND par.is_deleted = 0
      WHERE st.is_deleted = 0
        AND aa.id IN (${assignmentIds.map(() => '?').join(',')})
      GROUP BY st.id, st.lrn, st.first_name, st.last_name, g.name, s.name, att.status, att.parent_present, p.paid, p.payment_date
      ORDER BY g.name, s.name, st.last_name, st.first_name
    `,
      [activityId, ...assignmentIds]
    )

    // PDF setup: logos + tunables
    const publicDir = path.join(process.cwd(), 'public')
    const logoLeftRel = process.env.LOGO_LEFT || 'logos/left.png'
    const logoRightRel = process.env.LOGO_RIGHT || 'logos/right.png'
    const logoLeftPath = path.join(publicDir, logoLeftRel)
    const logoRightPath = path.join(publicDir, logoRightRel)
    const leftLogoExists = fs.existsSync(logoLeftPath)
    const rightLogoExists = fs.existsSync(logoRightPath)

    const logoWidth = Number(process.env.LOGO_WIDTH || 72)
    const logoHeight = Number(process.env.LOGO_HEIGHT || 72)

    const schoolDepEd = 'Republic of the Philippines'
    const schoolDepEdSub = 'Department of Education'
    const schoolRegion = process.env.SCHOOL_REGION || 'CARAGA Region'
    const schoolCity = process.env.SCHOOL_CITY || 'BAYUGAN CITY'
    const schoolName = process.env.SCHOOL_NAME || 'Bayugan Central Elementary School - SPED Center'

    // Generate PDF
    const doc = new PDFDocument({ size: 'A4', margin: 36 })

    // Create filename with timestamp to avoid conflicts
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `attendance_report_${activityId}_${timestamp}.pdf`

    // Set response headers with proper cache control to prevent IDM issues
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')

    // Pipe PDF to response
    doc.pipe(res)

    // --- HEADER LAYOUT (same as parent checklist) ---
    const pageWidth = doc.page.width
    const left = doc.page.margins.left
    const right = pageWidth - doc.page.margins.right
    const contentWidth = right - left

    const headerLines = [
      { text: schoolDepEd, font: 'Helvetica-Bold', size: 11 },
      { text: schoolDepEdSub, font: 'Helvetica', size: 10 },
      { text: schoolRegion, font: 'Helvetica', size: 10 },
      { text: schoolCity, font: 'Helvetica', size: 10 },
      { text: schoolName, font: 'Helvetica-Bold', size: 12 },
      { text: 'ATTENDANCE REPORT', font: 'Helvetica-Bold', size: 14 }
    ]

    const lineGap = 2
    let totalHeaderTextHeight = 0
    for (const ln of headerLines) {
      doc.font(ln.font).fontSize(ln.size)
      const h = doc.heightOfString(ln.text, { width: contentWidth, align: 'center' })
      totalHeaderTextHeight += h + lineGap
    }
    totalHeaderTextHeight -= lineGap
    const headerStartY = doc.y
    const logosHeight = Math.max(leftLogoExists ? logoHeight : 0, rightLogoExists ? logoHeight : 0)
    const headerTextCenterY = headerStartY + totalHeaderTextHeight / 2
    const logoTopY = Math.max(headerStartY, Math.round(headerTextCenterY - logosHeight / 2))

    if (leftLogoExists) {
      try {
        doc.image(logoLeftPath, left, logoTopY, { width: logoWidth, height: logoHeight })
      } catch (e) {
        console.warn('Left logo load failed', e)
      }
    }
    if (rightLogoExists) {
      try {
        doc.image(logoRightPath, right - logoWidth, logoTopY, { width: logoWidth, height: logoHeight })
      } catch (e) {
        console.warn('Right logo load failed', e)
      }
    }

    let yCursor = headerStartY
    for (const ln of headerLines) {
      doc.font(ln.font).fontSize(ln.size)
      const options = { width: contentWidth, align: 'center' }
      const h = doc.heightOfString(ln.text, options)
      doc.text(ln.text, left, yCursor, options)
      if (ln.text === 'ATTENDANCE REPORT') {
        const titleWidth = doc.widthOfString(ln.text)
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

    doc.y = Math.max(yCursor, logoTopY + logosHeight) + 8

    // Activity Information
    doc.fontSize(12).font('Helvetica-Bold').text('Activity Information:', left)
    doc.fontSize(10).font('Helvetica')
    doc.text(`Activity Name: ${activity.title}`, left)
    doc.text(
      `Activity Date: ${new Date(activity.activity_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}`,
      left
    )

    // Sections covered
    const uniqueSections = [...new Set(sections.map(s => `${s.grade_name} - ${s.section_name}`))]
    doc.text(`Grade and Section: ${uniqueSections.join(', ')}`, left)
    doc.moveDown(0.8)

    // Summary Statistics - Fixed to handle payments_enabled properly
    const totalStudents = students.length
    const presentStudents = students.filter(s => s.parent_present === 1).length
    const absentStudents = students.filter(s => s.parent_present === 0).length

    let paidStudents = 0
    let unpaidStudents = 0

    if (activity.payments_enabled) {
      paidStudents = students.filter(s => s.payment_paid === 1).length
      unpaidStudents = students.filter(s => s.payment_paid === 0 || s.payment_paid === null).length
    }

    doc.fontSize(12).font('Helvetica-Bold').text('Summary:', left)
    doc.fontSize(10).font('Helvetica')

    if (activity.payments_enabled) {
      doc.text(
        `Total Students: ${totalStudents} | Parent Present: ${presentStudents} | Parent Absent: ${absentStudents} | Paid: ${paidStudents} | Unpaid: ${unpaidStudents}`,
        left
      )
    } else {
      doc.text(
        `Total Students: ${totalStudents} | Parent Present: ${presentStudents} | Parent Absent: ${absentStudents} | Payments: N/A`,
        left
      )
    }
    doc.moveDown(1)

    // --- IMPROVED TABLE LAYOUT (Removed Grade/Section column) ---
    // Use landscape-like column widths for better spacing
    const tableWidth = contentWidth
    const tableLeft = left

    // Better column distribution for A4 width (removed grade/section and attendance columns)
    const col1Width = 70 // LRN (wider since we have more space)
    const col2Width = 140 // Student Name (wider since we have more space)
    const col3Width = 70 // Parent Present
    const col4Width = 60 // Payment
    const col5Width = 85 // Payment Date (wider for full date with year)
    const col6Width = tableWidth - (col1Width + col2Width + col3Width + col4Width + col5Width) // Parents (remaining space)

    // Column positions
    const col1X = tableLeft
    const col2X = col1X + col1Width
    const col3X = col2X + col2Width
    const col4X = col3X + col3Width
    const col5X = col4X + col4Width
    const col6X = col5X + col5Width

    const rowHeight = 18 // Reduced for better fit

    function drawTableRow(y, isHeader = false) {
      const fontSize = isHeader ? 9 : 8
      const font = isHeader ? 'Helvetica-Bold' : 'Helvetica'
      doc.font(font).fontSize(fontSize)

      // Draw horizontal lines
      doc
        .moveTo(tableLeft, y)
        .lineTo(tableLeft + tableWidth, y)
        .stroke()
      doc
        .moveTo(tableLeft, y + rowHeight)
        .lineTo(tableLeft + tableWidth, y + rowHeight)
        .stroke()

      // Draw vertical lines (updated for removed columns)
      const verticalLines = [col1X, col2X, col3X, col4X, col5X, col6X, col6X + col6Width]
      verticalLines.forEach(x => {
        doc
          .moveTo(x, y)
          .lineTo(x, y + rowHeight)
          .stroke()
      })

      return y + rowHeight
    }

    function addTableHeader() {
      const headerY = doc.y
      drawTableRow(headerY, true)

      const textY = headerY + (rowHeight - 9) / 2
      const padding = 2

      doc.text('LRN', col1X + padding, textY, { width: col1Width - 2 * padding, align: 'center' })
      doc.text('Student Name', col2X + padding, textY, { width: col2Width - 2 * padding, align: 'center' })
      doc.text('Parent Present', col3X + padding, textY, { width: col3Width - 2 * padding, align: 'center' })
      doc.text('Payment', col4X + padding, textY, { width: col4Width - 2 * padding, align: 'center' })
      doc.text('Payment Date', col5X + padding, textY, { width: col5Width - 2 * padding, align: 'center' })
      doc.text('Parent', col6X + padding, textY, { width: col6Width - 2 * padding, align: 'center' })

      doc.y = headerY + rowHeight
    }

    // Add initial table header
    addTableHeader()

    // Table Data
    students.forEach((student, index) => {
      // Check if we need a new page (leave space for footer)
      if (doc.y + rowHeight + 80 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage()
        addTableHeader() // Add header on new page
      }

      const currentY = doc.y
      drawTableRow(currentY, false)

      const textY = currentY + (rowHeight - 8) / 2
      const padding = 2

      // Truncate long text to fit columns
      const truncateText = (text, maxWidth) => {
        if (!text) return ''
        let truncated = text
        while (doc.widthOfString(truncated) > maxWidth - 2 * padding && truncated.length > 0) {
          truncated = truncated.slice(0, -1)
        }

        return truncated === text ? text : truncated + '...'
      }

      doc.font('Helvetica').fontSize(8)

      // LRN
      doc.text(truncateText(student.lrn || '', col1Width), col1X + padding, textY, {
        width: col1Width - 2 * padding,
        align: 'left'
      })

      // Student Name
      const studentName = `${student.last_name}, ${student.first_name}`
      doc.text(truncateText(studentName, col2Width), col2X + padding, textY, {
        width: col2Width - 2 * padding,
        align: 'left'
      })

      // Parent Present
      doc.text(student.parent_present ? 'YES' : 'NO', col3X + padding, textY, {
        width: col3Width - 2 * padding,
        align: 'center'
      })

      // Payment - Fixed logic to handle payments_enabled
      let paymentText
      if (!activity.payments_enabled) {
        paymentText = 'N/A'
      } else if (student.payment_paid === 1) {
        paymentText = 'PAID'
      } else if (student.payment_paid === 0) {
        paymentText = 'UNPAID'
      } else {
        paymentText = 'NOT SET'
      }

      doc.text(paymentText, col4X + padding, textY, {
        width: col4Width - 2 * padding,
        align: 'center'
      })

      // Payment Date (with full month and year) - Fixed to handle disabled payments
      let payDate
      if (!activity.payments_enabled) {
        payDate = 'N/A'
      } else {
        payDate = student.payment_date
          ? new Date(student.payment_date).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })
          : '-'
      }

      doc.text(truncateText(payDate, col5Width), col5X + padding, textY, {
        width: col5Width - 2 * padding,
        align: 'center'
      })

      // Parents
      doc.text(truncateText(student.parents || 'None', col6Width), col6X + padding, textY, {
        width: col6Width - 2 * padding,
        align: 'left'
      })

      doc.y = currentY + rowHeight
    })

    // Footer with teacher information
    doc.moveDown(1.5)

    // Make sure footer fits on current page
    if (doc.y + 70 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage()
    }

    doc.fontSize(10).font('Helvetica-Bold')
    doc.text('Prepared by:', left)
    doc.fontSize(9).font('Helvetica')
    doc.text(`Section Adviser: ${teacherInfo[0]?.full_name || 'Unknown'}`, left)
    doc.text(`Email: ${teacherInfo[0]?.email || 'N/A'}`, left)
    doc.text(
      `Generated on: ${new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`,
      left
    )

    // Finalize PDF
    doc.end()
  } catch (error) {
    console.error('Error generating attendance report:', error)
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Internal server error' })
    }
  }
}
