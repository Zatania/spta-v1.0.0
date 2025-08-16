import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import db from '../../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      let sql = `
        SELECT DISTINCT
          u.id, u.username, u.full_name, u.email,
          COALESCE(
            JSON_ARRAYAGG(
              JSON_OBJECT(
                'id', s.id,
                'name', s.name,
                'grade_id', s.grade_id,
                'grade_name', g.name
              )
            ),
            JSON_ARRAY()
          ) AS assigned_sections
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id AND r.name = 'teacher'
        LEFT JOIN teacher_sections ts ON ts.user_id = u.id
        LEFT JOIN sections s ON s.id = ts.section_id AND s.is_deleted = 0
        LEFT JOIN grades g ON g.id = s.grade_id
        WHERE u.is_deleted = 0
      `
      sql += `
        GROUP BY u.id, u.username, u.full_name, u.email
        ORDER BY u.full_name, u.username
      `

      const [rows] = await db.query(sql)

      // Process the assigned_sections result
      const teachers = rows.map(row => {
        let assigned_sections = row.assigned_sections || []

        // If it's already parsed to an object, use it directly
        if (typeof assigned_sections === 'object' && !Array.isArray(assigned_sections)) {
          assigned_sections = [assigned_sections]
        }

        // Ensure we always have an array and filter out null sections
        if (!Array.isArray(assigned_sections)) {
          assigned_sections = []
        }

        // Filter out null sections
        assigned_sections = assigned_sections.filter(s => s && s.id != null)

        return {
          id: row.id,
          username: row.username,
          full_name: row.full_name,
          email: row.email,
          assigned_sections
        }
      })

      return res.status(200).json(teachers)
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Teachers handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
