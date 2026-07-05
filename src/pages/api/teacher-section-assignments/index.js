import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { resolveSchoolYearId } from '../lib/schoolYear'
import { auditLog } from '../lib/audit'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    if (req.method === 'GET') {
      const syId = await resolveSchoolYearId(req)
      const { grade_id = '', assigned = '', search = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(500, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['s.is_deleted = 0']
      const params = [syId]

      if (grade_id) {
        where.push('s.grade_id = ?')
        params.push(grade_id)
      }

      if (search) {
        where.push('(s.name LIKE ? OR g.name LIKE ? OR u.full_name LIKE ?)')
        params.push(`%${search}%`, `%${search}%`, `%${search}%`)
      }

      if (assigned === '1') where.push('ts.id IS NOT NULL')
      if (assigned === '0') where.push('ts.id IS NULL')

      const whereSql = `WHERE ${where.join(' AND ')}`

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total
           FROM sections s
           JOIN grades g ON g.id = s.grade_id
           LEFT JOIN teacher_sections ts
             ON ts.section_id = s.id
            AND ts.school_year_id = ?
            AND ts.is_active = 1
           LEFT JOIN users u ON u.id = ts.user_id AND u.is_deleted = 0
          ${whereSql}`,
        params
      )

      const [rows] = await db.query(
        `SELECT
            s.id AS section_id,
            s.name AS section_name,
            s.grade_id,
            g.name AS grade_name,
            ts.id AS assignment_id,
            ts.user_id AS teacher_id,
            u.full_name AS teacher_name,
            u.username AS teacher_username,
            DATE_FORMAT(ts.assigned_at, '%Y-%m-%d %H:%i:%s') AS assigned_at
           FROM sections s
           JOIN grades g ON g.id = s.grade_id
           LEFT JOIN teacher_sections ts
             ON ts.section_id = s.id
            AND ts.school_year_id = ?
            AND ts.is_active = 1
           LEFT JOIN users u ON u.id = ts.user_id AND u.is_deleted = 0
          ${whereSql}
          ORDER BY g.id, s.name
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      )

      return res.status(200).json({ total: countRows[0]?.total || 0, assignments: rows })
    }

    if (req.method === 'POST') {
      const syId = await resolveSchoolYearId(req)
      const sectionId = Number(req.body?.section_id)
      const teacherId = Number(req.body?.teacher_id)

      if (!Number.isInteger(sectionId) || sectionId <= 0 || !Number.isInteger(teacherId) || teacherId <= 0) {
        return res.status(400).json({ message: 'section_id and teacher_id are required' })
      }

      const [[section]] = await db.query(
        `SELECT s.id, s.name, s.grade_id, g.name AS grade_name
           FROM sections s
           JOIN grades g ON g.id = s.grade_id
          WHERE s.id = ? AND s.is_deleted = 0
          LIMIT 1`,
        [sectionId]
      )
      if (!section) return res.status(404).json({ message: 'Section not found' })

      const [[teacher]] = await db.query(
        `SELECT u.id, u.full_name, u.username
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id AND r.name = 'teacher'
          WHERE u.id = ? AND u.is_deleted = 0
          LIMIT 1`,
        [teacherId]
      )
      if (!teacher) return res.status(404).json({ message: 'Teacher not found' })

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        const [[oldSectionAssignment]] = await conn.query(
          `SELECT ts.id, ts.user_id, u.full_name AS old_teacher_name
             FROM teacher_sections ts
             LEFT JOIN users u ON u.id = ts.user_id
            WHERE ts.section_id = ?
              AND ts.school_year_id = ?
              AND ts.is_active = 1
            LIMIT 1`,
          [sectionId, syId]
        )

        const [[oldTeacherAssignment]] = await conn.query(
          `SELECT ts.id, ts.section_id, s.name AS old_section_name
             FROM teacher_sections ts
             LEFT JOIN sections s ON s.id = ts.section_id
            WHERE ts.user_id = ?
              AND ts.school_year_id = ?
              AND ts.is_active = 1
            LIMIT 1`,
          [teacherId, syId]
        )

        await conn.query(
          `UPDATE teacher_sections
              SET is_active = 0, unassigned_at = NOW()
            WHERE school_year_id = ?
              AND is_active = 1
              AND (section_id = ? OR user_id = ?)`,
          [syId, sectionId, teacherId]
        )

        const [inserted] = await conn.query(
          `INSERT INTO teacher_sections (user_id, section_id, school_year_id, assigned_at, is_active)
           VALUES (?, ?, ?, NOW(), 1)`,
          [teacherId, sectionId, syId]
        )

        await auditLog(
          {
            actorUserId: session.user.id,
            action: 'teacher_section.assign',
            entityType: 'teacher_section',
            entityId: inserted.insertId,
            details: {
              school_year_id: syId,
              teacher_id: teacherId,
              teacher_name: teacher.full_name,
              section_id: sectionId,
              section_name: section.name,
              replaced_section_assignment: oldSectionAssignment || null,
              replaced_teacher_assignment: oldTeacherAssignment || null
            }
          },
          conn
        )

        await conn.commit()
        conn.release()

        return res.status(201).json({ message: 'Teacher assigned', assignment_id: inserted.insertId })
      } catch (err) {
        if (conn) {
          try {
            await conn.rollback()
          } catch {}
          try {
            conn.release()
          } catch {}
        }

        if (err?.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Active assignment conflict. Refresh and try again.' })
        }

        console.error('POST /api/teacher-section-assignments error:', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('/api/teacher-section-assignments error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
