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
  Tooltip,
  FormControlLabel,
  Checkbox,
  Switch
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import axios from 'axios'
import { DataGrid } from '@mui/x-data-grid'
import { useSession } from 'next-auth/react'

export default function ActivitiesPage() {
  const { data: session } = useSession()
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(false)

  const [me, setMe] = useState(null) // { user, teacher: { assigned_sections: [...] } }

  const [open, setOpen] = useState(false)
  const emptyForm = { id: null, title: '', activity_date: '', payments_enabled: true }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchMyInfo()
    fetchActivities()
  }, [])

  const fetchMyInfo = async () => {
    try {
      const res = await axios.get('/api/teachers/me')
      setMe(res.data)
    } catch (err) {
      console.error('Failed to fetch my info', err)
    }
  }

  const fetchActivities = async () => {
    setLoading(true)
    try {
      // Make sure your API returns payments_enabled
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
      activity_date: row.activity_date,
      payments_enabled: !!row.payments_enabled
    })
    setOpen(true)
  }

  const saveActivity = async () => {
    if (!form.title || !form.activity_date) {
      alert('Title and date required')

      return
    }
    if (!me?.teacher?.assigned_sections?.length) {
      alert('No assigned grade/section found for this teacher.')

      return
    }

    const assignedSection = me.teacher.assigned_sections[0] // always first assigned section

    const payload = {
      title: form.title,
      activity_date: form.activity_date,
      payments_enabled: form.payments_enabled ? 1 : 0
    }

    setSaving(true)
    try {
      if (form.id) {
        // update only title/date/payments flag
        await axios.put(`/api/activities/${form.id}`, payload)
      } else {
        // create activity
        const createRes = await axios.post('/api/activities', payload)
        const activityId = createRes.data?.id || createRes.data?.activity?.id

        // assign to teacher via /api/activity_assignments
        if (activityId) {
          await axios.post('/api/activity_assignments', {
            activity_id: activityId,
            grade_id: assignedSection.grade_id,
            section_id: assignedSection.id
          })
        }
      }

      setOpen(false)
      fetchActivities()
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePaymentsInline = async (id, checked) => {
    // optimistic update
    setActivities(prev => prev.map(a => (a.id === id ? { ...a, payments_enabled: checked } : a)))
    try {
      await axios.put(`/api/activities/${id}`, { payments_enabled: checked ? 1 : 0 })
    } catch (err) {
      console.error(err)

      // revert on error
      setActivities(prev => prev.map(a => (a.id === id ? { ...a, payments_enabled: !checked } : a)))
      alert('Failed to update payments flag')
    }
  }

  const handleDelete = async row => {
    if (!confirm(`Delete activity "${row.title}"?`)) return
    try {
      await axios.delete(`/api/activities/${row.id}`)
      setActivities(prev => prev.filter(a => a.id !== row.id)) // update UI
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Delete failed')
    }
  }

  const columns = [
    { field: 'title', headerName: 'Title', flex: 1 },
    { field: 'activity_date', headerName: 'Date', width: 130 },
    { field: 'created_by_name', headerName: 'Created by', width: 180 },
    {
      field: 'payments_enabled',
      headerName: 'Payments',
      width: 140,
      renderCell: params => (
        <FormControlLabel
          control={
            <Switch
              checked={!!params.row.payments_enabled}
              onChange={e => handleTogglePaymentsInline(params.row.id, e.target.checked)}
              size='small'
            />
          }
          label={params.row.payments_enabled ? 'Enabled' : 'Disabled'}
        />
      )
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 160,
      renderCell: params => (
        <Stack direction='row' spacing={1}>
          <Tooltip title='Edit'>
            <IconButton size='small' onClick={() => openEdit(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Delete'>
            <IconButton size='small' color='error' onClick={() => handleDelete(params.row)}>
              <DeleteIcon fontSize='small' />
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
        <DataGrid rows={activities} columns={columns} getRowId={r => r.id} loading={loading} disableSelectionOnClick />
      </div>

      {/* Create/Edit Activity modal */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>{form.id ? 'Edit Activity' : 'Create Activity'}</DialogTitle>
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

          <FormControlLabel
            control={
              <Checkbox
                checked={!!form.payments_enabled}
                onChange={e => setForm({ ...form, payments_enabled: e.target.checked })}
              />
            }
            label='Require payment for this activity'
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
