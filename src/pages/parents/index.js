// pages/admin/parents.js
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
  Tooltip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import axios from 'axios'

export default function ParentsPage() {
  const [parents, setParents] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ id: null, first_name: '', last_name: '', contact_info: '' })

  const fetchParents = async () => {
    try {
      const res = await axios.get('/api/parents', { params: { page_size: 1000 } })
      setParents(res.data.parents ?? [])
    } catch (err) {
      console.error('Failed to load parents', err)
    }
  }

  useEffect(() => {
    fetchParents()
  }, [])

  const openCreate = () => {
    setForm({ id: null, first_name: '', last_name: '', contact_info: '' })
    setOpen(true)
  }

  const openEdit = row => {
    setForm({ id: row.id, first_name: row.first_name, last_name: row.last_name, contact_info: row.contact_info })
    setOpen(true)
  }

  const save = async () => {
    try {
      if (form.id) {
        await axios.put(`/api/parents/${form.id}`, form)
      } else {
        await axios.post('/api/parents', form)
      }
      setOpen(false)
      fetchParents()
    } catch (err) {
      console.error('Save failed', err)
      alert(err?.response?.data?.message ?? 'Save failed')
    }
  }

  const remove = async id => {
    if (!confirm('Soft-delete this parent?')) return
    try {
      await axios.delete(`/api/parents/${id}`)
      fetchParents()
    } catch (err) {
      console.error('Delete failed', err)
      alert(err?.response?.data?.message ?? 'Delete failed')
    }
  }

  const columns = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'last_name', headerName: 'Last name', flex: 1 },
    { field: 'first_name', headerName: 'First name', flex: 1 },
    { field: 'contact_info', headerName: 'Contact', flex: 1 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      sortable: false,
      renderCell: params => (
        <>
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
        </>
      )
    }
  ]

  return (
    <Box p={3}>
      <Box display='flex' justifyContent='space-between' alignItems='center' mb={2}>
        <h2>Parents</h2>
        <Button startIcon={<AddIcon />} variant='contained' onClick={openCreate}>
          Add Parent
        </Button>
      </Box>

      <div style={{ width: '100%' }}>
        <DataGrid rows={parents} columns={columns} autoHeight getRowId={r => r.id} pageSize={25} />
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>{form.id ? 'Edit Parent' : 'Add Parent'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
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
            label='Contact info'
            value={form.contact_info}
            onChange={e => setForm({ ...form, contact_info: e.target.value })}
            fullWidth
          />
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={save}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
