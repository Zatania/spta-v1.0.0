// pages/api/students/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false
  }
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      // Filters: search, lrn, grade_id, section_id, page, page_size
      const { search = '', lrn = '', grade_id = '', section_id = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(1000, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

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
        where.push(
          '(st.first_name LIKE ? OR st.last_name LIKE ? OR CONCAT(st.first_name," ",st.last_name) LIKE ? OR st.lrn LIKE ?)'
        )
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
      }

      // If teacher, restrict to their sections
      if (session.user.role === 'teacher') {
        where.push('st.section_id IN (SELECT section_id FROM teacher_sections WHERE user_id = ?)')
        params.push(session.user.id)
      }

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      const countSql = `SELECT COUNT(*) AS total FROM students st ${whereSql}`
      const [countRows] = await db.query(countSql, params)
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT
          st.id, st.first_name, st.last_name, st.lrn, st.grade_id, st.section_id,
          g.name AS grade_name,
          s.name AS section_name,
          u.full_name AS teacher_name
        FROM students st
        LEFT JOIN grades g ON g.id = st.grade_id
        LEFT JOIN sections s ON s.id = st.section_id
        LEFT JOIN teacher_sections ts ON ts.section_id = st.section_id
        LEFT JOIN users u ON u.id = ts.user_id
        ${whereSql}
        ORDER BY st.last_name, st.first_name
        LIMIT ? OFFSET ?
      `
      const finalParams = [...params, limit, offset]
      const [rows] = await db.query(sql, finalParams)

      return res.status(200).json({ total, page: Number(page), page_size: limit, students: rows })
    }

    if (req.method === 'POST') {
      // Parse form data with file upload
      const form = formidable({
        uploadDir: path.join(process.cwd(), 'public/uploads/students'),
        keepExtensions: true,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        multiples: false
      })

      // Ensure upload directory exists
      const uploadDir = path.join(process.cwd(), 'public/uploads/students')
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }

      const [fields, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err)
          else resolve([fields, files])
        })
      })

      const first_name = Array.isArray(fields.first_name) ? fields.first_name[0] : fields.first_name
      const last_name = Array.isArray(fields.last_name) ? fields.last_name[0] : fields.last_name
      const lrn = Array.isArray(fields.lrn) ? fields.lrn[0] : fields.lrn
      const grade_id = Array.isArray(fields.grade_id) ? fields.grade_id[0] : fields.grade_id
      const section_id = Array.isArray(fields.section_id) ? fields.section_id[0] : fields.section_id
      const teacher_id = Array.isArray(fields.teacher_id) ? fields.teacher_id[0] : fields.teacher_id
      const parent_id = Array.isArray(fields.parent_id) ? fields.parent_id[0] : fields.parent_id

      if (!first_name || !last_name || !lrn || !grade_id || !section_id) {
        return res.status(400).json({ message: 'Missing required fields' })
      }

      /* // Require picture for new students
      const pictureFile = Array.isArray(files.picture) ? files.picture[0] : files.picture

      if (!pictureFile) {
        return res.status(400).json({ message: 'Student picture is required' })
      }

      // Validate image file
      if (!pictureFile.mimetype?.startsWith('image/')) {
        return res.status(400).json({ message: 'Please upload a valid image file' })
      } */

      // verify section exists & grade match
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        section_id
      ])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found or deleted' })
      if (String(secRows[0].grade_id) !== String(grade_id))
        return res.status(400).json({ message: 'Section does not belong to grade' })

      // teachers can only create students for their assigned sections
      if (session.user.role === 'teacher') {
        const [ok] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
          session.user.id,
          section_id
        ])
        if (!ok.length) return res.status(403).json({ message: 'Forbidden: cannot add students to this section' })
      }

      // LRN unique check
      const [lrnCheck] = await db.query('SELECT id FROM students WHERE lrn = ? AND is_deleted = 0 LIMIT 1', [lrn])
      if (lrnCheck.length) return res.status(409).json({ message: 'LRN already exists' })

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        /* // Generate unique filename
        const fileExt = path.extname(pictureFile.originalFilename || pictureFile.newFilename)
        const uniqueFilename = `${Date.now()}-${Math.random().toString(36).substring(2)}${fileExt}`
        const finalPath = path.join(uploadDir, uniqueFilename)

        // Move file to final location
        fs.renameSync(pictureFile.filepath, finalPath)

        const picture_url = `/uploads/students/${uniqueFilename}` */

        const [ins] = await conn.query(
          'INSERT INTO students (first_name, last_name, lrn, grade_id, section_id, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())',
          [first_name, last_name, lrn, grade_id, section_id]
        )
        const studentId = ins.insertId

        // Handle parent assignment if provided
        if (parent_id) {
          const [parentCheck] = await conn.query('SELECT id FROM parents WHERE id = ? AND is_deleted = 0 LIMIT 1', [
            parent_id
          ])
          if (parentCheck.length) {
            await conn.query('INSERT INTO student_parents (student_id, parent_id) VALUES (?, ?)', [
              studentId,
              parent_id
            ])
          }
        }

        await conn.commit()
        conn.release()

        return res.status(201).json({ id: studentId })
      } catch (err) {
        if (conn) {
          await conn.rollback().catch(() => {})
          conn.release().catch(() => {})
        }

        /* // Clean up uploaded file on error
        if (pictureFile?.filepath && fs.existsSync(pictureFile.filepath)) {
          fs.unlinkSync(pictureFile.filepath).catch(() => {})
        } */

        console.error('Create student error', err)
        if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Duplicate entry' })

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Students index handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
