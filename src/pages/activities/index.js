// pages/activities.js
import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Typography,
  Stack,
  IconButton
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import axios from 'axios'
import { DataGrid } from '@mui/x-data-grid'
import { useSession } from 'next-auth/react'

export default function ActivitiesPage() {
  const { data: session } = useSession()
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', activity_date: '' })
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignForm, setAssignForm] = useState({ activity_id: null, grade_id: '', section_id: '' })
  const [grades, setGrades] = useState([])
  const [sections, setSections] = useState([])

  useEffect(() => {
    fetchActivities()
    fetchGrades()
    fetchSections()
  }, [])

  const fetchActivities = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/activities')
      setActivities(res.data.activities ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const fetchGrades = async () => {
    try {
      const res = await axios.get('/api/grades')
      setGrades(res.data ?? [])
    } catch (e) {
      console.error(e)
    }
  }

  const fetchSections = async () => {
    try {
      const res = await axios.get('/api/sections', { params: { page: 1, page_size: 1000 } })
      const list = res.data?.sections ?? res.data ?? []
      setSections(list.map(s => ({ id: s.id, name: s.section_name ?? s.name, grade_id: s.grade_id })))
    } catch (e) {
      console.error(e)
    }
  }

  const openCreate = () => {
    setForm({ title: '', activity_date: '' })
    setOpen(true)
  }

  const createActivity = async () => {
    if (!form.title || !form.activity_date) {
      alert('Title and date required')

      return
    }
    try {
      await axios.post('/api/activities', form)
      setOpen(false)
      fetchActivities()
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Create failed')
    }
  }

  // Assign modal controls
  const openAssign = activityId => {
    setAssignForm({ activity_id: activityId, grade_id: '', section_id: '' })
    setAssignOpen(true)
  }

  const createAssignment = async () => {
    const { activity_id, grade_id, section_id } = assignForm
    if (!activity_id || !grade_id || !section_id) {
      alert('Select grade and section')

      return
    }
    try {
      await axios.post('/api/activity_assignments', assignForm)
      setAssignOpen(false)
      fetchActivities()
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Assign failed')
    }
  }

  const columns = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'title', headerName: 'Title', flex: 1 },
    { field: 'activity_date', headerName: 'Date', width: 130 },
    { field: 'created_by_name', headerName: 'Created by', width: 180 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 220,
      renderCell: params => (
        <Stack direction='row' spacing={1}>
          <Button size='small' onClick={() => openAssign(params.row.id)}>
            Assign
          </Button>
        </Stack>
      )
    }
  ]

  return (
    <Box p={3}>
      <Box display='flex' justifyContent='space-between' mb={2}>
        <Typography variant='h6'>Activities</Typography>
        <Button startIcon={<AddIcon />} variant='contained' onClick={openCreate}>
          Create Activity
        </Button>
      </Box>

      <div style={{ height: 500, width: '100%' }}>
        <DataGrid rows={activities} columns={columns} getRowId={r => r.id} loading={loading} />
      </div>

      {/* Create Activity modal */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>Create Activity</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label='Title'
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            fullWidth
          />
          <TextField
            type='date'
            label='Date'
            value={form.activity_date}
            onChange={e => setForm({ ...form, activity_date: e.target.value })}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={createActivity}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assign modal */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>Assign Activity to Grade/Section</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            select
            label='Grade'
            value={assignForm.grade_id}
            onChange={e => setAssignForm({ ...assignForm, grade_id: e.target.value, section_id: '' })}
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
            value={assignForm.section_id}
            onChange={e => setAssignForm({ ...assignForm, section_id: e.target.value })}
            fullWidth
            disabled={!assignForm.grade_id}
          >
            <MenuItem value=''>-- Select Section --</MenuItem>
            {sections
              .filter(s => String(s.grade_id) === String(assignForm.grade_id))
              .map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.name}
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={createAssignment}>
            Assign
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

ActivitiesPage.acl = { action: 'read', subject: 'activities-page' }
