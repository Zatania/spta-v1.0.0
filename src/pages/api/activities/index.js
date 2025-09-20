// pages/api/activities/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { getCurrentSchoolYearId } from '../lib/schoolYear'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      const { search = '', date_from = '', date_to = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(500, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit
      const syId = await getCurrentSchoolYearId()

      const where = ['a.is_deleted = 0', 'a.school_year_id = ?']
      const params = [syId]

      if (search) {
        where.push('a.title LIKE ?')
        params.push(`%${search}%`)
      }
      if (date_from) {
        where.push('a.activity_date >= ?')
        params.push(date_from)
      }
      if (date_to) {
        where.push('a.activity_date <= ?')
        params.push(date_to)
      }

      // Role scoping
      if (session.user.role === 'teacher') {
        // visible if created_by me OR assigned to my section(s) or grade(s) or ALL
        where.push(`
          (
            a.created_by = ?
            OR EXISTS (
              SELECT 1
              FROM activity_assignments aa
              WHERE aa.activity_id = a.id
                AND (
                  (aa.grade_id IS NULL AND aa.section_id IS NULL) -- ALL
                  OR aa.grade_id IN (
                    SELECT s.grade_id
                    FROM teacher_sections ts
                    JOIN sections s ON s.id = ts.section_id
                    WHERE ts.user_id = ? AND ts.school_year_id = ?
                  )
                  OR aa.section_id IN (
                    SELECT ts.section_id
                    FROM teacher_sections ts
                    WHERE ts.user_id = ? AND ts.school_year_id = ?
                  )
                )
            )
          )
        `)
        params.push(session.user.id, session.user.id, syId, session.user.id, syId)
      }

      const whereSql = `WHERE ${where.join(' AND ')}`

      const countSql = `SELECT COUNT(*) AS total FROM activities a ${whereSql}`
      const [countRows] = await db.query(countSql, params)
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT
          a.id,
          a.title,
          DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
          a.created_by,
          a.fee_type,
          a.fee_amount,
          COALESCE(a.payments_enabled, 1) AS payments_enabled,
          u.full_name AS created_by_name,
          -- human-ish scope text (ALL / Gx list / Section-count)
          CASE
            WHEN EXISTS (
              SELECT 1 FROM activity_assignments aa
              WHERE aa.activity_id = a.id AND aa.grade_id IS NULL AND aa.section_id IS NULL
            ) THEN 'All grades'
            WHEN EXISTS (
              SELECT 1 FROM activity_assignments aa WHERE aa.activity_id = a.id AND aa.section_id IS NOT NULL
            ) THEN CONCAT(
              'Sections: ',
              (
                SELECT GROUP_CONCAT(CONCAT(g.name,'-',s.name) ORDER BY g.id, s.name SEPARATOR ', ')
                FROM activity_assignments aa2
                JOIN sections s ON s.id = aa2.section_id
                JOIN grades g ON g.id = s.grade_id
                WHERE aa2.activity_id = a.id AND aa2.section_id IS NOT NULL
              )
            )
            WHEN EXISTS (
              SELECT 1 FROM activity_assignments aa WHERE aa.activity_id = a.id AND aa.grade_id IS NOT NULL
            ) THEN CONCAT(
              'Grades: ',
              (
                SELECT GROUP_CONCAT(g.name ORDER BY g.id SEPARATOR ', ')
                FROM activity_assignments aa3
                JOIN grades g ON g.id = aa3.grade_id
                WHERE aa3.activity_id = a.id AND aa3.grade_id IS NOT NULL AND aa3.section_id IS NULL
              )
            )
            ELSE 'No assignments'
          END AS scope_text
        FROM activities a
        LEFT JOIN users u ON u.id = a.created_by
        ${whereSql}
        ORDER BY a.activity_date DESC, a.id DESC
        LIMIT ? OFFSET ?
      `
      const [rows] = await db.query(sql, [...params, limit, offset])

      const normalized = rows.map(r => ({
        ...r,
        payments_enabled: !!Number(r.payments_enabled)
      }))

      return res.status(200).json({ total, page: Number(page), page_size: limit, activities: normalized })
    }

    if (req.method === 'POST') {
      // Create activity + assignments (role-aware)
      const {
        title,
        activity_date,
        payments_enabled,
        fee_type = 'fee',
        fee_amount = null,
        assignment_mode,
        grade_ids = [],
        section_id = null
      } = req.body

      if (!title || !activity_date) return res.status(400).json({ message: 'title and activity_date are required' })
      const syId = await getCurrentSchoolYearId()
      const payFlag = typeof payments_enabled === 'undefined' ? 1 : payments_enabled ? 1 : 0

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        const [ins] = await conn.query(
          `INSERT INTO activities
             (title, activity_date, fee_type, fee_amount, school_year_id, payments_enabled, created_by, is_deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
          [title, activity_date, fee_type, fee_amount, syId, payFlag, session.user.id]
        )
        const activityId = ins.insertId

        // Build assignments
        if (session.user.role === 'admin') {
          if (assignment_mode === 'ALL') {
            // expand to all sections
            const [secs] = await conn.query(
              `SELECT s.id AS section_id, s.grade_id
              FROM sections s
              WHERE s.is_deleted = 0
              ORDER BY s.grade_id, s.name`
            )
            if (!secs.length) {
              await conn.rollback()

              return res.status(400).json({ message: 'No sections found to assign' })
            }

            const values = secs.map(r => [activityId, r.grade_id, r.section_id])
            await conn.query(`INSERT INTO activity_assignments (activity_id, grade_id, section_id) VALUES ?`, [values])
          } else if (assignment_mode === 'GRADES') {
            if (!Array.isArray(grade_ids) || grade_ids.length === 0) {
              await conn.rollback()

              return res.status(400).json({ message: 'Select at least one grade' })
            }

            // expand to all sections that belong to the selected grades
            const [secs] = await conn.query(
              `SELECT s.id AS section_id, s.grade_id
              FROM sections s
              WHERE s.is_deleted = 0
                AND s.grade_id IN ( ${grade_ids.map(() => '?').join(',')} )
              ORDER BY s.grade_id, s.name`,
              grade_ids
            )
            if (!secs.length) {
              await conn.rollback()

              return res.status(400).json({ message: 'No sections found for the selected grades' })
            }

            const values = secs.map(r => [activityId, r.grade_id, r.section_id])
            await conn.query(`INSERT INTO activity_assignments (activity_id, grade_id, section_id) VALUES ?`, [values])
          } else {
            // Fallback: if admin forgot to pass a mode, default to ALL sections
            const [secs] = await conn.query(
              `SELECT s.id AS section_id, s.grade_id
              FROM sections s
              WHERE s.is_deleted = 0
              ORDER BY s.grade_id, s.name`
            )
            const values = secs.map(r => [activityId, r.grade_id, r.section_id])
            await conn.query(`INSERT INTO activity_assignments (activity_id, grade_id, section_id) VALUES ?`, [values])
          }
        } else if (session.user.role === 'teacher') {
          // must be a section the teacher is assigned to (current SY)
          if (!section_id) {
            await conn.rollback()

            return res.status(400).json({ message: 'section_id is required for teachers' })
          }

          const [[ok]] = await conn.query(
            `SELECT 1 AS ok
            FROM teacher_sections
            WHERE user_id = ? AND section_id = ? AND school_year_id = ?
            LIMIT 1`,
            [session.user.id, section_id, syId]
          )
          if (!ok) {
            await conn.rollback()

            return res.status(403).json({ message: 'Forbidden: not your section (current SY)' })
          }

          await conn.query(
            `INSERT INTO activity_assignments (activity_id, grade_id, section_id)
     VALUES (?, (SELECT grade_id FROM sections WHERE id = ?), ?)`,
            [activityId, section_id, section_id]
          )
        } else {
          await conn.rollback()

          return res.status(403).json({ message: 'Forbidden' })
        }

        await conn.commit()
        conn.release()

        return res.status(201).json({ id: activityId })
      } catch (err) {
        if (conn) {
          try {
            await conn.rollback()
          } catch {}
          try {
            conn.release()
          } catch {}
        }

        // Handle duplicate assignment edge (unique on activity_id,grade_id,section_id)
        if (err?.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Duplicate assignment for this activity' })
        }
        console.error('Activities POST error:', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Activities index error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
