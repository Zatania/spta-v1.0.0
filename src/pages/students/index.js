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
  Typography,
  Stack,
  IconButton,
  Tooltip
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import axios from 'axios'
import { DataGrid } from '@mui/x-data-grid'
import { useSession } from 'next-auth/react'

export default function ActivitiesPage() {
  const { data: session } = useSession()

  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(false)

  const [open, setOpen] = useState(false)
  const emptyForm = { id: null, title: '', activity_date: '' }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const [me, setMe] = useState(null) // teacher info from /api/teachers/me

  useEffect(() => {
    fetchMyInfo()
    fetchActivities()
  }, [])

  const fetchMyInfo = async () => {
    try {
      const res = await axios.get('/api/teachers/me')
      setMe(res.data)
    } catch (err) {
      console.error('Failed to fetch teacher info', err)
    }
  }

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

  const openCreate = () => {
    setForm(emptyForm)
    setOpen(true)
  }

  const openEdit = row => {
    setForm({
      id: row.id,
      title: row.title,
      activity_date: row.activity_date
    })
    setOpen(true)
  }

  const saveActivity = async () => {
    if (!form.title || !form.activity_date) {
      alert('Title and date are required')

      return
    }

    if (!me?.teacher?.assigned_sections?.length) {
      alert('No assigned grade/section found for teacher')

      return
    }

    const assigned = me.teacher.assigned_sections[0] // always first section

    const payload = {
      title: form.title,
      activity_date: form.activity_date,
      grade_id: String(assigned.grade_id),
      section_id: String(assigned.id)
    }

    setSaving(true)
    try {
      if (form.id) {
        await axios.put(`/api/activities/${form.id}`, payload)
      } else {
        await axios.post('/api/activities', payload)
      }
      setOpen(false)
      fetchActivities()
    } catch (err) {
      console.error('Save failed', err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
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
      width: 120,
      renderCell: params => (
        <Stack direction='row' spacing={1}>
          <Tooltip title='Edit'>
            <IconButton size='small' onClick={() => openEdit(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
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

      {/* Create/Edit Activity modal */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>{form.id ? 'Edit Activity' : 'Create Activity'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
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
          <Button variant='contained' onClick={saveActivity} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

ActivitiesPage.acl = { action: 'read', subject: 'activities-page' }
