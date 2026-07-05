import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { auditLog } from '../lib/audit'

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

        if (is_current) {
          await conn.query('UPDATE school_years SET is_current = 0')
        }

        const [result] = await conn.query(
          `INSERT INTO school_years (name, start_date, end_date, is_current)
           VALUES (?, ?, ?, ?)`,
          [String(name).trim(), start_date, end_date, is_current ? 1 : 0]
        )

        await auditLog(
          {
            actorUserId: session.user.id,
            action: 'school_year.create',
            entityType: 'school_year',
            entityId: result.insertId,
            details: { name, start_date, end_date, is_current: !!is_current }
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
