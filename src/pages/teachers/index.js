import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
  InputAdornment,
  Stack,
  Chip,
  Typography,
  Alert,
  MenuItem
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import SearchIcon from '@mui/icons-material/Search'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import axios from 'axios'
import SchoolYearSelect from 'src/components/common/SchoolYearSelect'

const emptyForm = { id: null, full_name: '', email: '', username: '', password: '' }

export default function TeachersPage() {
  const [schoolYearId, setSchoolYearId] = useState('')
  const [teachers, setTeachers] = useState([])
  const [grades, setGrades] = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)

  const [search, setSearch] = useState('')
  const [assignment, setAssignment] = useState('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 })

  const [profileOpen, setProfileOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [savingProfile, setSavingProfile] = useState(false)

  const [assignOpen, setAssignOpen] = useState(false)
  const [selectedTeacher, setSelectedTeacher] = useState(null)
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [savingAssignment, setSavingAssignment] = useState(false)

  const fetchGrades = async () => {
    try {
      const { data } = await axios.get('/api/grades')
      setGrades(data || [])
    } catch (err) {
      console.error('Failed to load grades', err)
    }
  }

  const fetchSections = async () => {
    if (!schoolYearId) return
    try {
      const { data } = await axios.get('/api/sections', {
        params: { school_year_id: schoolYearId, page_size: 1000 }
      })
      setSections(data?.sections || [])
    } catch (err) {
      console.error('Failed to load sections', err)
    }
  }

  const fetchTeachers = async () => {
    if (!schoolYearId) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get('/api/teachers', {
        params: {
          school_year_id: schoolYearId,
          search: search || undefined,
          assignment: assignment || undefined,
          page: paginationModel.page + 1,
          page_size: paginationModel.pageSize
        }
      })
      setTeachers(data?.teachers || [])
      setTotal(data?.total || 0)
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to fetch teachers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGrades()
  }, [])

  useEffect(() => {
    fetchSections()
    fetchTeachers()
  }, [schoolYearId])

  useEffect(() => {
    fetchTeachers()
  }, [search, assignment, paginationModel])

  const openProfile = row => {
    if (row) {
      setForm({
        id: row.id,
        full_name: row.full_name || '',
        email: row.email || '',
        username: row.username || '',
        password: ''
      })
    } else {
      setForm(emptyForm)
    }
    setProfileOpen(true)
  }

  const saveProfile = async () => {
    if (!form.full_name || !form.username || (!form.id && !form.password)) {
      alert('Full name, username, and password for new teachers are required.')

      return
    }

    setSavingProfile(true)
    try {
      if (form.id) await axios.put(`/api/teachers/${form.id}`, form)
      else await axios.post('/api/teachers', form)
      setProfileOpen(false)
      await fetchTeachers()
    } catch (err) {
      alert(err?.response?.data?.message || 'Save failed')
    } finally {
      setSavingProfile(false)
    }
  }

  const deactivateTeacher = async id => {
    if (!confirm('Deactivate this teacher? Their active section assignment will also be removed.')) return
    try {
      await axios.delete(`/api/teachers/${id}`)
      await fetchTeachers()
      await fetchSections()
    } catch (err) {
      alert(err?.response?.data?.message || 'Delete failed')
    }
  }

  const openAssign = row => {
    setSelectedTeacher(row)
    setSelectedSectionId(row.section_id ? String(row.section_id) : '')
    setAssignOpen(true)
  }

  const saveAssignment = async () => {
    if (!selectedTeacher || !selectedSectionId) {
      alert('Select a section.')

      return
    }

    setSavingAssignment(true)
    try {
      await axios.post('/api/teacher-section-assignments', {
        school_year_id: schoolYearId,
        teacher_id: selectedTeacher.id,
        section_id: selectedSectionId
      })
      setAssignOpen(false)
      await fetchTeachers()
      await fetchSections()
    } catch (err) {
      alert(err?.response?.data?.message || 'Assignment failed')
    } finally {
      setSavingAssignment(false)
    }
  }

  const columns = [
    { field: 'full_name', headerName: 'Name', flex: 1, minWidth: 170 },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 200 },
    { field: 'username', headerName: 'Username', width: 150 },
    {
      field: 'assignment',
      headerName: 'Current Assignment',
      flex: 1,
      minWidth: 220,
      renderCell: params =>
        params.row.section_id ? (
          <Chip size='small' color='success' label={`${params.row.grade_name} - ${params.row.section_name}`} />
        ) : (
          <Chip size='small' color='warning' label='Unassigned' />
        )
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 180,
      sortable: false,
      renderCell: params => (
        <Box>
          <Tooltip title='Edit Profile'>
            <IconButton size='small' onClick={() => openProfile(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Assign/Reassign Section'>
            <IconButton size='small' color='primary' onClick={() => openAssign(params.row)}>
              <PersonAddIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Deactivate Teacher'>
            <IconButton size='small' color='error' onClick={() => deactivateTeacher(params.row.id)}>
              <DeleteIcon fontSize='small' />
            </IconButton>
          </Tooltip>
        </Box>
      )
    }
  ]

  return (
    <Box p={3}>
      <Stack direction='row' justifyContent='space-between' alignItems='center' mb={2} gap={2} flexWrap='wrap'>
        <Box>
          <Typography variant='h5'>Teachers</Typography>
          <Typography variant='body2' color='text.secondary'>
            Teacher profiles are separate from section assignments. A teacher may exist without a section.
          </Typography>
        </Box>
        <Button startIcon={<AddIcon />} variant='contained' onClick={() => openProfile()}>
          Add Teacher
        </Button>
      </Stack>

      <Stack direction='row' gap={2} alignItems='center' mb={2} flexWrap='wrap'>
        <SchoolYearSelect value={schoolYearId} onChange={setSchoolYearId} />
        <TextField
          size='small'
          placeholder='Search by name / username / email'
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
          sx={{ minWidth: 320 }}
        />
        <TextField
          select
          size='small'
          label='Assignment'
          value={assignment}
          onChange={e => {
            setPaginationModel({ ...paginationModel, page: 0 })
            setAssignment(e.target.value)
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value=''>All</MenuItem>
          <MenuItem value='assigned'>Assigned</MenuItem>
          <MenuItem value='unassigned'>Unassigned</MenuItem>
        </TextField>
      </Stack>

      {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

      <DataGrid
        rows={teachers}
        columns={columns}
        autoHeight
        loading={loading}
        rowCount={total}
        paginationMode='server'
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[10, 25, 50, 100]}
        getRowId={row => row.id}
      />

      <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{form.id ? 'Edit Teacher Profile' : 'Add Teacher'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Alert severity='info'>Section assignment is managed separately. Leave a teacher unassigned during reassignment periods.</Alert>
          <TextField label='Full Name' value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} fullWidth />
          <TextField label='Email' value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} fullWidth />
          <TextField label='Username' value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} fullWidth />
          <TextField
            type='password'
            label={form.id ? 'Password (leave blank to keep current)' : 'Password'}
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProfileOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>Assign/Reassign Section</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Alert severity='warning'>
            Assigning a section to {selectedTeacher?.full_name} will remove their previous active assignment for this school year.
          </Alert>
          <TextField select label='Section' value={selectedSectionId} onChange={e => setSelectedSectionId(e.target.value)} fullWidth>
            <MenuItem value=''>-- Select Section --</MenuItem>
            {grades.map(g => [
              <MenuItem key={`g-${g.id}`} disabled value={`grade-${g.id}`}>
                {g.name}
              </MenuItem>,
              ...sections
                .filter(s => String(s.grade_id) === String(g.id))
                .map(s => (
                  <MenuItem key={s.id} value={String(s.id)}>
                    {g.name} - {s.section_name} {s.assigned_teacher ? `(assigned to ${s.assigned_teacher.full_name})` : '(unassigned)'}
                  </MenuItem>
                ))
            ])}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={saveAssignment} disabled={savingAssignment}>
            {savingAssignment ? 'Saving...' : 'Save Assignment'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
