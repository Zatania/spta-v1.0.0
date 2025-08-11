// pages/api/attendance/bulk.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db' // adjust path

/**
 * POST /api/attendance/bulk
 * Body:
 * {
 *   activity_assignment_id: number,
 *   records: [
 *     { student_id, status: 'present'|'absent', parent_present: 0|1 }
 *   ]
 * }
 *
 * Upserts into attendance (unique constraint on activity_assignment_id + student_id)
 * Only teachers assigned to assignment.section or admins can update.
 */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { activity_assignment_id, records } = req.body
    if (!activity_assignment_id || !Array.isArray(records)) return res.status(400).json({ message: 'Invalid payload' })

    // get assignment
    const [aa] = await db.query('SELECT * FROM activity_assignments WHERE id = ? LIMIT 1', [activity_assignment_id])
    if (!aa.length) return res.status(404).json({ message: 'Assignment not found' })
    const assignment = aa[0]

    // permission
    if (session.user.role === 'teacher') {
      const [ok] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
        session.user.id,
        assignment.section_id
      ])
      if (!ok.length) return res.status(403).json({ message: 'Forbidden' })
    }

    // Upsert rows using single multi-row query for efficiency
    // Prepare bulk insert values
    const values = []
    const params = []
    const now = new Date()
    for (const r of records) {
      const sid = r.student_id
      const status = r.status === 'present' ? 'present' : 'absent'
      const parent_present = r.parent_present ? 1 : 0
      values.push('(?, ?, ?, ?, ?, ?)')
      params.push(activity_assignment_id, sid, parent_present, status, session.user.id, now)
    }

    if (!values.length) return res.status(400).json({ message: 'No records to save' })

    // MySQL: ON DUPLICATE KEY UPDATE to update existing rows
    const sql = `
      INSERT INTO attendance (activity_assignment_id, student_id, parent_present, status, marked_by, marked_at)
      VALUES ${values.join(', ')}
      ON DUPLICATE KEY UPDATE
        parent_present = VALUES(parent_present),
        status = VALUES(status),
        marked_by = VALUES(marked_by),
        marked_at = VALUES(marked_at)
    `
    await db.query(sql, params)

    return res.status(200).json({ message: 'Attendance saved' })
  } catch (err) {
    console.error('attendance bulk error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
