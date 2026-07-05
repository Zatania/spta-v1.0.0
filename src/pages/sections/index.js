import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  MenuItem,
  IconButton,
  Tooltip,
  Alert,
  InputAdornment,
  CircularProgress,
  Chip,
  Stack,
  Typography
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd'
import { DataGrid } from '@mui/x-data-grid'
import axios from 'axios'
import SchoolYearSelect from 'src/components/common/SchoolYearSelect'

export default function SectionsPage() {
  const [schoolYearId, setSchoolYearId] = useState('')
  const [sections, setSections] = useState([])
  const [grades, setGrades] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ id: null, grade_id: '', name: '' })
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [filterGrade, setFilterGrade] = useState('')
  const [filterAssigned, setFilterAssigned] = useState('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [rowCount, setRowCount] = useState(0)

  const fetchSections = async () => {
    if (!schoolYearId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await axios.get('/api/sections', {
        params: {
          school_year_id: schoolYearId,
          search: search || undefined,
          grade_id: filterGrade || undefined,
          assigned: filterAssigned || undefined,
          page: paginationModel.page + 1,
          page_size: paginationModel.pageSize
        }
      })
      setSections(data.sections ?? [])
      setRowCount(data.total ?? 0)
    } catch (err) {
      setError(err?.response?.data?.message ?? 'Failed to load sections')
    } finally {
      setLoading(false)
    }
  }

  const fetchGrades = async () => {
    try {
      const { data } = await axios.get('/api/grades')
      setGrades(data ?? [])
    } catch (err) {
      console.error('Failed to load grades', err)
    }
  }

  useEffect(() => {
    fetchGrades()
  }, [])

  useEffect(() => {
    fetchSections()
  }, [schoolYearId, search, filterGrade, filterAssigned, paginationModel])

  const handleOpen = (row = null) => {
    if (row) setForm({ id: row.id, grade_id: row.grade_id, name: row.section_name })
    else setForm({ id: null, grade_id: '', name: '' })
    setOpen(true)
  }

  const handleSave = async () => {
    if (!form.grade_id || !form.name) return
    setSaving(true)
    try {
      if (form.id) await axios.put(`/api/sections/${form.id}`, { grade_id: form.grade_id, name: form.name })
      else await axios.post('/api/sections', { grade_id: form.grade_id, name: form.name })
      await fetchSections()
      setOpen(false)
    } catch (err) {
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async id => {
    if (!confirm('Soft-delete this section? It will be hidden from lists if no blockers exist.')) return
    try {
      await axios.delete(`/api/sections/${id}`)
      fetchSections()
    } catch (err) {
      alert(err?.response?.data?.message ?? 'Delete failed')
    }
  }

  const columns = [
    { field: 'grade_name', headerName: 'Grade', flex: 0.8, minWidth: 120 },
    { field: 'section_name', headerName: 'Section', flex: 1.2, minWidth: 160 },
    {
      field: 'assigned_teacher',
      headerName: 'Teacher Assignment',
      flex: 1.5,
      minWidth: 220,
      renderCell: params =>
        params.row.assigned_teacher ? (
          <Chip size='small' color='success' label={params.row.assigned_teacher.full_name} />
        ) : (
          <Chip size='small' color='warning' label='Unassigned' />
        )
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 170,
      sortable: false,
      filterable: false,
      renderCell: params => (
        <>
          <Tooltip title='Edit Section Name/Grade'>
            <IconButton size='small' onClick={() => handleOpen(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Manage Teacher Assignment'>
            <IconButton size='small' color='primary' onClick={() => (window.location.href = '/section-assignments')}>
              <AssignmentIndIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Delete'>
            <IconButton size='small' color='error' onClick={() => handleDelete(params.row.id)}>
              <DeleteIcon fontSize='small' />
            </IconButton>
          </Tooltip>
        </>
      )
    }
  ]

  return (
    <Box p={3}>
      <Stack direction='row' justifyContent='space-between' alignItems='center' mb={2} gap={2} flexWrap='wrap'>
        <Box>
          <Typography variant='h5'>Sections</Typography>
          <Typography variant='body2' color='text.secondary'>
            Sections can exist even when no teacher is currently assigned.
          </Typography>
        </Box>
        <Button startIcon={<AddIcon />} variant='contained' onClick={() => handleOpen()}>
          Add Section
        </Button>
      </Stack>

      <Stack direction='row' gap={2} alignItems='center' mb={2} flexWrap='wrap'>
        <SchoolYearSelect value={schoolYearId} onChange={setSchoolYearId} />
        <TextField
          size='small'
          placeholder='Search section, grade, or teacher'
          value={search}
          onChange={e => {
            setPaginationModel({ ...paginationModel, page: 0 })
            setSearch(e.target.value)
          }}
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
          value={filterGrade}
          onChange={e => {
            setPaginationModel({ ...paginationModel, page: 0 })
            setFilterGrade(e.target.value)
          }}
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
          label='Teacher Status'
          value={filterAssigned}
          onChange={e => {
            setPaginationModel({ ...paginationModel, page: 0 })
            setFilterAssigned(e.target.value)
          }}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value=''>All</MenuItem>
          <MenuItem value='1'>Assigned</MenuItem>
          <MenuItem value='0'>Unassigned</MenuItem>
        </TextField>
      </Stack>

      {loading ? (
        <Box display='flex' justifyContent='center' p={4}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity='error'>{error}</Alert>
      ) : (
        <DataGrid
          rows={sections}
          columns={columns}
          autoHeight
          rowCount={rowCount}
          paginationMode='server'
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50]}
          getRowId={r => r.id}
        />
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{form.id ? 'Edit Section' : 'Add Section'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Alert severity='info'>Teacher assignment is managed on the Section Assignments page.</Alert>
          <TextField select label='Grade' value={form.grade_id} onChange={e => setForm({ ...form, grade_id: e.target.value })}>
            <MenuItem value=''>-- Select Grade --</MenuItem>
            {grades.map(g => (
              <MenuItem key={g.id} value={String(g.id)}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField label='Section Name' value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
