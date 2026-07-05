import { useEffect, useState } from 'react'
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
  Chip,
  Alert,
  Stack,
  Typography,
  InputAdornment
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import PersonRemoveIcon from '@mui/icons-material/PersonRemove'
import SearchIcon from '@mui/icons-material/Search'
import axios from 'axios'
import SchoolYearSelect from 'src/components/common/SchoolYearSelect'

export default function SectionAssignmentsPage() {
  const [schoolYearId, setSchoolYearId] = useState('')
  const [grades, setGrades] = useState([])
  const [teachers, setTeachers] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [assigned, setAssigned] = useState('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 })
  const [rowCount, setRowCount] = useState(0)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedSection, setSelectedSection] = useState(null)
  const [selectedTeacherId, setSelectedTeacherId] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchGrades = async () => {
    try {
      const { data } = await axios.get('/api/grades')
      setGrades(data || [])
    } catch (err) {
      console.error('Failed to load grades', err)
    }
  }

  const fetchTeachers = async () => {
    try {
      const { data } = await axios.get('/api/teachers', {
        params: { school_year_id: schoolYearId || undefined, page_size: 1000 }
      })
      setTeachers(data?.teachers || [])
    } catch (err) {
      console.error('Failed to load teachers', err)
    }
  }

  const fetchAssignments = async () => {
    if (!schoolYearId) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get('/api/teacher-section-assignments', {
        params: {
          school_year_id: schoolYearId,
          search: search || undefined,
          grade_id: gradeId || undefined,
          assigned: assigned || undefined,
          page: paginationModel.page + 1,
          page_size: paginationModel.pageSize
        }
      })
      setRows(data?.assignments || [])
      setRowCount(data?.total || 0)
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load section assignments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGrades()
  }, [])

  useEffect(() => {
    fetchTeachers()
    fetchAssignments()
  }, [schoolYearId])

  useEffect(() => {
    fetchAssignments()
  }, [search, gradeId, assigned, paginationModel])

  const openAssign = row => {
    setSelectedSection(row)
    setSelectedTeacherId(row.teacher_id ? String(row.teacher_id) : '')
    setDialogOpen(true)
  }

  const saveAssignment = async () => {
    if (!selectedSection || !selectedTeacherId) {
      alert('Select a teacher.')

      return
    }

    setSaving(true)
    try {
      await axios.post('/api/teacher-section-assignments', {
        school_year_id: schoolYearId,
        section_id: selectedSection.section_id,
        teacher_id: selectedTeacherId
      })
      setDialogOpen(false)
      await fetchTeachers()
      await fetchAssignments()
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to assign teacher')
    } finally {
      setSaving(false)
    }
  }

  const unassign = async row => {
    if (!row.assignment_id) return
    if (!confirm(`Remove ${row.teacher_name} from ${row.grade_name} - ${row.section_name}?`)) return

    try {
      await axios.delete(`/api/teacher-section-assignments/${row.assignment_id}`)
      await fetchTeachers()
      await fetchAssignments()
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to unassign teacher')
    }
  }

  const columns = [
    { field: 'grade_name', headerName: 'Grade', width: 130 },
    { field: 'section_name', headerName: 'Section', flex: 1, minWidth: 160 },
    {
      field: 'teacher_name',
      headerName: 'Assigned Teacher',
      flex: 1.2,
      minWidth: 220,
      renderCell: params =>
        params.row.teacher_id ? (
          <Chip size='small' color='success' label={params.row.teacher_name} />
        ) : (
          <Chip size='small' color='warning' label='Unassigned' />
        )
    },
    { field: 'assigned_at', headerName: 'Assigned At', width: 170 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 150,
      sortable: false,
      renderCell: params => (
        <Box>
          <Tooltip title={params.row.teacher_id ? 'Reassign Teacher' : 'Assign Teacher'}>
            <IconButton size='small' color='primary' onClick={() => openAssign(params.row)}>
              <PersonAddIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          {params.row.teacher_id && (
            <Tooltip title='Unassign Teacher'>
              <IconButton size='small' color='error' onClick={() => unassign(params.row)}>
                <PersonRemoveIcon fontSize='small' />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )
    }
  ]

  return (
    <Box p={3}>
      <Stack direction='row' justifyContent='space-between' alignItems='center' mb={2} gap={2} flexWrap='wrap'>
        <Box>
          <Typography variant='h5'>Section Assignments</Typography>
          <Typography variant='body2' color='text.secondary'>
            Assign, reassign, or temporarily leave sections without teachers per school year.
          </Typography>
        </Box>
      </Stack>

      <Stack direction='row' gap={2} mb={2} flexWrap='wrap'>
        <SchoolYearSelect value={schoolYearId} onChange={setSchoolYearId} />
        <TextField
          size='small'
          placeholder='Search section or teacher'
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
          value={gradeId}
          onChange={e => {
            setPaginationModel({ ...paginationModel, page: 0 })
            setGradeId(e.target.value)
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
          label='Assignment Status'
          value={assigned}
          onChange={e => {
            setPaginationModel({ ...paginationModel, page: 0 })
            setAssigned(e.target.value)
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value=''>All</MenuItem>
          <MenuItem value='1'>Assigned</MenuItem>
          <MenuItem value='0'>Unassigned</MenuItem>
        </TextField>
      </Stack>

      {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

      <DataGrid
        rows={rows}
        columns={columns}
        autoHeight
        loading={loading}
        getRowId={row => row.section_id}
        rowCount={rowCount}
        paginationMode='server'
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[10, 25, 50, 100]}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{selectedSection?.teacher_id ? 'Reassign Teacher' : 'Assign Teacher'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Alert severity='info'>
            Section: <strong>{selectedSection?.grade_name} - {selectedSection?.section_name}</strong>. If the selected teacher is already assigned to another section in this school year, the old assignment will be removed.
          </Alert>
          <TextField
            select
            label='Teacher'
            value={selectedTeacherId}
            onChange={e => setSelectedTeacherId(e.target.value)}
            fullWidth
          >
            <MenuItem value=''>-- Select Teacher --</MenuItem>
            {teachers.map(t => (
              <MenuItem key={t.id} value={String(t.id)}>
                {t.full_name} {t.section_name ? `(currently: ${t.grade_name} - ${t.section_name})` : '(unassigned)'}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={saveAssignment} disabled={saving}>
            {saving ? 'Saving...' : 'Save Assignment'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
