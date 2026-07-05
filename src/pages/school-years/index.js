import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  IconButton,
  Tooltip,
  Chip,
  Alert,
  Stack,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import axios from 'axios'

const emptyForm = { id: null, name: '', start_date: '', end_date: '', is_current: false }

export default function SchoolYearsPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const fetchSchoolYears = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get('/api/school-years')
      setRows(data || [])
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load school years')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSchoolYears()
  }, [])

  const openAdd = () => {
    setForm(emptyForm)
    setOpen(true)
  }

  const openEdit = row => {
    setForm({
      id: row.id,
      name: row.name || '',
      start_date: row.start_date || '',
      end_date: row.end_date || '',
      is_current: Number(row.is_current) === 1
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name || !form.start_date || !form.end_date) {
      alert('Please fill in name, start date, and end date.')

      return
    }

    setSaving(true)
    try {
      if (form.id) {
        await axios.put(`/api/school-years/${form.id}`, {
          name: form.name,
          start_date: form.start_date,
          end_date: form.end_date
        })
      } else {
        await axios.post('/api/school-years', form)
      }
      setOpen(false)
      await fetchSchoolYears()
    } catch (err) {
      alert(err?.response?.data?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const setCurrent = async id => {
    if (!confirm('Set this as the current school year?')) return
    try {
      await axios.post(`/api/school-years/${id}/set-current`)
      await fetchSchoolYears()
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to set current school year')
    }
  }

  const remove = async id => {
    if (!confirm('Delete this school year? This is only allowed if it has no linked records.')) return
    try {
      await axios.delete(`/api/school-years/${id}`)
      await fetchSchoolYears()
    } catch (err) {
      alert(err?.response?.data?.message || 'Delete failed')
    }
  }

  const columns = [
    { field: 'name', headerName: 'School Year', flex: 1, minWidth: 160 },
    { field: 'start_date', headerName: 'Start Date', width: 130 },
    { field: 'end_date', headerName: 'End Date', width: 130 },
    {
      field: 'is_current',
      headerName: 'Status',
      width: 130,
      renderCell: params =>
        Number(params.row.is_current) === 1 ? (
          <Chip size='small' color='success' label='Current' />
        ) : (
          <Chip size='small' label='Inactive' />
        )
    },
    { field: 'enrolled_students', headerName: 'Active Students', width: 140 },
    { field: 'active_teacher_assignments', headerName: 'Teacher Assignments', width: 170 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 180,
      sortable: false,
      renderCell: params => (
        <Box>
          <Tooltip title='Edit'>
            <IconButton size='small' onClick={() => openEdit(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          {Number(params.row.is_current) !== 1 && (
            <Tooltip title='Set Current'>
              <IconButton size='small' color='success' onClick={() => setCurrent(params.row.id)}>
                <CheckCircleIcon fontSize='small' />
              </IconButton>
            </Tooltip>
          )}
          {Number(params.row.is_current) !== 1 && (
            <Tooltip title='Delete'>
              <IconButton size='small' color='error' onClick={() => remove(params.row.id)}>
                <DeleteIcon fontSize='small' />
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
          <Typography variant='h5'>School Years</Typography>
          <Typography variant='body2' color='text.secondary'>
            Create school years and select which year is currently active for new records.
          </Typography>
        </Box>
        <Button variant='contained' startIcon={<AddIcon />} onClick={openAdd}>
          Add School Year
        </Button>
      </Stack>

      {error && (
        <Alert severity='error' sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <DataGrid
        rows={rows}
        columns={columns}
        autoHeight
        loading={loading}
        getRowId={row => row.id}
        pageSizeOptions={[10, 25, 50]}
        initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{form.id ? 'Edit School Year' : 'Add School Year'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label='Name'
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            fullWidth
          />
          <TextField
            type='date'
            label='Start Date'
            value={form.start_date}
            onChange={e => setForm({ ...form, start_date: e.target.value })}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            type='date'
            label='End Date'
            value={form.end_date}
            onChange={e => setForm({ ...form, end_date: e.target.value })}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          {!form.id && (
            <Alert severity='info'>After saving, you can set this as the current school year from the table.</Alert>
          )}
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
