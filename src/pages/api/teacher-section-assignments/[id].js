import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { auditLog } from '../lib/audit'

export default async function handler(req, res) {
  const id = Number(req.query.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid assignment id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (session.user.role !== 'admin') return res.status(403).json({ message: 'Admins only' })

    if (req.method === 'DELETE') {
      const [[assignment]] = await db.query(
        `SELECT ts.id, ts.user_id, ts.section_id, ts.school_year_id, u.full_name, s.name AS section_name
           FROM teacher_sections ts
           LEFT JOIN users u ON u.id = ts.user_id
           LEFT JOIN sections s ON s.id = ts.section_id
          WHERE ts.id = ? AND ts.is_active = 1
          LIMIT 1`,
        [id]
      )

      if (!assignment) return res.status(404).json({ message: 'Active assignment not found' })

      await db.query(
        `UPDATE teacher_sections
            SET is_active = 0, unassigned_at = NOW()
          WHERE id = ?`,
        [id]
      )

      await auditLog({
        actorUserId: session.user.id,
        action: 'teacher_section.unassign',
        entityType: 'teacher_section',
        entityId: id,
        details: assignment
      })

      return res.status(200).json({ message: 'Teacher unassigned' })
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error(`/api/teacher-section-assignments/${id} error:`, err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
