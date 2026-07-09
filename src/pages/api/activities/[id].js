// pages/api/activities/[id].js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'
import { auditLog } from '../lib/audit'

function normalizeFeeType(value) {
  const allowed = new Set(['fee', 'donation', 'service', 'mixed', 'none'])

  return allowed.has(value) ? value : 'none'
}

function parseIdArray(value) {
  const arr = Array.isArray(value) ? value : value == null || value === '' ? [] : String(value).split(',')

  return [...new Set(arr.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0))]
}

function normalizeMoney(value) {
  if (value === '' || value == null) return null
  const n = Number(value)

  return Number.isFinite(n) && n >= 0 ? n : null
}

async function teacherCanSeeActivity(conn, userId, activityId) {
  const [[ok]] = await conn.query(
    `SELECT 1
       FROM activities a
       JOIN activity_assignments aa
         ON aa.activity_id = a.id
        AND aa.school_year_id = a.school_year_id
       JOIN teacher_sections ts
         ON ts.section_id = aa.section_id
        AND ts.school_year_id = aa.school_year_id
        AND ts.user_id = ?
        AND ts.is_active = 1
      WHERE a.id = ?
        AND a.is_deleted = 0
      LIMIT 1`,
    [userId, activityId]
  )

  return !!ok
}

async function loadActivityAssignments(conn, activityId, schoolYearId) {
  const [assignments] = await conn.query(
    `SELECT
        aa.id,
        aa.grade_id,
        aa.section_id,
        g.name AS grade_name,
        s.name AS section_name
       FROM activity_assignments aa
       JOIN grades g ON g.id = aa.grade_id
       JOIN sections s ON s.id = aa.section_id
      WHERE aa.activity_id = ?
        AND aa.school_year_id = ?
      ORDER BY g.id, s.name`,
    [activityId, schoolYearId]
  )

  return assignments
}

async function inferAssignmentMode(conn, assignments) {
  if (!assignments.length) {
    return { assignment_mode: 'GRADES', selected_grade_ids: [], section_id: '' }
  }

  const assignedSectionIds = new Set(assignments.map(a => Number(a.section_id)))
  const assignedGradeIds = [...new Set(assignments.map(a => Number(a.grade_id)))]

  const [[sectionCountRow]] = await conn.query(`SELECT COUNT(*) AS cnt FROM sections WHERE is_deleted = 0`)
  if (assignedSectionIds.size === Number(sectionCountRow?.cnt || 0)) {
    return { assignment_mode: 'ALL', selected_grade_ids: [], section_id: '' }
  }

  const [gradeSectionCounts] = await conn.query(
    `SELECT grade_id, COUNT(*) AS cnt
       FROM sections
      WHERE is_deleted = 0
        AND grade_id IN (${assignedGradeIds.map(() => '?').join(',')})
      GROUP BY grade_id`,
    assignedGradeIds
  )

  const totalSectionsByGrade = new Map(gradeSectionCounts.map(r => [Number(r.grade_id), Number(r.cnt)]))
  const assignedCountByGrade = new Map()
  assignments.forEach(a => assignedCountByGrade.set(Number(a.grade_id), (assignedCountByGrade.get(Number(a.grade_id)) || 0) + 1))

  const completeGradeIds = []
  let hasPartialGrade = false
  for (const gradeId of assignedGradeIds) {
    if (assignedCountByGrade.get(gradeId) === totalSectionsByGrade.get(gradeId)) completeGradeIds.push(String(gradeId))
    else hasPartialGrade = true
  }

  if (!hasPartialGrade && completeGradeIds.length) {
    return { assignment_mode: 'GRADES', selected_grade_ids: completeGradeIds, section_id: '' }
  }

  if (assignments.length === 1) {
    return { assignment_mode: 'SECTION', selected_grade_ids: [], section_id: String(assignments[0].section_id) }
  }

  return {
    assignment_mode: 'CUSTOM',
    selected_grade_ids: assignedGradeIds.map(String),
    section_id: '',
    section_ids: assignments.map(a => String(a.section_id))
  }
}

