// pages/api/_lib/schoolYear.js
import db from '../../db'

export async function getCurrentSchoolYearId() {
  const [rows] = await db.query('SELECT id FROM school_years WHERE is_current = 1 LIMIT 1')
  if (!rows.length) throw new Error('No current school year set')

  return rows[0].id
}

export async function getNextSchoolYearId() {
  const [rows] = await db.query(
    `SELECT id
     FROM school_years
     WHERE start_date > (SELECT start_date FROM school_years WHERE is_current = 1 LIMIT 1)
     ORDER BY start_date ASC
     LIMIT 1`
  )

  return rows.length ? rows[0].id : null
}
