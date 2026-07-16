import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { auditLog } from '../lib/audit'

async function assertNoOverlap(conn, startDate, endDate, excludeId = null) {
  const params = [startDate, endDate]
  let sql = `SELECT id, name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date FROM school_years WHERE ? <= end_date AND ? >= start_date`
  if (excludeId) {
    sql += ' AND id <> ?'
    params.push(excludeId)
  }
  sql += ' LIMIT 1'
  const [rows] = await conn.query(sql, params)
  if (rows.length) {
    const err = new Error(`School year overlaps ${rows[0].name} (${rows[0].start_date} to ${rows[0].end_date})`)
    err.statusCode = 409
    throw err
  }
}

function isValidDate(value) {
  if (!value) return false
  const d = new Date(value)

  return !Number.isNaN(d.getTime())
}

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      const [rows] = await db.query(
        `SELECT
            sy.id,
            sy.name,
            DATE_FORMAT(sy.start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(sy.end_date, '%Y-%m-%d') AS end_date,
            sy.is_current,
            COUNT(DISTINCT en.student_id) AS enrolled_students,
            COUNT(DISTINCT ts.id) AS active_teacher_assignments
           FROM school_years sy
           LEFT JOIN student_enrollments en
             ON en.school_year_id = sy.id
            AND en.status = 'active'
           LEFT JOIN teacher_sections ts
             ON ts.school_year_id = sy.id
            AND ts.is_active = 1
          GROUP BY sy.id, sy.name, sy.start_date, sy.end_date, sy.is_current
          ORDER BY sy.start_date DESC, sy.id DESC`
      )

      return res.status(200).json(rows)
    }

    if (req.method === 'POST') {
      if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

      const { name, start_date, end_date, is_current = false } = req.body || {}

      if (!name || !isValidDate(start_date) || !isValidDate(end_date)) {
        return res.status(400).json({ message: 'Name, valid start date, and valid end date are required' })
      }

      if (new Date(start_date) > new Date(end_date)) {
        return res.status(400).json({ message: 'Start date cannot be after end date' })
      }

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        await assertNoOverlap(conn, start_date, end_date)

        const [[countRow]] = await conn.query('SELECT COUNT(*) AS count FROM school_years')
        const makeCurrent = Number(countRow.count) === 0 || !!is_current

        if (makeCurrent) {
          await conn.query('UPDATE school_years SET is_current = 0')
        }

        const [result] = await conn.query(
          `INSERT INTO school_years (name, start_date, end_date, is_current)
           VALUES (?, ?, ?, ?)`,
          [String(name).trim(), start_date, end_date, makeCurrent ? 1 : 0]
        )

        await auditLog(
          {
            actorUserId: session.user.id,
            action: 'school_year.create',
            entityType: 'school_year',
            entityId: result.insertId,
            details: { name, start_date, end_date, is_current: makeCurrent }
          },
          conn
        )

        await conn.commit()
        conn.release()

        return res.status(201).json({ id: result.insertId, message: 'School year created' })
      } catch (err) {
        if (conn) {
          try {
            await conn.rollback()
          } catch {}
          try {
            conn.release()
          } catch {}
        }

        if (err?.statusCode) return res.status(err.statusCode).json({ message: err.message })

        if (err?.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'School year already exists or duplicate current school year' })
        }

        console.error('POST /api/school-years error:', err)

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('/api/school-years error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
