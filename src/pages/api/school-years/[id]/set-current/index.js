import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'

export default async function handler(req, res) {
  const id = Number(req.query.id)
  if (!id) return res.status(400).json({ message: 'Invalid school year id' })

  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    const [[sy]] = await db.query('SELECT id FROM school_years WHERE id = ? LIMIT 1', [id])
    if (!sy) return res.status(404).json({ message: 'School year not found' })

    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('UPDATE school_years SET is_current = 0')
      await conn.query('UPDATE school_years SET is_current = 1 WHERE id = ?', [id])
      await conn.commit()
      conn.release()

      return res.status(200).json({ message: 'Current school year updated' })
    } catch (err) {
      await conn.rollback().catch(() => {})
      conn.release()
      throw err
    }
  } catch (err) {
    console.error('/api/school-years/[id]/set-current error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
