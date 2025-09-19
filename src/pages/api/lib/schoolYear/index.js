// pages/api/_lib/schoolYear.js
import db from '../../db'

export async function getCurrentSchoolYearId(conn = db) {
  const [rows] = await conn.query(`SELECT id FROM school_years WHERE is_current = 1 ORDER BY id DESC LIMIT 1`)
  if (!rows.length) {
    throw new Error('No current school year set (school_years.is_current=1).')
  }

  return rows[0].id
}
