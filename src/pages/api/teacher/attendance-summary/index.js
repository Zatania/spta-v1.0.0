// pages/api/teacher/attendance-summary.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'
import { getCurrentSchoolYearId } from '../../lib/schoolYear'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session || session.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const teacherId = session.user.id
  const syId = await getCurrentSchoolYearId()
  const { parent_ids } = req.query
  let parentIdList = []

  if (parent_ids) {
    parentIdList = parent_ids
      .split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id))
  }

  try {
    // Get activities for teacher's sections in the current SY
    const sql = `
      SELECT DISTINCT a.id, a.title, a.activity_date
      FROM activities a
      JOIN activity_assignments aa ON aa.activity_id = a.id
      JOIN teacher_sections ts ON ts.section_id = aa.section_id AND ts.user_id = ? AND ts.school_year_id = ?
      WHERE a.is_deleted = 0 AND a.school_year_id = ?
      ORDER BY a.activity_date DESC, a.title ASC
    `
    const [activities] = await db.query(sql, [teacherId, syId, syId])

    if (!activities.length) return res.status(200).json({ activities: [] })

    const activityIds = activities.map(a => a.id)

    // Totals across attendance, payments, contributions (with optional parent filter)
    let totalsQuery = `
      SELECT
          aa.activity_id,
          COALESCE(SUM(att.present_count),0)   AS present_count,
          COALESCE(SUM(att.absent_count),0)    AS absent_count,
          COALESCE(SUM(pay.paid_count),0)      AS paid_count,
          COALESCE(SUM(pay.unpaid_count),0)    AS unpaid_count,
          COALESCE(SUM(contrib.contrib_students),0) AS contrib_students,
          COALESCE(SUM(contrib.total_hours),0)      AS contrib_hours_total,
          COALESCE(SUM(contrib.total_value),0)      AS contrib_estimated_total
      FROM activity_assignments aa
      -- ATTENDANCE (filtered via enrollments + optional parents)
      LEFT JOIN (
          SELECT
              at.activity_assignment_id,
              SUM(at.parent_present = 1) AS present_count,
              SUM(at.parent_present = 0) AS absent_count
          FROM attendance at
          JOIN activity_assignments aa2 ON aa2.id = at.activity_assignment_id
          JOIN student_enrollments se ON se.student_id = at.student_id
            AND se.section_id = aa2.section_id AND se.school_year_id = ?
          JOIN students s ON s.id = se.student_id AND s.is_deleted = 0
          ${
            parentIdList.length
              ? `INNER JOIN student_parents sp ON sp.student_id = s.id AND sp.parent_id IN (${parentIdList
                  .map(() => '?')
                  .join(',')})`
              : ''
          }
          GROUP BY at.activity_assignment_id
      ) att ON att.activity_assignment_id = aa.id
      -- PAYMENTS (filtered via enrollments + optional parents)
      LEFT JOIN (
          SELECT
              p.activity_assignment_id,
              SUM(p.paid = 1) AS paid_count,
              SUM(p.paid = 0) AS unpaid_count
          FROM payments p
          JOIN activity_assignments aa3 ON aa3.id = p.activity_assignment_id
          JOIN student_enrollments se2 ON se2.student_id = p.student_id
            AND se2.section_id = aa3.section_id AND se2.school_year_id = ?
          JOIN students s ON s.id = se2.student_id AND s.is_deleted = 0
          ${
            parentIdList.length
              ? `INNER JOIN student_parents sp2 ON sp2.student_id = s.id AND sp2.parent_id IN (${parentIdList
                  .map(() => '?')
                  .join(',')})`
              : ''
          }
          GROUP BY p.activity_assignment_id
      ) pay ON pay.activity_assignment_id = aa.id
      -- CONTRIBUTIONS (filtered via enrollments + optional parents)
      LEFT JOIN (
          SELECT
            c.activity_assignment_id,
            COUNT(DISTINCT c.student_id) AS contrib_students,
            COALESCE(SUM(c.hours_worked),0) AS total_hours,
            COALESCE(SUM(c.estimated_value),0) AS total_value
          FROM contributions c
          JOIN activity_assignments aa4 ON aa4.id = c.activity_assignment_id
          JOIN student_enrollments se3 ON se3.student_id = c.student_id
            AND se3.section_id = aa4.section_id AND se3.school_year_id = ?
          ${
            parentIdList.length
              ? `JOIN student_parents sp3 ON sp3.student_id = se3.student_id AND sp3.parent_id IN (${parentIdList
                  .map(() => '?')
                  .join(',')})`
              : ''
          }
          GROUP BY c.activity_assignment_id
      ) contrib ON contrib.activity_assignment_id = aa.id
      WHERE aa.activity_id IN (${activityIds.map(() => '?').join(',')})
        AND aa.section_id IN (
            SELECT section_id
            FROM teacher_sections
            WHERE user_id = ? AND school_year_id = ?
        )
      GROUP BY aa.activity_id
    `

    const totalsParams = [
      syId,
      ...(parentIdList.length ? parentIdList : []),
      syId,
      ...(parentIdList.length ? parentIdList : []),
      syId,
      ...(parentIdList.length ? parentIdList : []),
      ...activityIds,
      teacherId,
      syId
    ]

    const [totals] = await db.query(totalsQuery, totalsParams)

    // Map totals by activity_id
    const totalsByActivity = new Map()
    for (const t of totals) totalsByActivity.set(t.activity_id, t)

    const out = activities.map(a => {
      const t = totalsByActivity.get(a.id) || {}

      return {
        id: a.id,
        title: a.title,
        activity_date: a.activity_date,
        present_count: Number(t.present_count || 0),
        absent_count: Number(t.absent_count || 0),
        paid_count: Number(t.paid_count || 0),
        unpaid_count: Number(t.unpaid_count || 0),
        contrib_students: Number(t.contrib_students || 0),
        contrib_hours_total: Number(t.contrib_hours_total || 0),
        contrib_estimated_total: Number(t.contrib_estimated_total || 0)
      }
    })

    return res.status(200).json({ activities: out })
  } catch (err) {
    console.error('attendance-summary error', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
