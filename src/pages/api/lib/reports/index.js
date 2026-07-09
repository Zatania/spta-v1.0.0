export function parseParentIds(raw) {
  return String(raw || '')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => Number.isInteger(v) && v > 0)
}

export function parentExistsFilter(parentIds, studentAlias = 'st') {
  if (!parentIds.length) return { sql: '', params: [] }

  return {
    sql: `AND EXISTS (
      SELECT 1
        FROM student_parents sp_filter
       WHERE sp_filter.student_id = ${studentAlias}.id
         AND sp_filter.parent_id IN (${parentIds.map(() => '?').join(',')})
    )`,
    params: parentIds
  }
}

export function activeTeacherSectionFilter(session, syId, sectionAlias = 'aa') {
  if (session?.user?.role !== 'teacher') return { sql: '', params: [] }

  return {
    sql: `AND ${sectionAlias}.section_id IN (
      SELECT section_id
        FROM teacher_sections
       WHERE user_id = ?
         AND school_year_id = ?
         AND is_active = 1
    )`,
    params: [session.user.id, syId]
  }
}

export function csvCell(value) {
  if (value == null) return ''
  const text = String(value)
  return text.includes(',') || text.includes('"') || text.includes('\n') ? `"${text.replace(/"/g, '""')}"` : text
}
