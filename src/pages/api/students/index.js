// pages/api/students/index.js
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import db from '../db'

export default async function handler(req, res) {
  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

    if (req.method === 'GET') {
      // Filters: search, lrn, grade_id, section_id, page, page_size
      const { search = '', lrn = '', grade_id = '', section_id = '', page = 1, page_size = 25 } = req.query
      const limit = Math.max(1, Math.min(1000, Number(page_size) || 25))
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit

      const where = ['st.is_deleted = 0']
      const params = []

      if (grade_id) {
        where.push('st.grade_id = ?')
        params.push(grade_id)
      }
      if (section_id) {
        where.push('st.section_id = ?')
        params.push(section_id)
      }
      if (lrn) {
        where.push('st.lrn = ?')
        params.push(lrn)
      }
      if (search) {
        where.push('(st.first_name LIKE ? OR st.last_name LIKE ? OR CONCAT(st.first_name," ",st.last_name) LIKE ?)')
        params.push(`%${search}%`, `%${search}%`, `%${search}%`)
      }

      // If teacher, restrict to their sections
      if (session.user.role === 'teacher') {
        where.push('st.section_id IN (SELECT section_id FROM teacher_sections WHERE user_id = ?)')
        params.push(session.user.id)
      }

      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

      const countSql = `SELECT COUNT(*) AS total FROM students st ${whereSql}`
      const [countRows] = await db.query(countSql, params)
      const total = countRows[0]?.total ?? 0

      const sql = `
        SELECT st.id, st.first_name, st.last_name, st.lrn, st.grade_id, st.section_id, g.name AS grade_name, s.name AS section_name
        FROM students st
        LEFT JOIN grades g ON g.id = st.grade_id
        LEFT JOIN sections s ON s.id = st.section_id
        ${whereSql}
        ORDER BY st.last_name, st.first_name
        LIMIT ? OFFSET ?
      `
      const finalParams = [...params, limit, offset]
      const [rows] = await db.query(sql, finalParams)

      return res.status(200).json({ total, page: Number(page), page_size: limit, students: rows })
    }

    if (req.method === 'POST') {
      // create student with parents
      const { first_name, last_name, lrn, grade_id, section_id, parents = [] } = req.body
      if (!first_name || !last_name || !lrn || !grade_id || !section_id) {
        return res.status(400).json({ message: 'Missing required fields' })
      }

      // verify section exists & grade match
      const [secRows] = await db.query('SELECT id, grade_id FROM sections WHERE id = ? AND is_deleted = 0 LIMIT 1', [
        section_id
      ])
      if (!secRows.length) return res.status(400).json({ message: 'Section not found or deleted' })
      if (String(secRows[0].grade_id) !== String(grade_id))
        return res.status(400).json({ message: 'Section does not belong to grade' })

      // teachers can only create students for their assigned sections
      if (session.user.role === 'teacher') {
        const [ok] = await db.query('SELECT 1 FROM teacher_sections WHERE user_id = ? AND section_id = ? LIMIT 1', [
          session.user.id,
          section_id
        ])
        if (!ok.length) return res.status(403).json({ message: 'Forbidden: cannot add students to this section' })
      }

      // LRN unique check
      const [lrnCheck] = await db.query('SELECT id FROM students WHERE lrn = ? AND is_deleted = 0 LIMIT 1', [lrn])
      if (lrnCheck.length) return res.status(409).json({ message: 'LRN already exists' })

      let conn
      try {
        conn = await db.getConnection()
        await conn.beginTransaction()

        const [ins] = await conn.query(
          'INSERT INTO students (first_name, last_name, lrn, grade_id, section_id, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())',
          [first_name, last_name, lrn, grade_id, section_id]
        )
        const studentId = ins.insertId

        // handle parents array (if parent.id exists use it, else create)
        for (const p of parents) {
          if (p.id) {
            // ensure parent exists and not deleted
            const [prow] = await conn.query('SELECT id FROM parents WHERE id = ? AND is_deleted = 0 LIMIT 1', [p.id])
            if (!prow.length) {
              await conn.rollback()

              return res.status(400).json({ message: `Parent id ${p.id} not found` })
            }
            await conn.query('INSERT IGNORE INTO student_parents (student_id, parent_id, relation) VALUES (?, ?, ?)', [
              studentId,
              p.id,
              p.relation || null
            ])
          } else {
            const [newP] = await conn.query(
              'INSERT INTO parents (first_name, last_name, contact_info, is_deleted, created_at, updated_at) VALUES (?, ?, ?, 0, NOW(), NOW())',
              [p.first_name, p.last_name, p.contact_info || null]
            )
            await conn.query('INSERT INTO student_parents (student_id, parent_id, relation) VALUES (?, ?, ?)', [
              studentId,
              newP.insertId,
              p.relation || null
            ])
          }
        }

        await conn.commit()
        conn.release()

        return res.status(201).json({ id: studentId })
      } catch (err) {
        if (conn) {
          await conn.rollback().catch(() => {})
          conn.release().catch(() => {})
        }
        console.error('Create student error', err)
        if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Duplicate entry' })

        return res.status(500).json({ message: 'Internal server error' })
      }
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    console.error('Students index handler error:', err)

    return res.status(500).json({ message: 'Internal server error' })
  }
}
