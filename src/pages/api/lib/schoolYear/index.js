import db from '../../db'

export async function getCurrentSchoolYear() {
  const [rows] = await db.query(
    `SELECT id, name, start_date, end_date, is_current
       FROM school_years
      WHERE is_current = 1
      LIMIT 1`
  )

  if (!rows.length) throw new Error('No current school year set')

  return rows[0]
}

export async function getCurrentSchoolYearId() {
  const sy = await getCurrentSchoolYear()

  return sy.id
}

export async function assertSchoolYearExists(schoolYearId) {
  const syId = Number(schoolYearId)
  if (!Number.isInteger(syId) || syId <= 0) throw new Error('Invalid school_year_id')

  const [rows] = await db.query(
    `SELECT id, name, start_date, end_date, is_current
       FROM school_years
      WHERE id = ?
      LIMIT 1`,
    [syId]
  )

  if (!rows.length) throw new Error('School year not found')

  return rows[0]
}

export async function resolveSchoolYearId(req) {
  const raw = req?.query?.school_year_id ?? req?.body?.school_year_id
  const syId = Number(raw)

  if (Number.isInteger(syId) && syId > 0) {
    await assertSchoolYearExists(syId)

    return syId
  }

  return getCurrentSchoolYearId()
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
