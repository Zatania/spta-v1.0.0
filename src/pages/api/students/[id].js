// pages/api/students/[id].js
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
  const { id } = req.query
  const studentId = Number(id)
  if (!studentId || Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      // teacher check: only allowed if student in teacher's section
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          'SELECT 1 FROM students st JOIN teacher_sections ts ON ts.section_id = st.section_id WHERE st.id = ? AND ts.user_id = ? LIMIT 1',
          [studentId, session.user.id]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      }

      const [rows] = await db.query(
        `SELECT
          st.id, st.first_name, st.last_name, st.lrn, st.grade_id, st.section_id, st.picture_url,
          g.name AS grade_name,
          s.name AS section_name,
          ts.user_id as teacher_id
        FROM students st
        LEFT JOIN grades g ON g.id = st.grade_id
        LEFT JOIN sections s ON s.id = st.section_id
        LEFT JOIN teacher_sections ts ON ts.section_id = st.section_id
        WHERE st.id = ? AND st.is_deleted = 0 LIMIT 1`,
        [studentId]
      )
      if (!rows.length) return res.status(404).json({ message: 'Student not found' })
      const student = rows[0]

      const [parents] = await db.query(
        'SELECT p.id, p.first_name, p.last_name, p.contact_info, sp.relation FROM parents p JOIN student_parents sp ON sp.parent_id = p.id WHERE sp.student_id = ? AND p.is_deleted = 0',
        [studentId]
      )
      student.parents = parents

      return res.status(200).json(student)
    }

    if (req.method === 'PUT') {
      // Parse form data with optional file upload
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

      if (!first_name || !last_name || !lrn || !grade_id || !section_id)
        return res.status(400).json({ message: 'Missing required fields' })

      // verify section exists & matches grade
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        section_id
      ])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found or deleted' })
      if (String(secRows[0].grade_id) !== String(grade_id))
        return res.status(400).json({ message: 'Section does not belong to grade' })

      // teacher restriction: can only edit students in their assigned sections (current section check)
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          'SELECT 1 FROM students st JOIN teacher_sections ts ON ts.section_id = st.section_id WHERE st.id = ? AND ts.user_id = ? LIMIT 1',
          [studentId, session.user.id]
        )
        if (!ok.length)
          return res.status(403).json({ message: 'Forbidden: You can only edit students in your assigned sections' })

        /* // Also check if teacher can assign to the new section (if changing sections)
        const [currentStudent] = await db.query('SELECT section_id FROM students WHERE id = ? LIMIT 1', [studentId])
        if (currentStudent.length && String(currentStudent[0].section_id) !== String(section_id)) {
          const [newSectionOk] = await db.query(
            'SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1',
            [session.user.id, section_id]
          )
          if (!newSectionOk.length)
            return res
              .status(403)
              .json({ message: 'Forbidden: You cannot move student to a section you are not assigned to' })
        } */
      }

      // LRN uniqueness excluding this student
      const [lrnCheck] = await db.query(
        'SELECT id FROM students WHERE lrn = ? AND id != ? AND is_deleted = 0 LIMIT 1',
        [lrn, studentId]
      )
      if (lrnCheck.length) return res.status(409).json({ message: 'LRN already in use' })

      let conn
      let newPictureUrl = null
      let oldPictureUrl = null

      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        // Get current student data for cleanup
        const [currentData] = await conn.query('SELECT picture_url FROM students WHERE id = ? LIMIT 1', [studentId])
        if (currentData.length) {
          oldPictureUrl = currentData[0].picture_url
        }

        // Handle picture upload if provided
        const pictureFile = Array.isArray(files.picture) ? files.picture[0] : files.picture
        if (pictureFile && pictureFile.size > 0) {
          // Validate image file
          if (!pictureFile.mimetype?.startsWith('image/')) {
            await conn.rollback()

            return res.status(400).json({ message: 'Please upload a valid image file' })
          }

          // Generate unique filename
          const fileExt = path.extname(pictureFile.originalFilename || pictureFile.newFilename)
          const uniqueFilename = `${Date.now()}-${Math.random().toString(36).substring(2)}${fileExt}`
          const finalPath = path.join(uploadDir, uniqueFilename)

          // Move file to final location
          fs.renameSync(pictureFile.filepath, finalPath)
          newPictureUrl = `/uploads/students/${uniqueFilename}`
        }

        // Update student record
        const updateQuery = newPictureUrl
          ? 'UPDATE students SET first_name = ?, last_name = ?, lrn = ?, grade_id = ?, section_id = ?, picture_url = ?, updated_at = NOW() WHERE id = ?'
          : 'UPDATE students SET first_name = ?, last_name = ?, lrn = ?, grade_id = ?, section_id = ?, updated_at = NOW() WHERE id = ?'

        const updateParams = newPictureUrl
          ? [first_name, last_name, lrn, grade_id, section_id, newPictureUrl, studentId]
          : [first_name, last_name, lrn, grade_id, section_id, studentId]

        await conn.query(updateQuery, updateParams)

        // Handle parent assignment: remove current and add new if provided
        await conn.query('DELETE FROM student_parents WHERE student_id = ?', [studentId])

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

        // Clean up old picture file if a new one was uploaded
        if (newPictureUrl && oldPictureUrl && oldPictureUrl !== newPictureUrl) {
          const oldFilePath = path.join(process.cwd(), 'public', oldPictureUrl)
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath).catch(() => {})
          }
        }

        return res.status(200).json({ message: 'Student updated successfully' })
      } catch (err) {
        if (conn) {
          await conn.rollback().catch(() => {})
          conn.release().catch(() => {})
        }

        // Clean up uploaded file on error
        if (pictureFile?.filepath && fs.existsSync(pictureFile.filepath)) {
          fs.unlinkSync(pictureFile.filepath).catch(() => {})
        }

        console.error('Update student error', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    if (req.method === 'DELETE') {
      // teachers can only delete their students
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          'SELECT 1 FROM students st JOIN teacher_sections ts ON ts.section_id = st.section_id WHERE st.id = ? AND ts.user_id = ? LIMIT 1',
          [studentId, session.user.id]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      }

      // Get student picture for cleanup
      const [studentData] = await db.query('SELECT picture_url FROM students WHERE id = ? LIMIT 1', [studentId])

      await db.query('UPDATE students SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [studentId])

      // Clean up picture file
      if (studentData.length && studentData[0].picture_url) {
        const picturePath = path.join(process.cwd(), 'public', studentData[0].picture_url)
        if (fs.existsSync(picturePath)) {
          fs.unlinkSync(picturePath).catch(() => {})
        }
      }

      return res.status(200).json({ message: 'Student soft-deleted' })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Students [id] handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
