// pages/api/students/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'
import { getCurrentSchoolYearId } from '../lib/schoolYear'

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    // ---------- LIST ----------
    if (req.method === 'GET') {
      const { search = '', lrn = '', grade_id = '', section_id = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(1000, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit
      const currentSyId = await getCurrentSchoolYearId()

      const where = ['st.is_deleted = 0', 'en.school_year_id = ?']
      const params = [currentSyId]

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
        where.push(
          '(st.first_name LIKE ? OR st.last_name LIKE ? OR CONCAT(st.first_name," ",st.last_name) LIKE ? OR st.lrn LIKE ?)'
        )
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
      }

      // Teacher restriction: only their sections for the *current* SY (or rows with NULL school_year_id in teacher_sections as fallback)
      if (session.user.role === 'teacher') {
        where.push(
          `en.section_id IN (
             SELECT section_id
             FROM teacher_sections
             WHERE user_id = ?
               AND (school_year_id = ? OR school_year_id IS NULL)
           )`
        )
        params.push(session.user.id, currentSyId)
      }

      const whereSql = 'WHERE ' + where.join(' AND ')

      const countSql = `
        SELECT COUNT(*) AS total
        FROM students st
        JOIN student_enrollments en ON en.student_id = st.id
        ${whereSql}
      `
      const [countRows] = await db.query(countSql, params)
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT
          st.id, st.first_name, st.last_name, st.lrn, st.picture_url,
          en.grade_id, en.section_id,
          g.name AS grade_name,
          s.name AS section_name,
          u.full_name AS teacher_name
        FROM students st
        JOIN student_enrollments en ON en.student_id = st.id
        LEFT JOIN grades g ON g.id = en.grade_id
        LEFT JOIN sections s ON s.id = en.section_id
        LEFT JOIN teacher_sections ts
          ON ts.section_id = en.section_id
         AND (ts.school_year_id = ? OR ts.school_year_id IS NULL)
        LEFT JOIN users u ON u.id = ts.user_id
        ${whereSql}
        ORDER BY st.last_name, st.first_name
        LIMIT ? OFFSET ?
      `
      const [rows] = await db.query(sql, [currentSyId, ...params, limit, offset])

      return res.status(200).json({ total, page: Number(page), page_size: limit, students: rows })
    }

    // ---------- CREATE ----------
    if (req.method === 'POST') {
      const currentSyId = await getCurrentSchoolYearId()

      const form = formidable({
        uploadDir: path.join(process.cwd(), 'public/uploads/students'),
        keepExtensions: true,
        maxFileSize: 5 * 1024 * 1024,
        multiples: false
      })

      const uploadDir = path.join(process.cwd(), 'public/uploads/students')
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

      const [fields, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, f, fl) => (err ? reject(err) : resolve([f, fl])))
      })

      const get = v => (Array.isArray(v) ? v[0] : v)
      const first_name = get(fields.first_name)
      const last_name = get(fields.last_name)
      const lrn = get(fields.lrn)
      const grade_id = get(fields.grade_id)
      const section_id = get(fields.section_id)
      const parent_id = get(fields.parent_id)

      if (!first_name || !last_name || !lrn || !grade_id || !section_id)
        return res.status(400).json({ message: 'Missing required fields' })

      // validate section-grade
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        section_id
      ])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found or deleted' })
      if (String(secRows[0].grade_id) !== String(grade_id))
        return res.status(400).json({ message: 'Section does not belong to grade' })

      // teacher restriction
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          `SELECT 1 FROM teacher_sections
           WHERE user_id = ? AND section_id = ? AND (school_year_id = ? OR school_year_id IS NULL)
           LIMIT 1`,
          [session.user.id, section_id, currentSyId]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden: cannot add students to this section' })
      }

      // unique LRN
      const [dup] = await db.query('SELECT id FROM students WHERE lrn = ? AND is_deleted = 0 LIMIT 1', [lrn])
      if (dup.length) return res.status(409).json({ message: 'LRN already exists' })

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        const [ins] = await conn.query(
          'INSERT INTO students (first_name, last_name, lrn, is_deleted, created_at, updated_at) VALUES (?, ?, ?, 0, NOW(), NOW())',
          [first_name, last_name, lrn]
        )
        const studentId = ins.insertId

        // Enrollment (current SY)
        await conn.query(
          `INSERT INTO student_enrollments (student_id, school_year_id, grade_id, section_id, status, enrolled_at)
           VALUES (?, ?, ?, ?, 'active', NOW())
           ON DUPLICATE KEY UPDATE grade_id = VALUES(grade_id), section_id = VALUES(section_id), status = 'active'`,
          [studentId, currentSyId, grade_id, section_id]
        )

        // Optional parent link
        if (parent_id) {
          const [p] = await conn.query('SELECT id FROM parents WHERE id = ? AND is_deleted = 0 LIMIT 1', [parent_id])
          if (p.length)
            await conn.query('INSERT INTO student_parents (student_id, parent_id) VALUES (?, ?)', [
              studentId,
              parent_id
            ])
        }

        await conn.commit()
        try {
          conn.release()
        } catch {}

        return res.status(201).json({ id: studentId })
      } catch (e) {
        try {
          if (conn) await conn.rollback()
        } catch {}
        try {
          if (conn) conn.release()
        } catch {}
        console.error('Create student error', e)
        if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Duplicate entry' })

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Students index handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
