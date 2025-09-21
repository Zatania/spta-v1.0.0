// pages/api/teacher/reports/attendance.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../auth/[...nextauth]'
import db from '../../../db'
import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'
import { getCurrentSchoolYearId } from '../../../lib/schoolYear'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const teacherId = session.user.id
  const activityId = Number(req.query.activity_id)
  if (!activityId) return res.status(400).json({ message: 'Activity ID is required' })

  // Optional comma-separated parent IDs
  const parentIdList = String(req.query.parent_ids || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n))

  try {
    const syId = await getCurrentSchoolYearId()

    // Access check: current SY; includes admin "general" activities as long as they're assigned to the teacher's section.
    const [activityRows] = await db.query(
      `
      SELECT DISTINCT
        a.id, a.title, a.activity_date, a.payments_enabled, a.fee_type, a.fee_amount, a.school_year_id
      FROM activities a
      JOIN activity_assignments aa ON aa.activity_id = a.id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id
      WHERE a.id = ?
        AND a.is_deleted = 0
        AND a.school_year_id = ?
        AND ts.user_id = ?
        AND ts.school_year_id = ?
      `,
      [activityId, syId, teacherId, syId]
    )
    if (!activityRows.length) return res.status(404).json({ message: 'Activity not found or access denied' })
    const activity = activityRows[0]

    // Sections (assignments) visible to the teacher for this activity (current SY)
    const [sections] = await db.query(
      `
      SELECT DISTINCT
        aa.id AS assignment_id,
        s.name AS section_name,
        g.name AS grade_name
      FROM activity_assignments aa
      JOIN sections s  ON s.id = aa.section_id
      JOIN grades g    ON g.id = s.grade_id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id
      WHERE aa.activity_id = ?
        AND ts.user_id = ?
        AND ts.school_year_id = ?
      `,
      [activityId, teacherId, syId]
    )
    if (!sections.length) return res.status(404).json({ message: 'No sections visible for this activity' })

    const assignmentIds = sections.map(s => s.assignment_id)

    // Students via enrollments in current SY; bind each row to the matching assignment via section_id
    // Aggregate contributions per student for this assignment; payments are 1 row per student/assignment.
    const parentFilterJoin = parentIdList.length
      ? `INNER JOIN student_parents spf ON spf.student_id = st.id AND spf.parent_id IN (${parentIdList
          .map(() => '?')
          .join(',')})`
      : ''

    const aaFilter = assignmentIds.length ? `AND aa.id IN (${assignmentIds.map(() => '?').join(',')})` : `AND 1=0`

    const sql = `
      SELECT
        st.id,
        st.lrn,
        st.first_name,
        st.last_name,
        g.name  AS grade_name,
        s.name  AS section_name,

        -- Attendance
        COALESCE(att.status, 'not_marked')   AS attendance_status,
        COALESCE(att.parent_present, 0)      AS parent_present,

        -- Payments
        p.paid                                AS payment_paid,
        p.amount                              AS payment_amount,
        p.payment_date                        AS payment_date,

        -- Contributions (aggregates)
        COUNT(c.id)                           AS contrib_entries,
        COALESCE(SUM(c.hours_worked),0)       AS contrib_hours_total,
        COALESCE(SUM(c.estimated_value),0)    AS contrib_estimated_total,

        -- Parent names (display)
        GROUP_CONCAT(DISTINCT CONCAT(par.first_name, ' ', par.last_name) SEPARATOR ', ') AS parents
      FROM student_enrollments se
      JOIN students st ON st.id = se.student_id AND st.is_deleted = 0
      JOIN sections s  ON s.id = se.section_id
      JOIN grades g    ON g.id = se.grade_id
      JOIN activity_assignments aa ON aa.section_id = se.section_id AND aa.activity_id = ?
      ${parentFilterJoin}
      LEFT JOIN attendance att
        ON att.activity_assignment_id = aa.id AND att.student_id = st.id
      LEFT JOIN payments p
        ON p.activity_assignment_id = aa.id AND p.student_id = st.id
      LEFT JOIN contributions c
        ON c.activity_assignment_id = aa.id AND c.student_id = st.id
      LEFT JOIN student_parents sp ON sp.student_id = st.id
      LEFT JOIN parents par ON par.id = sp.parent_id AND par.is_deleted = 0
      WHERE se.school_year_id = ?
        AND se.status = 'active'
        ${aaFilter}
      GROUP BY
        st.id, st.lrn, st.first_name, st.last_name,
        g.name, s.name,
        att.status, att.parent_present,
        p.paid, p.amount, p.payment_date
      ORDER BY g.name, s.name, st.last_name, st.first_name
    `

    const queryParams = [
      activityId,
      ...(parentIdList.length ? parentIdList : []),
      syId,
      ...(assignmentIds.length ? assignmentIds : [])
    ]
    const [students] = await db.query(sql, queryParams)

    // Teacher info
    const [teacherInfo] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [teacherId])

    // ===== PDF (A4 LANDSCAPE to fit the wider table) =====
    const publicDir = path.join(process.cwd(), 'public')
    const logoLeftRel = process.env.LOGO_LEFT || 'logos/left.png'
    const logoRightRel = process.env.LOGO_RIGHT || 'logos/right.png'
    const logoLeftPath = path.join(publicDir, logoLeftRel)
    const logoRightPath = path.join(publicDir, logoRightRel)
    const leftLogoExists = fs.existsSync(logoLeftPath)
    const rightLogoExists = fs.existsSync(logoRightPath)

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `attendance_report_${activityId}_${timestamp}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    doc.pipe(res)

    const pageWidth = doc.page.width
    const left = doc.page.margins.left
    const right = pageWidth - doc.page.margins.right
    const contentWidth = right - left

    const schoolDepEd = 'Republic of the Philippines'
    const schoolDepEdSub = 'Department of Education'
    const schoolRegion = process.env.SCHOOL_REGION || 'CARAGA Region'
    const schoolCity = process.env.SCHOOL_CITY || 'BAYUGAN CITY'
    const schoolName = process.env.SCHOOL_NAME || 'Bayugan Central Elementary School - SPED Center'
    const logoWidth = Number(process.env.LOGO_WIDTH || 56)
    const logoHeight = Number(process.env.LOGO_HEIGHT || 56)

    // Header
    const headerLines = [
      { text: schoolDepEd, font: 'Helvetica-Bold', size: 11 },
      { text: schoolDepEdSub, font: 'Helvetica', size: 10 },
      { text: schoolRegion, font: 'Helvetica', size: 10 },
      { text: schoolCity, font: 'Helvetica', size: 10 },
      { text: schoolName, font: 'Helvetica-Bold', size: 12 },
      { text: 'ATTENDANCE / CONTRIBUTIONS REPORT', font: 'Helvetica-Bold', size: 14 }
    ]
    const lineGap = 2
    let totalHeaderTextHeight = 0
    for (const ln of headerLines) {
      doc.font(ln.font).fontSize(ln.size)
      totalHeaderTextHeight += doc.heightOfString(ln.text, { width: contentWidth, align: 'center' }) + lineGap
    }
    totalHeaderTextHeight -= lineGap
    const headerStartY = doc.y
    const logosHeight = Math.max(leftLogoExists ? logoHeight : 0, rightLogoExists ? logoHeight : 0)
    const headerTextCenterY = headerStartY + totalHeaderTextHeight / 2
    const logoTopY = Math.max(headerStartY, Math.round(headerTextCenterY - logosHeight / 2))
    if (leftLogoExists) {
      try {
        doc.image(logoLeftPath, left, logoTopY, { width: logoWidth, height: logoHeight })
      } catch {}
    }
    if (rightLogoExists) {
      try {
        doc.image(logoRightPath, right - logoWidth, logoTopY, { width: logoWidth, height: logoHeight })
      } catch {}
    }

    let yCursor = headerStartY
    for (const ln of headerLines) {
      doc.font(ln.font).fontSize(ln.size)
      const opts = { width: contentWidth, align: 'center' }
      const h = doc.heightOfString(ln.text, opts)
      doc.text(ln.text, left, yCursor, opts)
      if (ln.text.includes('REPORT')) {
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

    // Activity info
    const uniqueSections = [...new Set(sections.map(s => `${s.grade_name} - ${s.section_name}`))]
    doc.fontSize(12).font('Helvetica-Bold').text('Activity Information:', left)
    doc.fontSize(10).font('Helvetica')
    doc.text(`Activity: ${activity.title}`, left)
    doc.text(
      `Date: ${new Date(activity.activity_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}`,
      left
    )
    doc.text(`Covers: ${uniqueSections.join(', ')}`, left)
    doc.text(
      `Fee Type: ${activity.fee_type || 'N/A'}  ${
        activity.fee_amount != null ? `(Fee: ${Number(activity.fee_amount).toFixed(2)})` : ''
      }`,
      left
    )
    doc.moveDown(0.8)

    // Summary
    const totalStudents = students.length
    const parentPresent = students.filter(s => Number(s.parent_present) === 1).length
    const parentAbsent = totalStudents - parentPresent

    let paid = 0,
      unpaid = 0
    if (activity.payments_enabled && (activity.fee_type === 'fee' || activity.fee_type === 'mixed')) {
      paid = students.filter(s => Number(s.payment_paid) === 1).length
      unpaid = totalStudents - paid
    }

    const contribEnabled = ['donation', 'service', 'mixed'].includes(activity.fee_type)
    const totalContribEntries = contribEnabled ? students.reduce((a, s) => a + Number(s.contrib_entries || 0), 0) : 0
    const totalContribHours = contribEnabled ? students.reduce((a, s) => a + Number(s.contrib_hours_total || 0), 0) : 0

    const totalContribValue = contribEnabled
      ? students.reduce((a, s) => a + Number(s.contrib_estimated_total || 0), 0)
      : 0

    doc.fontSize(12).font('Helvetica-Bold').text('Summary:', left)
    doc.fontSize(10).font('Helvetica')

    const summaryBits = [
      `Students: ${totalStudents}`,
      `Parent Present: ${parentPresent}`,
      `Parent Absent: ${parentAbsent}`
    ]
    if (activity.fee_type === 'fee' || activity.fee_type === 'mixed') {
      summaryBits.push(`Paid: ${paid}`, `Unpaid: ${unpaid}`)
    }
    if (contribEnabled) {
      summaryBits.push(
        `Contrib Entries: ${totalContribEntries}`,
        `Contrib Hours: ${totalContribHours.toFixed(2)}`,
        `Contrib Value: ${totalContribValue.toFixed(2)}`
      )
    }
    doc.text(summaryBits.join(' | '), left)
    doc.moveDown(1)

    // ===== TABLE (landscape, auto-fit, slimmer, with “N/A” rule) =====
    const showPayments = !!activity?.payments_enabled && ['fee', 'mixed'].includes(activity?.fee_type)
    const showContribs = ['donation', 'service', 'mixed'].includes(activity?.fee_type)

    // Give ourselves more breathing room so borders never clip
    const tableLeft = left
    const fitToWidth = contentWidth - 6 // <= bumped from 2pt to 6pt for safety

    // 1) Columns (conditionally include payments / contributions)
    let cols = [
      { key: 'lrn', label: 'LRN', width: 60, align: 'left' },
      { key: 'name', label: 'Student Name', width: 140, align: 'left' },
      { key: 'pp', label: 'Parent Present', width: 72, align: 'center' }
    ]

    if (showPayments) {
      cols.push(
        { key: 'paid', label: 'Paid', width: 50, align: 'center' },
        { key: 'amt', label: 'Amount', width: 62, align: 'right' },
        { key: 'pdate', label: 'Payment Date', width: 92, align: 'center' }
      )
    }

    if (showContribs) {
      cols.push(
        { key: 'cent', label: 'Contrib Entries', width: 82, align: 'center' },
        { key: 'chrs', label: 'Contrib Hours', width: 76, align: 'right' },
        { key: 'cval', label: 'Contrib Value', width: 92, align: 'right' }
      )
    }

    // Always include parents at the end
    cols.push({ key: 'parents', label: 'Parent', width: 180, align: 'left' })

    // 2) Auto-fit: clamp mins → shrink flexible columns → final scale if still wider
    const MIN = {
      lrn: 56,
      name: 120,
      pp: 68,
      paid: 46,
      amt: 56,
      pdate: 86,
      cent: 76,
      chrs: 70,
      cval: 86,
      parents: 110 // lowered a bit so it can shrink more
    }

    // Prefer to shrink these first (from most to least)
    const FLEX_ORDER = ['parents', 'name', 'pdate', 'amt', 'cval', 'chrs', 'cent']

    const clamp = (v, lo) => Math.max(lo, v)
    cols.forEach(c => {
      c.width = clamp(c.width, MIN[c.key] ?? 56)
    })

    let totalWidth = cols.reduce((w, c) => w + c.width, 0)
    if (totalWidth > fitToWidth) {
      let over = totalWidth - fitToWidth

      // shrink flexible columns down to their mins
      for (const key of FLEX_ORDER) {
        const c = cols.find(x => x.key === key)
        if (!c) continue
        const reducible = c.width - (MIN[key] ?? 56)
        if (reducible <= 0) continue
        const take = Math.min(reducible, over)
        c.width -= take
        over -= take
        if (over <= 0) break
      }

      // still wide? scale proportionally but not below mins
      if (over > 0) {
        const cur = cols.reduce((w, c) => w + c.width, 0)
        const scale = fitToWidth / cur
        cols = cols.map(c => {
          const minW = MIN[c.key] ?? 56

          return { ...c, width: clamp(Math.floor(c.width * scale), minW) }
        })
      }
    }

    // if we ended up narrower, give extra space to Parents (or last col)
    let used = cols.reduce((w, c) => w + c.width, 0)
    if (used < fitToWidth) {
      const grow = fitToWidth - used
      const pcol = cols.find(c => c.key === 'parents') || cols[cols.length - 1]
      pcol.width += grow
    }

    // 3) Column positions
    let x = tableLeft

    const colPos = cols.map(c => {
      const start = x
      x += c.width

      return { ...c, x: start }
    })
    const tableTotalWidth = colPos.reduce((w, c) => w + c.width, 0)

    // 4) Draw helpers — slightly smaller to fit more lines per page
    const rowHeight = 15 // tighter than before
    const pad = 2

    function drawTableRow(y, isHeader = false) {
      const fs = isHeader ? 8.2 : 7.2 // slightly smaller fonts
      const f = isHeader ? 'Helvetica-Bold' : 'Helvetica'
      doc.font(f).fontSize(fs)

      doc.lineWidth(0.6) // crisp thin lines

      // top / bottom lines
      doc
        .moveTo(tableLeft, y)
        .lineTo(tableLeft + tableTotalWidth, y)
        .stroke()
      doc
        .moveTo(tableLeft, y + rowHeight)
        .lineTo(tableLeft + tableTotalWidth, y + rowHeight)
        .stroke()

      // vertical dividers + right boundary
      for (const c of colPos) {
        doc
          .moveTo(c.x, y)
          .lineTo(c.x, y + rowHeight)
          .stroke()
      }
      doc
        .moveTo(tableLeft + tableTotalWidth, y)
        .lineTo(tableLeft + tableTotalWidth, y + rowHeight)
        .stroke()

      return y + rowHeight
    }

    function addTableHeader() {
      const y = doc.y
      drawTableRow(y, true)
      const textY = y + (rowHeight - 8.2) / 2
      for (const c of colPos) {
        doc.text(c.label, c.x + pad, textY, { width: c.width - 2 * pad, align: 'center' })
      }
      doc.y = y + rowHeight
    }

    const truncate = (text, width) => {
      const t = String(text ?? '')
      if (!t) return ''
      let out = t
      while (doc.widthOfString(out) > width - 2 * pad && out.length > 0) out = out.slice(0, -1)

      return out === t ? t : out + '…'
    }

    // 5) Render table
    addTableHeader()

    students.forEach(st => {
      // page break check (leave footer room)
      if (doc.y + rowHeight + 64 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage()
        addTableHeader()
      }

      const y = doc.y
      drawTableRow(y, false)
      const textY = y + (rowHeight - 7.2) / 2

      // name / presence
      const name = `${st.last_name || ''}, ${st.first_name || ''}`.trim()
      const pp = st.parent_present ? 'YES' : 'NO'

      // contribution aggregates (support alt keys)
      const cent = Number(st.contrib_entries ?? st.contrib_count ?? 0)
      const chrs = Number(st.contrib_hours_total ?? st.contrib_hours ?? 0)
      const cval = Number(st.contrib_estimated_total ?? st.contrib_value ?? 0)
      const hasContrib = showContribs && (cent > 0 || chrs > 0 || cval > 0)

      // payments w/ special “N/A” rule for unpaid + contributed
      let paidText = 'N/A'
      let amtText = 'N/A'
      let dateText = 'N/A'
      if (showPayments) {
        const paid = Number(st.payment_paid)

        // When unpaid but contributed → force N/A in Paid & Amount
        if (hasContrib && paid === 0) {
          paidText = 'N/A'
          amtText = 'N/A'
          dateText = '—'
        } else {
          paidText = paid === 1 ? 'PAID' : paid === 0 ? 'UNPAID' : 'NOT SET'

          // always show a numeric amount (0.00) if we have a number; blank only if truly null/undefined
          const amt = st.payment_amount === null || st.payment_amount === undefined ? 0 : Number(st.payment_amount)
          amtText = paid === 0 && !hasContrib ? amt.toFixed(2) : paid === 1 ? amt.toFixed(2) : amt.toFixed(2)
          dateText = st.payment_date
            ? new Date(st.payment_date).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
            : '—'

          // If amount is 0 AND not paid, leave it as 0.00 to reflect DB default
          if (hasContrib && paid === 0) {
            // already handled above
          }
        }
      }

      const row = {
        lrn: st.lrn || '',
        name,
        pp,
        paid: paidText,
        amt: amtText,
        pdate: dateText,
        cent: isNaN(cent) ? 0 : cent,
        chrs: isNaN(chrs) ? '0.00' : chrs.toFixed(2),
        cval: isNaN(cval) ? '0.00' : cval.toFixed(2),
        parents: st.parents || 'None'
      }

      doc.font('Helvetica').fontSize(7.2)
      for (const c of colPos) {
        const val = truncate(row[c.key], c.width)
        doc.text(val, c.x + pad, textY, { width: c.width - 2 * pad, align: c.align || 'left' })
      }

      doc.y = y + rowHeight
    })

    // Footer
    if (doc.y + 70 > doc.page.height - doc.page.margins.bottom) doc.addPage()
    doc.moveDown(1.5)
    doc.fontSize(10).font('Helvetica-Bold').text('Prepared by:', left)
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

    doc.end()
  } catch (error) {
    console.error('Error generating attendance report:', error)
    if (!res.headersSent) res.status(500).json({ message: 'Internal server error' })
  }
}
