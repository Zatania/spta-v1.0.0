// pages/api/students/[id].js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'
import { getCurrentSchoolYearId } from '../lib/schoolYear'

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  const studentId = Number(req.query.id)
  if (!studentId) return res.status(400).json({ message: 'Invalid student id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    const currentSyId = await getCurrentSchoolYearId()

    // ------- GET -------
    if (req.method === 'GET') {
      // Teacher guard
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          `SELECT 1
           FROM student_enrollments en
           JOIN teacher_sections ts
             ON ts.section_id = en.section_id
            AND (ts.school_year_id = ? OR ts.school_year_id IS NULL)
           WHERE en.student_id = ? AND en.school_year_id = ? AND ts.user_id = ?
           LIMIT 1`,
          [currentSyId, studentId, currentSyId, session.user.id]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      }

      const [rows] = await db.query(
        `SELECT
           st.id, st.first_name, st.last_name, st.lrn, st.picture_url,
           en.grade_id, en.section_id,
           g.name AS grade_name, s.name AS section_name,
           ts.user_id AS teacher_id
         FROM students st
         JOIN student_enrollments en ON en.student_id = st.id AND en.school_year_id = ?
         LEFT JOIN grades g ON g.id = en.grade_id
         LEFT JOIN sections s ON s.id = en.section_id
         LEFT JOIN teacher_sections ts
           ON ts.section_id = en.section_id
          AND (ts.school_year_id = ? OR ts.school_year_id IS NULL)
         WHERE st.id = ? AND st.is_deleted = 0
         LIMIT 1`,
        [currentSyId, currentSyId, studentId]
      )
      if (!rows.length) return res.status(404).json({ message: 'Student not found' })
      const student = rows[0]

      const [parents] = await db.query(
        `SELECT p.id, p.first_name, p.last_name, p.contact_info, sp.relation
         FROM parents p
         JOIN student_parents sp ON sp.parent_id = p.id
         WHERE sp.student_id = ? AND p.is_deleted = 0`,
        [studentId]
      )
      student.parents = parents

      return res.status(200).json(student)
    }

    // ------- PUT -------
    if (req.method === 'PUT') {
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

      // Teacher guard (current SY)
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          `SELECT 1
           FROM student_enrollments en
           JOIN teacher_sections ts
             ON ts.section_id = en.section_id
            AND (ts.school_year_id = ? OR ts.school_year_id IS NULL)
           WHERE en.student_id = ? AND en.school_year_id = ? AND ts.user_id = ?
           LIMIT 1`,
          [currentSyId, studentId, currentSyId, session.user.id]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })

        // If moving sections, also ensure teacher owns the new section
        const [okNew] = await db.query(
          `SELECT 1 FROM teacher_sections
           WHERE user_id = ? AND section_id = ? AND (school_year_id = ? OR school_year_id IS NULL)
           LIMIT 1`,
          [session.user.id, section_id, currentSyId]
        )
        if (!okNew.length) return res.status(403).json({ message: 'Forbidden: target section not owned' })
      }

      // validate section-grade
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        section_id
      ])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found or deleted' })
      if (String(secRows[0].grade_id) !== String(grade_id))
        return res.status(400).json({ message: 'Section does not belong to grade' })

      // LRN uniqueness (excluding current student)
      const [dup] = await db.query('SELECT id FROM students WHERE lrn = ? AND id != ? AND is_deleted = 0 LIMIT 1', [
        lrn,
        studentId
      ])
      if (dup.length) return res.status(409).json({ message: 'LRN already in use' })

      let conn
      let newPictureUrl = null
      let tempFilePath = null

      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        // current picture for cleanup?
        const [cur] = await conn.query('SELECT picture_url FROM students WHERE id = ? LIMIT 1', [studentId])
        const oldPictureUrl = cur[0]?.picture_url || null

        const pictureFile = Array.isArray(files.picture) ? files.picture[0] : files.picture
        if (pictureFile && pictureFile.size > 0) {
          if (!pictureFile.mimetype?.startsWith('image/')) {
            await conn.rollback()

            return res.status(400).json({ message: 'Please upload a valid image file' })
          }
          const ext = path.extname(pictureFile.originalFilename || pictureFile.newFilename)
          const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
          const finalPath = path.join(uploadDir, unique)
          tempFilePath = pictureFile.filepath
          fs.renameSync(pictureFile.filepath, finalPath)
          newPictureUrl = `/uploads/students/${unique}`
        }

        // Update student basic
        if (newPictureUrl) {
          await conn.query(
            'UPDATE students SET first_name = ?, last_name = ?, lrn = ?, picture_url = ?, updated_at = NOW() WHERE id = ?',
            [first_name, last_name, lrn, newPictureUrl, studentId]
          )
        } else {
          await conn.query(
            'UPDATE students SET first_name = ?, last_name = ?, lrn = ?, updated_at = NOW() WHERE id = ?',
            [first_name, last_name, lrn, studentId]
          )
        }

        // Update current SY enrollment
        const [enOK] = await conn.query(
          'SELECT id FROM student_enrollments WHERE student_id = ? AND school_year_id = ? LIMIT 1',
          [studentId, currentSyId]
        )
        if (!enOK.length) {
          await conn.query(
            `INSERT INTO student_enrollments (student_id, school_year_id, grade_id, section_id, status, enrolled_at)
             VALUES (?, ?, ?, ?, 'active', NOW())`,
            [studentId, currentSyId, grade_id, section_id]
          )
        } else {
          await conn.query(
            `UPDATE student_enrollments SET grade_id = ?, section_id = ? WHERE student_id = ? AND school_year_id = ?`,
            [grade_id, section_id, studentId, currentSyId]
          )
        }

        // Replace parent link
        await conn.query('DELETE FROM student_parents WHERE student_id = ?', [studentId])
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

        // delete old picture on success
        if (newPictureUrl && oldPictureUrl && oldPictureUrl !== newPictureUrl) {
          const oldPath = path.join(process.cwd(), 'public', oldPictureUrl)
          if (fs.existsSync(oldPath)) {
            try {
              fs.unlinkSync(oldPath)
            } catch {}
          }
        }

        return res.status(200).json({ message: 'Student updated successfully' })
      } catch (e) {
        try {
          if (conn) await conn.rollback()
        } catch {}
        try {
          if (conn) conn.release()
        } catch {}
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath)
          } catch {}
        }
        console.error('Update student error', e)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    // ------- DELETE (soft) -------
    if (req.method === 'DELETE') {
      // teachers: only if student currently in their section for current SY
      if (session.user.role === 'teacher') {
        const [ok] = await db.query(
          `SELECT 1
           FROM student_enrollments en
           JOIN teacher_sections ts
             ON ts.section_id = en.section_id
            AND (ts.school_year_id = ? OR ts.school_year_id IS NULL)
           WHERE en.student_id = ? AND en.school_year_id = ? AND ts.user_id = ?
           LIMIT 1`,
          [currentSyId, studentId, currentSyId, session.user.id]
        )
        if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
      }

      const [studentData] = await db.query('SELECT picture_url FROM students WHERE id = ? LIMIT 1', [studentId])
      await db.query('UPDATE students SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [studentId])

      const url = studentData[0]?.picture_url
      if (url) {
        const p = path.join(process.cwd(), 'public', url)
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p)
          } catch {}
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
