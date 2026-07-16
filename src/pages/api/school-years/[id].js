import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { auditLog } from '../lib/audit'

async function assertNoOverlap(conn, startDate, endDate, excludeId) {
  const [rows] = await conn.query(
    `SELECT id, name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date FROM school_years WHERE ? <= end_date AND ? >= start_date AND id <> ? LIMIT 1`,
    [startDate, endDate, excludeId]
  )
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
  const id = Number(req.query.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid school year id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    if (req.method === 'PUT') {
      const { name, start_date, end_date } = req.body || {}

      if (!name || !isValidDate(start_date) || !isValidDate(end_date)) {
        return res.status(400).json({ message: 'Name, valid start date, and valid end date are required' })
      }

      if (new Date(start_date) > new Date(end_date)) {
        return res.status(400).json({ message: 'Start date cannot be after end date' })
      }

      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        const [existing] = await conn.query('SELECT id FROM school_years WHERE id = ? LIMIT 1', [id])
        if (!existing.length) {
          await conn.rollback()
          conn.release()
          return res.status(404).json({ message: 'School year not found' })
        }

        await assertNoOverlap(conn, start_date, end_date, id)

        await conn.query('UPDATE school_years SET name = ?, start_date = ?, end_date = ? WHERE id = ?', [
          String(name).trim(),
          start_date,
          end_date,
          id
        ])

        await auditLog({
          actorUserId: session.user.id,
          action: 'school_year.update',
          entityType: 'school_year',
          entityId: id,
          details: { name, start_date, end_date }
        }, conn)

        await conn.commit()
        conn.release()
        return res.status(200).json({ message: 'School year updated' })
      } catch (err) {
        try { await conn.rollback() } catch {}
        try { conn.release() } catch {}
        if (err?.statusCode) return res.status(err.statusCode).json({ message: err.message })
        if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Duplicate school year name' })
        throw err
      }


    }

    if (req.method === 'DELETE') {
      const [[usage]] = await db.query(
        `SELECT
            (SELECT COUNT(*) FROM student_enrollments WHERE school_year_id = ?) AS enrollments,
            (SELECT COUNT(*) FROM activities WHERE school_year_id = ?) AS activities,
            (SELECT COUNT(*) FROM teacher_sections WHERE school_year_id = ?) AS teacher_assignments,
            (SELECT COUNT(*) FROM school_years WHERE id = ? AND is_current = 1) AS is_current`,
        [id, id, id, id]
      )

      if (Number(usage?.is_current || 0) > 0) {
        return res.status(400).json({ message: 'Cannot delete the current school year' })
      }

      if (Number(usage?.enrollments || 0) > 0 || Number(usage?.activities || 0) > 0 || Number(usage?.teacher_assignments || 0) > 0) {
        return res.status(400).json({
          message: 'Cannot delete a school year with enrollments, activities, or teacher assignments',
          usage
        })
      }

      const [result] = await db.query('DELETE FROM school_years WHERE id = ?', [id])
      if (!result.affectedRows) return res.status(404).json({ message: 'School year not found' })

      await auditLog({
        actorUserId: session.user.id,
        action: 'school_year.delete',
        entityType: 'school_year',
        entityId: id
      })

      return res.status(200).json({ message: 'School year deleted' })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error(`/api/school-years/${id} error:`, err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