async function getTargetSections(conn, { assignment_mode, grade_ids, section_id }) {
  if (assignment_mode === 'ALL') {
    const [rows] = await conn.query(
      `SELECT id AS section_id, grade_id
         FROM sections
        WHERE is_deleted = 0
        ORDER BY grade_id, name`
    )

    return rows
  }

  if (assignment_mode === 'GRADES') {
    const gradeIds = parseIdArray(grade_ids)
    if (!gradeIds.length) {
      const err = new Error('Select at least one grade')
      err.status = 400
      throw err
    }

    const [rows] = await conn.query(
      `SELECT id AS section_id, grade_id
         FROM sections
        WHERE is_deleted = 0
          AND grade_id IN (${gradeIds.map(() => '?').join(',')})
        ORDER BY grade_id, name`,
      gradeIds
    )

    return rows
  }

  if (assignment_mode === 'SECTION') {
    const sectionId = Number(section_id)
    if (!Number.isInteger(sectionId) || sectionId <= 0) {
      const err = new Error('section_id is required for SECTION mode')
      err.status = 400
      throw err
    }

    const [rows] = await conn.query(
      `SELECT id AS section_id, grade_id
         FROM sections
        WHERE id = ? AND is_deleted = 0
        LIMIT 1`,
      [sectionId]
    )

    return rows
  }

  const err = new Error('assignment_mode must be ALL, GRADES, or SECTION')
  err.status = 400
  throw err
}

async function assertNoChildRecordsForRemovedAssignments(conn, removedAssignmentIds) {
  if (!removedAssignmentIds.length) return

  const placeholders = removedAssignmentIds.map(() => '?').join(',')
  const [[row]] = await conn.query(
    `SELECT
        (SELECT COUNT(*) FROM attendance WHERE activity_assignment_id IN (${placeholders})) AS attendance_count,
        (SELECT COUNT(*) FROM payments WHERE activity_assignment_id IN (${placeholders})) AS payment_count,
        (SELECT COUNT(*) FROM contributions WHERE activity_assignment_id IN (${placeholders})) AS contribution_count`,
    [...removedAssignmentIds, ...removedAssignmentIds, ...removedAssignmentIds]
  )

  const total = Number(row.attendance_count || 0) + Number(row.payment_count || 0) + Number(row.contribution_count || 0)
  if (total > 0) {
    const err = new Error(
      'Cannot remove sections from this activity because attendance, payment, or contribution records already exist. Create a new activity instead, or keep this activity as historical.'
    )
    err.status = 409
    err.details = row
    throw err
  }
}

