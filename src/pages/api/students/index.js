// pages/api/students/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'
import { resolveSchoolYearId, getCurrentSchoolYearId, assertSchoolYearExists } from '../lib/schoolYear'
import { auditLog } from '../lib/audit'

export const config = { api: { bodyParser: false } }

function firstValue(v) {
  return Array.isArray(v) ? v[0] : v
}

async function getTargetSchoolYearId(rawValue) {
  const raw = Number(rawValue)
  if (Number.isInteger(raw) && raw > 0) {
    const sy = await assertSchoolYearExists(raw)
    return Number(sy.id)
  }
  return getCurrentSchoolYearId()
}

async function validateTeacherOwnsSection(userId, sectionId, schoolYearId, conn = db) {
  const [[ok]] = await conn.query(
    `SELECT 1
       FROM teacher_sections
      WHERE user_id = ?
        AND section_id = ?
        AND school_year_id = ?
        AND is_active = 1
      LIMIT 1`,
    [userId, sectionId, schoolYearId]
  )

  return !!ok
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      const syId = await resolveSchoolYearId(req)
      const { search = '', lrn = '', grade_id = '', section_id = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(1000, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['st.is_deleted = 0', 'en.school_year_id = ?']
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
        where.push(`EXISTS (
          SELECT 1
            FROM teacher_sections tsx
           WHERE tsx.user_id = ?
             AND tsx.school_year_id = ?
             AND tsx.is_active = 1
             AND tsx.section_id = en.section_id
        )`)
        params.push(session.user.id, syId)
      }

      const whereSql = `WHERE ${where.join(' AND ')}`

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total
           FROM students st
           JOIN student_enrollments en ON en.student_id = st.id
          ${whereSql}`,
        params
      )

      const [rows] = await db.query(
        `SELECT
            st.id,
            st.first_name,
            st.last_name,
            st.lrn,
            st.picture_url,
            en.id AS enrollment_id,
            en.status AS enrollment_status,
            en.grade_id,
            en.section_id,
            en.completion_school_year_id,
            en.completion_grade_id,
            en.completion_section_id,
            g.name AS grade_name,
            s.name AS section_name,
            ts.user_id AS teacher_id,
            u.full_name AS teacher_name
           FROM students st
           JOIN student_enrollments en ON en.student_id = st.id
           JOIN grades g ON g.id = en.grade_id
           JOIN sections s ON s.id = en.section_id
           LEFT JOIN teacher_sections ts
             ON ts.section_id = en.section_id
            AND ts.school_year_id = en.school_year_id
            AND ts.is_active = 1
           LEFT JOIN users u ON u.id = ts.user_id AND u.is_deleted = 0
          ${whereSql}
          ORDER BY st.last_name, st.first_name
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      )

      return res.status(200).json({ total: countRows[0]?.total ?? 0, page: Number(page), page_size: limit, students: rows })
    }

    if (req.method === 'POST') {
      const uploadDir = path.join(process.cwd(), 'public/uploads/students')
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

      const form = formidable({ uploadDir, keepExtensions: true, maxFileSize: 5 * 1024 * 1024, multiples: false })
      const [fields, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, f, fl) => (err ? reject(err) : resolve([f, fl])))
      })

      const targetSyId = await getTargetSchoolYearId(firstValue(fields.school_year_id))
      const first_name = firstValue(fields.first_name)?.trim()
      const last_name = firstValue(fields.last_name)?.trim()
      const lrn = firstValue(fields.lrn)?.trim()
      const grade_id = Number(firstValue(fields.grade_id))
      const section_id = Number(firstValue(fields.section_id))
      const parent_id = firstValue(fields.parent_id) ? Number(firstValue(fields.parent_id)) : null
      const parent_relation = firstValue(fields.parent_relation) || null

      if (!first_name || !last_name || !lrn || !Number.isInteger(grade_id) || !Number.isInteger(section_id)) {
        return res.status(400).json({ message: 'Missing required fields' })
      }

      const [[section]] = await db.query(
        `SELECT id, grade_id
           FROM sections
          WHERE id = ? AND is_deleted = 0
          LIMIT 1`,
        [section_id]
      )
      if (!section) return res.status(400).json({ message: 'Section not found or deleted' })
      if (Number(section.grade_id) !== grade_id) return res.status(400).json({ message: 'Section does not belong to grade' })

      if (session.user.role === 'teacher') {
        const allowed = await validateTeacherOwnsSection(session.user.id, section_id, targetSyId)
        if (!allowed) return res.status(403).json({ message: 'Forbidden: cannot add students to this section' })
      }

      const [dup] = await db.query('SELECT id, is_deleted FROM students WHERE lrn = ? LIMIT 1', [lrn])
      if (dup.length) return res.status(409).json({ message: 'LRN already exists, including deleted/inactive records', id: dup[0].id })

      let newPictureUrl = null
      let tempFilePath = null
      const pictureFile = Array.isArray(files.picture) ? files.picture[0] : files.picture

      if (pictureFile && pictureFile.size > 0) {
        if (!pictureFile.mimetype?.startsWith('image/')) return res.status(400).json({ message: 'Please upload a valid image file' })

        const ext = path.extname(pictureFile.originalFilename || pictureFile.newFilename || '') || '.jpg'
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
        const finalPath = path.join(uploadDir, unique)
        tempFilePath = pictureFile.filepath
        fs.renameSync(pictureFile.filepath, finalPath)
        newPictureUrl = `/uploads/students/${unique}`
      }

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        const [insertStudent] = await conn.query(
          `INSERT INTO students (first_name, last_name, lrn, picture_url, is_deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, NOW(), NOW())`,
          [first_name, last_name, lrn, newPictureUrl]
        )
        const studentId = insertStudent.insertId

        await conn.query(
          `INSERT INTO student_enrollments (student_id, school_year_id, grade_id, section_id, status, enrolled_at)
           VALUES (?, ?, ?, ?, 'active', NOW())`,
          [studentId, targetSyId, grade_id, section_id]
        )

        if (parent_id) {
          const [[parent]] = await conn.query('SELECT id FROM parents WHERE id = ? AND is_deleted = 0 LIMIT 1', [parent_id])
          if (parent) {
            await conn.query('INSERT INTO student_parents (student_id, parent_id, relation) VALUES (?, ?, ?)', [
              studentId,
              parent_id,
              parent_relation
            ])
          }
        }

        await auditLog(
          {
            actorUserId: session.user.id,
            action: 'student.create',
            entityType: 'student',
            entityId: studentId,
            details: { school_year_id: targetSyId, grade_id, section_id, lrn }
          },
          conn
        )

        await conn.commit()
        conn.release()

        return res.status(201).json({ id: studentId })
      } catch (err) {
        if (conn) {
          try {
            await conn.rollback()
          } catch {}
          try {
            conn.release()
          } catch {}
        }

        if (newPictureUrl) {
          const savedPath = path.join(process.cwd(), 'public', newPictureUrl)
          if (fs.existsSync(savedPath)) fs.unlinkSync(savedPath)
        }
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath)

        if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Duplicate entry' })
        console.error('Create student error:', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Students index handler error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
