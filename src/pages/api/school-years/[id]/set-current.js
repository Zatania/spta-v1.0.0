import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { auditLog } from '../../lib/audit'

export default async function handler(req, res) {
  const id = Number(req.query.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid school year id' })

  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

  let conn
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    const [existing] = await db.query('SELECT id, name FROM school_years WHERE id = ? LIMIT 1', [id])
    if (!existing.length) return res.status(404).json({ message: 'School year not found' })

    conn = await db.getConnection()
    await conn.beginTransaction()

    await conn.query('UPDATE school_years SET is_current = 0')
    await conn.query('UPDATE school_years SET is_current = 1 WHERE id = ?', [id])

    await auditLog(
      {
        actorUserId: session.user.id,
        action: 'school_year.set_current',
        entityType: 'school_year',
        entityId: id,
        details: { name: existing[0].name }
      },
      conn
    )

    await conn.commit()
    conn.release()

    return res.status(200).json({ message: 'Current school year updated' })
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback()
      } catch {}
      try {
        conn.release()
      } catch {}
    }
    console.error(`/api/school-years/${id}/set-current error:`, err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
