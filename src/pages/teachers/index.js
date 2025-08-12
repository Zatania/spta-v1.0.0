// pages/admin/teachers.js
import { useEffect, useState, useCallback } from 'react'
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
  InputAdornment
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import { DataGrid } from '@mui/x-data-grid'
import axios from 'axios'
import debounce from 'lodash.debounce'

export default function TeachersPage() {
  const [teachers, setTeachers] = useState([])
  const [grades, setGrades] = useState([])
  const [sectionsAll, setSectionsAll] = useState([]) // full sections list used for filters
  const [sectionsForAssign, setSectionsForAssign] = useState([]) // available sections for assign modal
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  // filters & paging
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('') // '' means All Grades
  const [sectionFilter, setSectionFilter] = useState('') // '' means All Sections

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  // modal
  const [open, setOpen] = useState(false)

  const [form, setForm] = useState({
    id: null,
    full_name: '',
    email: '',
    username: '',
    password: '',
    grade_id: '',
    section_id: ''
  })
  const [saving, setSaving] = useState(false)

  // load grades + full sections for filters on mount
  useEffect(() => {
    fetchGrades()
    fetchSectionsAll()
  }, [])

  useEffect(() => {
    fetchTeachers() // initial fetch and when page/pageSize changes
  }, [page, pageSize])

  // ----------- API fetchers -----------
  const fetchGrades = async () => {
    try {
      const res = await axios.get('/api/grades')
      setGrades(res.data ?? [])
    } catch (err) {
      console.error('Failed to load grades', err)
    }
  }

  // full non-deleted sections (for filters). Uses /api/sections which returns { sections: [...] } per earlier API
  const fetchSectionsAll = async () => {
    try {
      const res = await axios.get('/api/sections', { params: { page: 1, page_size: 1000 } })

      // res.data.sections expected; fallback to array if API returns flat array
      const list = res.data?.sections ?? res.data ?? []

      // normalize shape: prefer { id, section_name, grade_id, grade_name }
      setSectionsAll(
        list.map(s => ({
          id: s.id,
          name: s.section_name ?? s.name ?? s.sectionName ?? '',
          grade_id: s.grade_id ?? s.gradeId ?? s.gradeId,
          grade_name: s.grade_name ?? s.gradeName ?? s.grade_name
        }))
      )
    } catch (err) {
      console.error('Failed to load sections for filter', err)
    }
  }

  // sections available for assigning to teachers (for modal). context=teacher
  const fetchSectionsForAssign = async (teacherId = null) => {
    try {
      const q = new URLSearchParams()
      q.set('context', 'teacher')
      if (teacherId) q.set('teacher_id', teacherId)
      const res = await axios.get(`/api/sections/available?${q.toString()}`)

      // API returns { sections: [...] } or array; normalize to id/name/grade_id
      const list = res.data?.sections ?? res.data ?? []
      setSectionsForAssign(
        list.map(s => ({
          id: s.id,
          name: s.section_name ?? s.name ?? '',
          grade_id: s.grade_id
        }))
      )
    } catch (err) {
      console.error('Failed to load available sections for assign', err)
      setSectionsForAssign([])
    }
  }

  // fetch teachers list (server-side filters + pagination)
  const fetchTeachers = async (opts = {}) => {
    setLoading(true)
    try {
      const params = {
        search: opts.search ?? search,
        grade_id: opts.gradeFilter ?? gradeFilter,
        section_id: opts.sectionFilter ?? sectionFilter,
        page: (opts.page ?? page) + 1,
        page_size: opts.pageSize ?? pageSize
      }
      Object.keys(params).forEach(k => {
        if (params[k] === '' || params[k] == null) delete params[k]
      })
      const res = await axios.get('/api/teachers', { params })
      setTeachers(res.data.teachers ?? [])
      setTotal(res.data.total ?? 0)
    } catch (err) {
      console.error('Failed to fetch teachers', err)
    } finally {
      setLoading(false)
    }
  }

  // ----------- search debounce -----------
  const debouncedSearch = useCallback(
    debounce(v => {
      setPage(0)
      fetchTeachers({ search: v, page: 0 })
    }, 400),
    []
  )

  const onSearchChange = e => {
    const v = e.target.value
    setSearch(v)
    debouncedSearch(v)
  }

  // ----------- filter interactions -----------
  // When grade changes: reset section filter (All Sections) and fetch teachers for page 0
  const onGradeFilterChange = value => {
    setGradeFilter(value)
    setSectionFilter('') // All Sections when grade changes
    setPage(0)
    fetchTeachers({ gradeFilter: value, sectionFilter: '', page: 0 })
  }

  // When section selected: auto-select grade that matches the chosen section
  const onSectionFilterChange = value => {
    if (!value) {
      // All Sections
      setSectionFilter('')
      setPage(0)
      fetchTeachers({ page: 0 })

      return
    }
    const sec = sectionsAll.find(s => String(s.id) === String(value))
    if (sec) {
      setSectionFilter(value)
      setGradeFilter(String(sec.grade_id ?? ''))
      setPage(0)
      fetchTeachers({ sectionFilter: value, gradeFilter: String(sec.grade_id ?? ''), page: 0 })
    } else {
      // fallback if not found
      setSectionFilter(value)
      setPage(0)
      fetchTeachers({ sectionFilter: value, page: 0 })
    }
  }

  // ----------- modal open/close/save/delete -----------
  const handleOpen = async (row = null) => {
    if (row) {
      setForm({
        id: row.id,
        full_name: row.full_name || '',
        email: row.email || '',
        username: row.username || '',
        password: '',
        grade_id: row.grade_id ?? '',
        section_id: row.section_id ?? ''
      })

      // load available sections for assignment to allow keep/replace
      await fetchSectionsForAssign(row.id)
    } else {
      setForm({ id: null, full_name: '', email: '', username: '', password: '', grade_id: '', section_id: '' })
      await fetchSectionsForAssign()
    }
    setOpen(true)
  }

  const handleClose = () => setOpen(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      if (form.id) {
        await axios.put(`/api/teachers/${form.id}`, form)
      } else {
        await axios.post('/api/teachers', form)
      }
      setOpen(false)
      fetchTeachers({ page: 0 })
      await fetchSectionsAll()
      await fetchSectionsForAssign()
    } catch (err) {
      console.error('Save failed', err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async id => {
    if (!confirm('Soft-delete this teacher?')) return
    try {
      await axios.delete(`/api/teachers/${id}`)
      fetchTeachers({ page: 0 })
      await fetchSectionsAll()
      await fetchSectionsForAssign()
    } catch (err) {
      console.error('Delete failed', err)
      alert(err?.response?.data?.message ?? 'Delete failed')
    }
  }

  // ----------- columns -----------
  const columns = [
    { field: 'full_name', headerName: 'Name', flex: 1, minWidth: 160 },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 200 },
    { field: 'username', headerName: 'Username', flex: 0.8, minWidth: 140 },
    { field: 'grade_name', headerName: 'Grade', flex: 0.6, minWidth: 120 },
    { field: 'section_name', headerName: 'Section', flex: 0.6, minWidth: 140 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      headerAlign: 'center',
      align: 'center',
      renderCell: params => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title='Edit'>
            <IconButton size='small' onClick={() => handleOpen(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Delete'>
            <IconButton size='small' color='error' onClick={() => handleDelete(params.row.id)}>
              <DeleteIcon fontSize='small' />
            </IconButton>
          </Tooltip>
        </Box>
      )
    }
  ]

  return (
    <Box p={3}>
      <Box display='flex' gap={2} alignItems='center' mb={2} flexWrap='wrap'>
        <TextField
          size='small'
          placeholder='Search by name / username / email'
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

        <TextField
          select
          size='small'
          label='Grade'
          value={gradeFilter}
          onChange={e => onGradeFilterChange(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value=''>All Grades</MenuItem>
          {grades.map(g => (
            <MenuItem key={g.id} value={String(g.id)}>
              {g.name}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size='small'
          label='Section'
          value={sectionFilter}
          onChange={e => onSectionFilterChange(e.target.value)}
          sx={{ minWidth: 200 }}
          disabled={!gradeFilter} // only enabled when a grade is selected
        >
          <MenuItem value=''>All Sections</MenuItem>
          {sectionsAll
            .filter(s => !gradeFilter || String(s.grade_id) === String(gradeFilter))
            .map(s => (
              <MenuItem key={s.id} value={String(s.id)}>
                {s.name}
              </MenuItem>
            ))}
        </TextField>

        <Box sx={{ flexGrow: 1 }} />
        <Button startIcon={<AddIcon />} variant='contained' onClick={() => handleOpen()}>
          Add Teacher
        </Button>
      </Box>

      <div style={{ width: '100%' }}>
        <DataGrid
          rows={teachers}
          columns={columns}
          autoHeight
          pageSize={pageSize}
          rowsPerPageOptions={[10, 25, 50]}
          paginationMode='server'
          onPageChange={newPage => {
            setPage(newPage)
            fetchTeachers({ page: newPage })
          }}
          onPageSizeChange={newSize => {
            setPageSize(newSize)
            setPage(0)
            fetchTeachers({ page: 0, pageSize: newSize })
          }}
          page={page}
          rowCount={total}
          getRowId={r => r.id}
          loading={loading}
          sx={{ '& .MuiDataGrid-cell': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
        <DialogTitle>{form.id ? 'Edit Teacher' : 'Add Teacher'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label='Full name'
            value={form.full_name}
            onChange={e => setForm({ ...form, full_name: e.target.value })}
            fullWidth
          />
          <TextField
            label='Email'
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            fullWidth
          />
          <TextField
            label='Username'
            value={form.username}
            onChange={e => setForm({ ...form, username: e.target.value })}
            fullWidth
          />
          <TextField
            type='password'
            label={form.id ? 'Password (leave blank to keep current)' : 'Password'}
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            fullWidth
          />

          <TextField
            select
            label='Grade'
            value={form.grade_id}
            onChange={e => setForm({ ...form, grade_id: e.target.value, section_id: '' })}
            fullWidth
          >
            <MenuItem value=''>-- Select Grade --</MenuItem>
            {grades.map(g => (
              <MenuItem key={g.id} value={String(g.id)}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label='Section'
            value={form.section_id}
            onChange={e => setForm({ ...form, section_id: e.target.value })}
            fullWidth
            disabled={!form.grade_id}
          >
            <MenuItem value=''>-- Select Section --</MenuItem>
            {sectionsForAssign
              .filter(s => !form.grade_id || String(s.grade_id) === String(form.grade_id))
              .map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.name}
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant='contained' onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
