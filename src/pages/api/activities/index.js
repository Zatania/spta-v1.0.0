// pages/api/activities/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { resolveSchoolYearId } from '../lib/schoolYear'
import { auditLog } from '../lib/audit'

function normalizeFeeType(value) {
  const allowed = new Set(['fee', 'donation', 'service', 'mixed', 'none'])

  return allowed.has(value) ? value : 'none'
}

function normalizeMoney(value) {
  if (value === '' || value == null) return null
  const n = Number(value)

  return Number.isFinite(n) && n >= 0 ? n : null
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const syId = await resolveSchoolYearId(req)

    if (req.method === 'GET') {
      const { search = '', date_from = '', date_to = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(500, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['a.is_deleted = 0', 'a.school_year_id = ?']
      const whereParams = [syId]
      const joinParams = []

      if (search) {
        where.push('a.title LIKE ?')
        whereParams.push(`%${search}%`)
      }
      if (date_from) {
        where.push('a.activity_date >= ?')
        whereParams.push(date_from)
      }
      if (date_to) {
        where.push('a.activity_date <= ?')
        whereParams.push(date_to)
      }

      const joins = [
        'JOIN activity_assignments aa ON aa.activity_id = a.id AND aa.school_year_id = a.school_year_id',
        'JOIN sections s ON s.id = aa.section_id AND s.is_deleted = 0',
        'JOIN grades g ON g.id = aa.grade_id'
      ]

      if (session.user.role === 'teacher') {
        joins.push(
          `JOIN teacher_sections ts
             ON ts.section_id = aa.section_id
            AND ts.user_id = ?
            AND ts.school_year_id = ?
            AND ts.is_active = 1`
        )
        joinParams.push(session.user.id, syId)
      }

      const whereSql = `WHERE ${where.join(' AND ')}`
      const joinSql = joins.join('\n')

      const [countRows] = await db.query(
        `SELECT COUNT(DISTINCT a.id) AS total
           FROM activities a
           ${joinSql}
          ${whereSql}`,
        [...joinParams, ...whereParams]
      )

      const [rows] = await db.query(
        `SELECT
            a.id,
            a.title,
            DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
            a.created_by,
            a.fee_type,
            a.fee_amount,
            COALESCE(a.payments_enabled, 1) AS payments_enabled,
            u.full_name AS created_by_name,
            CONCAT('Sections: ', GROUP_CONCAT(DISTINCT CONCAT(g.name, '-', s.name) ORDER BY g.id, s.name SEPARATOR ', ')) AS scope_text,
            COUNT(DISTINCT aa.section_id) AS section_count,
            CASE WHEN a.created_by = ? OR ? = 'admin' THEN 1 ELSE 0 END AS can_edit,
            CASE WHEN a.created_by = ? OR ? = 'admin' THEN 1 ELSE 0 END AS can_toggle
           FROM activities a
           ${joinSql}
           LEFT JOIN users u ON u.id = a.created_by
          ${whereSql}
          GROUP BY a.id, a.title, a.activity_date, a.created_by, a.fee_type, a.fee_amount, a.payments_enabled, u.full_name
          ORDER BY a.activity_date DESC, a.id DESC
          LIMIT ? OFFSET ?`,
        [session.user.id, session.user.role, session.user.id, session.user.role, ...joinParams, ...whereParams, limit, offset]
      )

      return res.status(200).json({
        total: countRows[0]?.total || 0,
        page: Number(page),
        page_size: limit,
        activities: rows.map(r => ({
          ...r,
          payments_enabled: !!Number(r.payments_enabled),
          can_edit: !!Number(r.can_edit),
          can_toggle: !!Number(r.can_toggle)
        }))
      })
    }

    if (req.method === 'POST') {
      const {
        title,
        activity_date,
        payments_enabled,
        fee_type = 'none',
        fee_amount = null,
        assignment_mode,
        grade_ids = [],
        section_id = null
      } = req.body || {}

      if (!title || !activity_date) return res.status(400).json({ message: 'title and activity_date are required' })

      const payFlag = typeof payments_enabled === 'undefined' ? 1 : payments_enabled ? 1 : 0
      const safeFeeType = normalizeFeeType(fee_type)
      const safeFeeAmount = safeFeeType === 'fee' || safeFeeType === 'mixed' ? normalizeMoney(fee_amount) : null

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        const [insertedActivity] = await conn.query(
          `INSERT INTO activities
             (title, activity_date, fee_type, fee_amount, school_year_id, payments_enabled, created_by, is_deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
          [String(title).trim(), activity_date, safeFeeType, safeFeeAmount, syId, payFlag, session.user.id]
        )
        const activityId = insertedActivity.insertId

        let sections = []

        if (session.user.role === 'admin') {
          if (assignment_mode === 'GRADES') {
            const gradeIds = [...new Set((Array.isArray(grade_ids) ? grade_ids : []).map(Number).filter(Number.isInteger))]
            if (!gradeIds.length) {
              await conn.rollback()
              conn.release()

              return res.status(400).json({ message: 'Select at least one grade' })
            }

            const [rows] = await conn.query(
              `SELECT id AS section_id, grade_id
                 FROM sections
                WHERE is_deleted = 0
                  AND grade_id IN (${gradeIds.map(() => '?').join(',')})
                ORDER BY grade_id, name`,
              gradeIds
            )
            sections = rows
          } else if (assignment_mode === 'SECTION') {
            const sectionId = Number(section_id)
            if (!Number.isInteger(sectionId) || sectionId <= 0) {
              await conn.rollback()
              conn.release()

              return res.status(400).json({ message: 'section_id is required for SECTION mode' })
            }
            const [rows] = await conn.query(
              `SELECT id AS section_id, grade_id
                 FROM sections
                WHERE id = ? AND is_deleted = 0
                LIMIT 1`,
              [sectionId]
            )
            sections = rows
          } else {
            const [rows] = await conn.query(
              `SELECT id AS section_id, grade_id
                 FROM sections
                WHERE is_deleted = 0
                ORDER BY grade_id, name`
            )
            sections = rows
          }
        } else if (session.user.role === 'teacher') {
          const sectionId = Number(section_id)
          if (!Number.isInteger(sectionId) || sectionId <= 0) {
            await conn.rollback()
            conn.release()

            return res.status(400).json({ message: 'section_id is required for teachers' })
          }

          const [rows] = await conn.query(
            `SELECT s.id AS section_id, s.grade_id
               FROM teacher_sections ts
               JOIN sections s ON s.id = ts.section_id AND s.is_deleted = 0
              WHERE ts.user_id = ?
                AND ts.section_id = ?
                AND ts.school_year_id = ?
                AND ts.is_active = 1
              LIMIT 1`,
            [session.user.id, sectionId, syId]
          )
          sections = rows
        } else {
          await conn.rollback()
          conn.release()

          return res.status(403).json({ message: 'Forbidden' })
        }

        if (!sections.length) {
          await conn.rollback()
          conn.release()

          return res.status(400).json({ message: 'No valid sections found for this activity' })
        }

        await conn.query(
          `INSERT INTO activity_assignments (activity_id, grade_id, section_id, school_year_id)
           VALUES ?`,
          [sections.map(s => [activityId, s.grade_id, s.section_id, syId])]
        )

        await auditLog(
          {
            actorUserId: session.user.id,
            action: 'activity.create',
            entityType: 'activity',
            entityId: activityId,
            details: {
              school_year_id: syId,
              title,
              activity_date,
              fee_type: safeFeeType,
              payments_enabled: !!payFlag,
              section_ids: sections.map(s => s.section_id)
            }
          },
          conn
        )

        await conn.commit()
        conn.release()

        return res.status(201).json({ id: activityId, assigned_sections: sections.length })
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
          return res.status(409).json({
            message:
              'Duplicate assignment for this activity. If this happened on a new activity, run the migration that removes UNIQUE(activity_id) from activity_assignments.'
          })
        }
        console.error('POST /api/activities error:', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('/api/activities error:', err)

    return res.status(500).json({ message: err.message || 'Internal server error' })
  }
}