export default async function handler(req, res) {
  const { id } = req.query
  const activityId = Number(id)
  if (!Number.isInteger(activityId) || activityId <= 0) return res.status(400).json({ message: 'Invalid activity id' })

  let conn
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })
    if (!['admin', 'teacher'].includes(session.user.role)) return res.status(403).json({ message: 'Forbidden' })

    conn = await db.getConnection()

    const [[activity]] = await conn.query(
      `SELECT
          a.id,
          a.title,
          DATE_FORMAT(a.activity_date, '%Y-%m-%d') AS activity_date,
          a.created_by,
          a.fee_type,
          a.fee_amount,
          a.school_year_id,
          COALESCE(a.payments_enabled, 1) AS payments_enabled,
          u.full_name AS created_by_name
         FROM activities a
         LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id = ?
          AND a.is_deleted = 0
        LIMIT 1`,
      [activityId]
    )

    if (!activity) {
      conn.release()

      return res.status(404).json({ message: 'Activity not found' })
    }

    if (session.user.role === 'teacher') {
      const visible = Number(activity.created_by) === Number(session.user.id) || (await teacherCanSeeActivity(conn, session.user.id, activityId))
      if (!visible) {
        conn.release()

        return res.status(403).json({ message: 'Forbidden' })
      }
    }

    if (req.method === 'GET') {
      const assignments = await loadActivityAssignments(conn, activityId, activity.school_year_id)
      const inferred = await inferAssignmentMode(conn, assignments)
      conn.release()

      return res.status(200).json({
        ...activity,
        payments_enabled: !!Number(activity.payments_enabled),
        assignments,
        ...inferred
      })
    }

    if (req.method === 'PUT') {
      const { title, activity_date, payments_enabled, fee_type, fee_amount, assignment_mode, grade_ids, section_id } = req.body || {}

      if (session.user.role !== 'admin' && Number(activity.created_by) !== Number(session.user.id)) {
        conn.release()

        return res.status(403).json({ message: 'Forbidden' })
      }

      await conn.beginTransaction()

      const sets = []
      const params = []

      if (typeof title !== 'undefined') {
        if (!String(title).trim()) {
          await conn.rollback()
          conn.release()

          return res.status(400).json({ message: 'title cannot be empty' })
        }
        sets.push('title = ?')
        params.push(String(title).trim())
      }
      if (typeof activity_date !== 'undefined') {
        if (!activity_date) {
          await conn.rollback()
          conn.release()

          return res.status(400).json({ message: 'activity_date cannot be empty' })
        }
        sets.push('activity_date = ?')
        params.push(activity_date)
      }
      if (typeof payments_enabled !== 'undefined') {
        sets.push('payments_enabled = ?')
        params.push(payments_enabled ? 1 : 0)
      }
      if (typeof fee_type !== 'undefined') {
        sets.push('fee_type = ?')
        params.push(normalizeFeeType(fee_type))
      }
      if (typeof fee_amount !== 'undefined') {
        const normalizedFeeType = typeof fee_type !== 'undefined' ? normalizeFeeType(fee_type) : activity.fee_type
        sets.push('fee_amount = ?')
        params.push(normalizedFeeType === 'fee' || normalizedFeeType === 'mixed' ? normalizeMoney(fee_amount) : null)
      }

      if (sets.length) {
        params.push(activityId)
        await conn.query(`UPDATE activities SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params)
      }

      let assignmentChanged = false
      let addedSectionIds = []
      let removedSectionIds = []

      // Only admins can change scope. Teachers may edit their own title/date/payment settings only.
      if (session.user.role === 'admin' && typeof assignment_mode !== 'undefined') {
        const targetSections = await getTargetSections(conn, { assignment_mode, grade_ids, section_id })
        if (!targetSections.length) {
          await conn.rollback()
          conn.release()

          return res.status(400).json({ message: 'No valid sections found for selected scope' })
        }

        const [currentAssignments] = await conn.query(
          `SELECT id, section_id
             FROM activity_assignments
            WHERE activity_id = ?
              AND school_year_id = ?`,
          [activityId, activity.school_year_id]
        )

        const currentBySection = new Map(currentAssignments.map(a => [Number(a.section_id), Number(a.id)]))
        const targetBySection = new Map(targetSections.map(s => [Number(s.section_id), s]))

        const removedAssignments = currentAssignments.filter(a => !targetBySection.has(Number(a.section_id)))
        const removedAssignmentIds = removedAssignments.map(a => Number(a.id))
        await assertNoChildRecordsForRemovedAssignments(conn, removedAssignmentIds)

        if (removedAssignmentIds.length) {
          await conn.query(`DELETE FROM activity_assignments WHERE id IN (${removedAssignmentIds.map(() => '?').join(',')})`, removedAssignmentIds)
          removedSectionIds = removedAssignments.map(a => Number(a.section_id))
        }

        const toAdd = targetSections.filter(s => !currentBySection.has(Number(s.section_id)))
        if (toAdd.length) {
          await conn.query(
            `INSERT INTO activity_assignments (activity_id, grade_id, section_id, school_year_id)
             VALUES ?`,
            [toAdd.map(s => [activityId, s.grade_id, s.section_id, activity.school_year_id])]
          )
          addedSectionIds = toAdd.map(s => Number(s.section_id))
        }

        assignmentChanged = !!removedAssignmentIds.length || !!toAdd.length
      }

      await auditLog(
        {
          actorUserId: session.user.id,
          action: 'activity.update',
          entityType: 'activity',
          entityId: activityId,
          details: {
            updated_fields: Object.keys(req.body || {}),
            assignment_changed: assignmentChanged,
            added_section_ids: addedSectionIds,
            removed_section_ids: removedSectionIds
          }
        },
        conn
      )

      await conn.commit()
      conn.release()

      return res.status(200).json({ message: 'Activity updated', assignment_changed: assignmentChanged })
    }

    if (req.method === 'DELETE') {
      if (session.user.role !== 'admin' && Number(activity.created_by) !== Number(session.user.id)) {
        conn.release()

        return res.status(403).json({ message: 'Forbidden' })
      }

      await conn.query(
        `UPDATE activities
            SET is_deleted = 1,
                deleted_at = NOW(),
                updated_at = NOW()
          WHERE id = ?`,
        [activityId]
      )

      await auditLog(
        {
          actorUserId: session.user.id,
          action: 'activity.delete',
          entityType: 'activity',
          entityId: activityId,
          details: { soft_deleted: true }
        },
        conn
      )

      conn.release()

      return res.status(200).json({
        message: 'Activity soft-deleted. Attendance, payments, contributions, and assignments were preserved.'
      })
    }

    conn.release()

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback()
      } catch {}
      try {
        conn.release()
      } catch {}
    }

    console.error('activity [id] error:', err)

    return res.status(err.status || 500).json({ message: err.message || 'Internal server error', ...(err.details ? { details: err.details } : {}) })
  }
}
