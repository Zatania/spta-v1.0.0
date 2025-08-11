// pages/api/grades.js
import db from '../db'

export default async function handler(req, res) {
  try {
    const [rows] = await db.query(`SELECT id, name FROM grades`)
    res.status(200).json(rows)
  } catch (err) {
    console.error('GET /grades error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
}
