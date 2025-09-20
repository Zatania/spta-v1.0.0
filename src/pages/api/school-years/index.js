// pages/api/school-years/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

    const [rows] = await db.query(
      `SELECT id, name, start_date, end_date, is_current
       FROM school_years
       ORDER BY start_date ASC`
    )

    return res.status(200).json(rows)
  } catch (err) {
    console.error('GET /api/school-years error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
