// pages/admin/students.js
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
  InputAdornment,
  Stack
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import axios from 'axios'
import { DataGrid } from '@mui/x-data-grid'
import debounce from 'lodash.debounce'
import { saveAs } from 'file-saver'

export default function StudentsPage() {
  const { data: session, status } = useSession()
  const [students, setStudents] = useState([])
  const [grades, setGrades] = useState([])
  const [sectionsAll, setSectionsAll] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  // filters & paging
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('') // '' = All grades
  const [sectionFilter, setSectionFilter] = useState('') // '' = All sections
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  // role-aware: teacher info
  const [me, setMe] = useState(null) // { user, teacher: { assigned_sections: [...] } }

  // dialog (add/edit)
  const [open, setOpen] = useState(false)
  const emptyForm = { id: null, first_name: '', last_name: '', lrn: '', grade_id: '', section_id: '', parents: [] }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  // load user info and static lists
  useEffect(() => {
    fetchMyInfo()
    fetchGrades()
    fetchSectionsAll()
  }, [])

  useEffect(() => {
    fetchStudents()
  }, [page, pageSize])

  // fetch current user + assigned sections (if teacher)
  const fetchMyInfo = async () => {
    try {
      const res = await axios.get('/api/teachers/me')
      setMe(res.data) // { user, teacher }
      // If user is a teacher and has assigned sections: set filters to limit listing
      if (res.data?.teacher?.assigned_sections) {
        const assigned = res.data.teacher.assigned_sections
        if (assigned.length === 1) {
          // single assigned section -> constrain filters to that
          setGradeFilter(String(assigned[0].grade_id ?? ''))
          setSectionFilter(String(assigned[0].id ?? ''))
        } else if (assigned.length > 1) {
          // multiple assigned sections -> default to showing all of those sections (no global filter)
          // We'll keep filters empty but keep assigned list for UI restriction later
        }
      }
    } catch (err) {
      console.error('Failed to fetch my info', err)
    }
  }

  const fetchGrades = async () => {
    try {
      const res = await axios.get('/api/grades')
      setGrades(res.data ?? [])
    } catch (err) {
      console.error('Failed to load grades', err)
    }
  }

  // Fetch all non-deleted sections (for filters & student assignment)
  const fetchSectionsAll = async () => {
    try {
      const res = await axios.get('/api/sections', { params: { page: 1, page_size: 1000 } })
      const list = res.data?.sections ?? res.data ?? []
      setSectionsAll(
        list.map(s => ({
          id: s.id,
          name: s.section_name ?? s.name ?? '',
          grade_id: s.grade_id ?? s.gradeId,
          grade_name: s.grade_name ?? s.gradeName
        }))
      )
    } catch (err) {
      console.error('Failed to load sections', err)
    }
  }

  // Build query params for listing students, always ensure teacher restrictions are applied client-side too
  const buildListParams = (overrides = {}) => {
    // If current user is a teacher and they have assigned_sections, limit values returned
    const params = {}

    // base filters: prefer overrides, else current state
    const searchVal = overrides.search ?? search
    const gradeVal = overrides.grade ?? gradeFilter
    const sectionVal = overrides.section ?? sectionFilter

    if (searchVal) params.search = searchVal
    if (gradeVal) params.grade_id = gradeVal
    if (sectionVal) params.section_id = sectionVal

    // If user is teacher with assigned_sections:
    if (me?.teacher?.assigned_sections) {
      const assigned = me.teacher.assigned_sections
      if (assigned.length === 1) {
        // enforce single assigned section
        params.section_id = String(assigned[0].id)
        params.grade_id = String(assigned[0].grade_id)
      } else if (assigned.length > 1) {
        // teacher with multiple sections: if section filter is empty, do nothing (server must restrict)
        // but to be safe, you could send a list of allowed section_ids as CSV param
        // (server currently restricts teacher to only their sections; this is an optional enhancement)
        // For now, we leave params as-is so teacher can pick which of their sections to filter by.
      }
    }

    // pagination
    params.page = (overrides.page ?? page) + 1
    params.page_size = overrides.pageSize ?? pageSize

    return params
  }

  const fetchStudents = async (opts = {}) => {
    setLoading(true)
    try {
      const params = buildListParams(opts)

      // remove empty entries
      Object.keys(params).forEach(k => {
        if (params[k] === '' || params[k] == null) delete params[k]
      })
      const res = await axios.get('/api/students', { params })
      setStudents(res.data.students ?? [])
      setTotal(res.data.total ?? 0)
    } catch (err) {
      console.error('Failed to fetch students', err)
    } finally {
      setLoading(false)
    }
  }

  // search debounced
  const debouncedSearch = useCallback(
    debounce(v => {
      setPage(0)
      fetchStudents({ search: v, page: 0 })
    }, 400),
    [me, gradeFilter, sectionFilter]
  )

  const onSearchChange = e => {
    const v = e.target.value
    setSearch(v)
    debouncedSearch(v)
  }

  // Filter interactions (admins vs teachers)
  const onGradeFilterChange = value => {
    // If teacher with single assigned section, ignore changes (disabled in UI)
    if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length === 1) return

    setGradeFilter(value)
    setSectionFilter('') // when grade changes, reset section to All
    setPage(0)
    fetchStudents({ grade: value, section: '', page: 0 })
  }

  const onSectionFilterChange = value => {
    // If teacher with single assigned section, ignore changes (disabled in UI)
    if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length === 1) return

    if (!value) {
      setSectionFilter('')
      setPage(0)
      fetchStudents({ page: 0 })

      return
    }
    const sec = sectionsAll.find(s => String(s.id) === String(value))
    if (sec) {
      setSectionFilter(value)
      setGradeFilter(String(sec.grade_id ?? ''))
      setPage(0)
      fetchStudents({ section: value, grade: String(sec.grade_id ?? ''), page: 0 })
    } else {
      setSectionFilter(value)
      setPage(0)
      fetchStudents({ section: value, page: 0 })
    }
  }

  // Open create/edit dialog
  const openCreate = () => {
    const newForm = { ...emptyForm }

    // If teacher with single assigned section, prefill and lock grade/section
    if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length === 1) {
      const a = me.teacher.assigned_sections[0]
      newForm.grade_id = String(a.grade_id)
      newForm.section_id = String(a.id)
    }
    setForm(newForm)
    setOpen(true)
  }

  const openEdit = async row => {
    try {
      const res = await axios.get(`/api/students/${row.id}`)
      const stu = res.data

      const newForm = {
        id: stu.id,
        first_name: stu.first_name,
        last_name: stu.last_name,
        lrn: stu.lrn,
        grade_id: String(stu.grade_id ?? ''),
        section_id: String(stu.section_id ?? ''),
        parents: stu.parents ?? []
      }

      // If teacher with single assigned section, override form grade/section just in case
      if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length === 1) {
        const a = me.teacher.assigned_sections[0]
        newForm.grade_id = String(a.grade_id)
        newForm.section_id = String(a.id)
      }
      setForm(newForm)
      setOpen(true)
    } catch (err) {
      console.error('Failed to load student', err)
      alert('Failed to load student data')
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      // For teachers with assigned section(s), enforce grade/section values in request
      const payload = { ...form }
      if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length === 1) {
        const a = me.teacher.assigned_sections[0]
        payload.grade_id = String(a.grade_id)
        payload.section_id = String(a.id)
      }
      if (form.id) {
        await axios.put(`/api/students/${form.id}`, payload)
      } else {
        await axios.post('/api/students', payload)
      }
      setOpen(false)
      fetchStudents({ page: 0 })
      fetchSectionsAll()
    } catch (err) {
      console.error('Save failed', err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async id => {
    if (!confirm('Soft-delete this student?')) return
    try {
      await axios.delete(`/api/students/${id}`)
      fetchStudents({ page: 0 })
    } catch (err) {
      console.error('Delete failed', err)
      alert(err?.response?.data?.message ?? 'Delete failed')
    }
  }

  // parents handlers
  const addParentRow = () =>
    setForm(prev => ({
      ...prev,
      parents: [...prev.parents, { first_name: '', last_name: '', contact_info: '', relation: '' }]
    }))

  const updateParent = (idx, key, value) =>
    setForm(prev => {
      const ps = [...prev.parents]
      ps[idx] = { ...ps[idx], [key]: value }

      return { ...prev, parents: ps }
    })
  const removeParentRow = idx => setForm(prev => ({ ...prev, parents: prev.parents.filter((_, i) => i !== idx) }))

  // Export (honor teacher filters)
  const exportStudents = async (format = 'csv') => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      params.set('format', format)

      // build params same as list
      const built = buildListParams({})
      if (built.grade_id) params.set('grade_id', built.grade_id)
      if (built.section_id) params.set('section_id', built.section_id)
      if (built.search) params.set('search', built.search)

      const res = await axios.get(`/api/export/students?${params.toString()}`, { responseType: 'blob' })
      const cd = res.headers['content-disposition'] || ''
      const m = cd.match(/filename="?([^"]+)"?/)
      const filename = m ? m[1] : `students_export.${format === 'xlsx' ? 'xlsx' : 'csv'}`
      saveAs(res.data, filename)
    } catch (err) {
      console.error('Export failed', err)
      alert(err?.response?.data?.message ?? 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const columns = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'lrn', headerName: 'LRN', width: 140 },
    { field: 'last_name', headerName: 'Last name', flex: 1 },
    { field: 'first_name', headerName: 'First name', flex: 1 },
    { field: 'grade_name', headerName: 'Grade', width: 120 },
    { field: 'section_name', headerName: 'Section', width: 160 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      renderCell: params => (
        <Stack direction='row' spacing={1}>
          <Tooltip title='Edit'>
            <IconButton size='small' onClick={() => openEdit(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Delete'>
            <IconButton size='small' color='error' onClick={() => remove(params.row.id)}>
              <DeleteIcon fontSize='small' />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    }
  ]

  // UI state helpers
  const isTeacher = session?.user?.role === 'teacher'
  const teacherAssignedSections = me?.teacher?.assigned_sections ?? []

  // If teacher has exactly 1 assigned section, show that grade/section as fixed (disabled)
  const teacherHasSingleSection = isTeacher && teacherAssignedSections.length === 1

  return (
    <Box p={3}>
      <Box display='flex' gap={2} alignItems='center' mb={2} flexWrap='wrap'>
        <TextField
          size='small'
          placeholder='Search student name / LRN'
          value={search}
          onChange={onSearchChange}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <SearchIcon />
              </InputAdornment>
            )
          }}
          sx={{ minWidth: 320 }}
        />

        {/* Grade filter: admins can change. Teachers either have it disabled (single section) or it auto-selects */}
        <TextField
          select
          size='small'
          label='Grade'
          value={gradeFilter}
          onChange={e => onGradeFilterChange(e.target.value)}
          sx={{ minWidth: 160 }}
          disabled={teacherHasSingleSection}
        >
          <MenuItem value=''>All Grades</MenuItem>
          {grades.map(g => (
            <MenuItem key={g.id} value={String(g.id)}>
              {g.name}
            </MenuItem>
          ))}
        </TextField>

        {/* Section filter: admins can pick any, teachers limited to assigned sections */}
        <TextField
          select
          size='small'
          label='Section'
          value={sectionFilter}
          onChange={e => onSectionFilterChange(e.target.value)}
          sx={{ minWidth: 200 }}
          disabled={teacherHasSingleSection}
        >
          <MenuItem value=''>All Sections</MenuItem>

          {isTeacher
            ? // teacher sees only their assigned sections in the filter list (or all if admin)
              teacherAssignedSections.map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.name}
                </MenuItem>
              ))
            : // admins see all sections
              sectionsAll
                .filter(s => !gradeFilter || String(s.grade_id) === String(gradeFilter))
                .map(s => (
                  <MenuItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </MenuItem>
                ))}
        </TextField>

        <Box sx={{ flexGrow: 1 }} />

        <Button variant='outlined' onClick={() => exportStudents('csv')} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </Button>
        <Button variant='outlined' onClick={() => exportStudents('xlsx')} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export XLSX'}
        </Button>
        <Button startIcon={<AddIcon />} variant='contained' onClick={openCreate}>
          Add Student
        </Button>
      </Box>

      <div style={{ width: '100%' }}>
        <DataGrid
          rows={students}
          columns={columns}
          autoHeight
          pageSize={pageSize}
          rowsPerPageOptions={[10, 25, 50]}
          paginationMode='server'
          rowCount={total}
          page={page}
          onPageChange={newPage => {
            setPage(newPage)
            fetchStudents({ page: newPage })
          }}
          onPageSizeChange={newSize => {
            setPageSize(newSize)
            setPage(0)
            fetchStudents({ page: 0, pageSize: newSize })
          }}
          getRowId={r => r.id}
          loading={loading}
        />
      </div>

      {/* Student Dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='md'>
        <DialogTitle>{form.id ? 'Edit Student' : 'Add Student'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Box display='flex' gap={2}>
            <TextField
              label='First name'
              value={form.first_name}
              onChange={e => setForm({ ...form, first_name: e.target.value })}
              fullWidth
            />
            <TextField
              label='Last name'
              value={form.last_name}
              onChange={e => setForm({ ...form, last_name: e.target.value })}
              fullWidth
            />
            <TextField
              label='LRN'
              value={form.lrn}
              onChange={e => setForm({ ...form, lrn: e.target.value })}
              fullWidth
            />
          </Box>

          <Box display='flex' gap={2}>
            {/* Grade input: disabled for teachers with single section */}
            <TextField
              select
              label='Grade'
              value={form.grade_id}
              onChange={e => setForm({ ...form, grade_id: e.target.value, section_id: '' })}
              fullWidth
              disabled={teacherHasSingleSection}
            >
              <MenuItem value=''>-- Select Grade --</MenuItem>
              {grades.map(g => (
                <MenuItem key={g.id} value={String(g.id)}>
                  {g.name}
                </MenuItem>
              ))}
            </TextField>

            {/* Section input: if teacher with single section, prefilled and disabled.
                If teacher with many sections, only show their assigned sections.
                If admin, show all sections for selected grade. */}
            <TextField
              select
              label='Section'
              value={form.section_id}
              onChange={e => setForm({ ...form, section_id: e.target.value })}
              disabled={teacherHasSingleSection}
              fullWidth
            >
              <MenuItem value=''>-- Select Section --</MenuItem>

              {isTeacher
                ? // teacher allowed sections (if multiple)
                  teacherAssignedSections.length > 0
                  ? teacherAssignedSections
                      .filter(s => !form.grade_id || String(s.grade_id) === String(form.grade_id))
                      .map(s => (
                        <MenuItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </MenuItem>
                      ))
                  : []
                : // admins: show all non-deleted sections for the selected grade
                  sectionsAll
                    .filter(s => !form.grade_id || String(s.grade_id) === String(form.grade_id))
                    .map(s => (
                      <MenuItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </MenuItem>
                    ))}
            </TextField>
          </Box>

          <Box>
            <Box display='flex' justifyContent='space-between' alignItems='center'>
              <strong>Parents</strong>
              <Button size='small' onClick={addParentRow}>
                Add Parent
              </Button>
            </Box>

            <Box mt={1} display='flex' flexDirection='column' gap={1}>
              {form.parents.map((p, idx) => (
                <Box key={idx} display='flex' gap={1} alignItems='center'>
                  <TextField
                    label='First name'
                    value={p.first_name}
                    onChange={e => updateParent(idx, 'first_name', e.target.value)}
                  />
                  <TextField
                    label='Last name'
                    value={p.last_name}
                    onChange={e => updateParent(idx, 'last_name', e.target.value)}
                  />
                  <TextField
                    label='Contact info'
                    value={p.contact_info}
                    onChange={e => updateParent(idx, 'contact_info', e.target.value)}
                  />
                  <TextField
                    label='Relation'
                    value={p.relation || ''}
                    onChange={e => updateParent(idx, 'relation', e.target.value)}
                  />
                  <Button color='error' onClick={() => removeParentRow(idx)}>
                    Remove
                  </Button>
                </Box>
              ))}
            </Box>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

StudentsPage.acl = { action: 'read', subject: 'students-page' }
