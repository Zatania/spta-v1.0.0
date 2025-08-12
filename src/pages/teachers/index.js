// pages/admin/sections.js
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

export default function SectionsPage() {
  const [sections, setSections] = useState([])
  const [grades, setGrades] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  // filters & paging
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('') // '' means All Grades
  const [assignedFilter, setAssignedFilter] = useState('') // '' means All

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  // modal
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ id: null, grade_id: '', name: '' })
  const [saving, setSaving] = useState(false)

  // load grades on mount
  useEffect(() => {
    fetchGrades()
  }, [])

  useEffect(() => {
    fetchSections()
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

  const fetchSections = async (opts = {}) => {
    setLoading(true)
    try {
      const params = {
        search: opts.search ?? search,
        grade_id: opts.gradeFilter ?? gradeFilter,
        assigned: opts.assignedFilter ?? assignedFilter,
        page: (opts.page ?? page) + 1,
        page_size: opts.pageSize ?? pageSize
      }
      Object.keys(params).forEach(k => {
        if (params[k] === '' || params[k] == null) delete params[k]
      })
      const res = await axios.get('/api/sections', { params })
      setSections(res.data.sections ?? [])
      setTotal(res.data.total ?? 0)
    } catch (err) {
      console.error('Failed to fetch sections', err)
    } finally {
      setLoading(false)
    }
  }

  // ----------- search debounce -----------
  const debouncedSearch = useCallback(
    debounce(v => {
      setPage(0)
      fetchSections({ search: v, page: 0 })
    }, 400),
    []
  )

  const onSearchChange = e => {
    const v = e.target.value
    setSearch(v)
    debouncedSearch(v)
  }

  // ----------- filter interactions -----------
  const onGradeFilterChange = value => {
    setGradeFilter(value)
    setPage(0)
    fetchSections({ gradeFilter: value, page: 0 })
  }

  const onAssignedFilterChange = value => {
    setAssignedFilter(value)
    setPage(0)
    fetchSections({ assignedFilter: value, page: 0 })
  }

  // ----------- modal actions -----------
  const handleOpen = (row = null) => {
    if (row) {
      setForm({ id: row.id, grade_id: row.grade_id, name: row.section_name })
    } else {
      setForm({ id: null, grade_id: '', name: '' })
    }
    setOpen(true)
  }

  const handleClose = () => setOpen(false)

  const handleSave = async () => {
    if (!form.grade_id || !form.name) return
    setSaving(true)
    try {
      if (form.id) {
        await axios.put(`/api/sections/${form.id}`, { grade_id: form.grade_id, name: form.name })
      } else {
        await axios.post('/api/sections', { grade_id: form.grade_id, name: form.name })
      }
      setOpen(false)
      fetchSections({ page: 0 })
    } catch (err) {
      console.error('Save failed', err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async id => {
    if (!confirm('Soft-delete this section?')) return
    try {
      await axios.delete(`/api/sections/${id}`)
      fetchSections({ page: 0 })
    } catch (err) {
      console.error('Delete failed', err)
      alert(err?.response?.data?.message ?? 'Delete failed')
    }
  }

  // ----------- columns -----------
  const columns = [
    { field: 'grade_name', headerName: 'Grade', flex: 1, minWidth: 140 },
    { field: 'section_name', headerName: 'Section', flex: 1.5, minWidth: 160 },
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
          placeholder='Search'
          value={search}
          onChange={onSearchChange}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <SearchIcon />
              </InputAdornment>
            )
          }}
          sx={{ minWidth: 280 }}
        />

        <TextField
          select
          size='small'
          label='Grade'
          value={gradeFilter}
          onChange={e => onGradeFilterChange(e.target.value)}
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
          label='Assigned'
          value={assignedFilter}
          onChange={e => onAssignedFilterChange(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value=''>All</MenuItem>
          <MenuItem value='1'>Assigned</MenuItem>
          <MenuItem value='0'>Unassigned</MenuItem>
        </TextField>

        <Box sx={{ flexGrow: 1 }} />
        <Button startIcon={<AddIcon />} variant='contained' onClick={() => handleOpen()}>
          Add Section
        </Button>
      </Box>

      <div style={{ width: '100%' }}>
        <DataGrid
          rows={sections}
          columns={columns}
          autoHeight
          pageSize={pageSize}
          rowsPerPageOptions={[10, 25, 50]}
          paginationMode='server'
          onPageChange={newPage => {
            setPage(newPage)
            fetchSections({ page: newPage })
          }}
          onPageSizeChange={newSize => {
            setPageSize(newSize)
            setPage(0)
            fetchSections({ page: 0, pageSize: newSize })
          }}
          page={page}
          rowCount={total}
          getRowId={r => r.id}
          loading={loading}
          sx={{
            '& .MuiDataGrid-cell': {
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }
          }}
        />
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
        <DialogTitle>{form.id ? 'Edit Section' : 'Add Section'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            select
            label='Grade'
            value={form.grade_id}
            onChange={e => setForm({ ...form, grade_id: e.target.value })}
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
            label='Section Name'
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            fullWidth
          />
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
