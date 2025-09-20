// pages/api/payments/bulk.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    const { activity_assignment_id, records } = req.body
    if (!activity_assignment_id || !Array.isArray(records)) return res.status(400).json({ message: 'Invalid payload' })

    // Get assignment + activity policy
    const [[assignment]] = await db.query(
      `SELECT aa.id, aa.section_id,
              a.payments_enabled, a.fee_type, a.fee_amount
         FROM activity_assignments aa
         JOIN activities a ON a.id = aa.activity_id
        WHERE aa.id = ? LIMIT 1`,
      [activity_assignment_id]
    )
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

    // Teacher permission: must own the section
    if (session.user.role === 'teacher') {
      const [[ok]] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
        session.user.id,
        assignment.section_id
      ])
      if (!ok) return res.status(403).json({ message: 'Forbidden' })
    }

    // If payments are disabled for the activity, zero out all payments.
    const paymentsOff = Number(assignment.payments_enabled) === 0

    const values = []
    const params = []

    for (const r of records) {
      const paid = paymentsOff ? 0 : r.paid ? 1 : 0

      // Normalize amount:
      // - DB requires NOT NULL. Use 0.00 when unpaid or blank.
      // - Optionally, for strict fee events, you can default to fee_amount if paid=1 and amount missing.
      let amountNum = 0
      if (paid) {
        const n = Number(r.amount)
        if (Number.isFinite(n) && n >= 0) {
          amountNum = n
        } else {
          // Loose mode: accept 0 when amount missing.
          // Strict alternative (uncomment to enforce):
          // if (assignment.fee_type === 'fee' && assignment.fee_amount != null) {
          //   amountNum = Number(assignment.fee_amount)
          // } else {
          //   return res.status(400).json({ message: 'Amount is required when marking as paid.' })
          // }
          amountNum = 0
        }
      }

      // Normalize payment_date: only keep when paid=1
      const paymentDate = paid ? r.payment_date || null : null

      values.push('(?, ?, ?, ?, ?, ?, NOW())')
      params.push(
        activity_assignment_id,
        r.student_id,
        paid,
        amountNum, // never NULL
        paymentDate, // may be NULL
        session.user.id
      )
    }

    if (!values.length) return res.status(400).json({ message: 'No records to save' })

    const sql = `
      INSERT INTO payments (activity_assignment_id, student_id, paid, amount, payment_date, marked_by, marked_at)
      VALUES ${values.join(', ')}
      ON DUPLICATE KEY UPDATE
        paid = VALUES(paid),
        amount = VALUES(amount),
        payment_date = VALUES(payment_date),
        marked_by = VALUES(marked_by),
        marked_at = VALUES(marked_at)
    `
    await db.query(sql, params)

    return res.status(200).json({ message: 'Payments saved' })
  } catch (err) {
    console.error('payments bulk error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
