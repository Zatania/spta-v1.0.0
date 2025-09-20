// pages/admin/sections.js
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
  CircularProgress
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import { DataGrid } from '@mui/x-data-grid'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import axios from 'axios'

export default function SectionsPage() {
  const [sections, setSections] = useState([])
  const [grades, setGrades] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ id: null, grade_id: '', name: '' })
  const [saving, setSaving] = useState(false)

  // Filters & Pagination
  const [search, setSearch] = useState('')
  const [filterGrade, setFilterGrade] = useState('')
  const [filterAssigned, setFilterAssigned] = useState('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [rowCount, setRowCount] = useState(0)

  const fetchSections = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await axios.get('/api/sections', {
        params: {
          search,
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
    fetchSections()
  }, [search, filterGrade, filterAssigned, paginationModel])

  useEffect(() => {
    fetchGrades()
  }, [])

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
    { field: 'grade_name', headerName: 'Grade', flex: 1 },
    { field: 'section_name', headerName: 'Section', flex: 2 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 140,
      sortable: false,
      filterable: false,
      renderCell: params => (
        <>
          <Tooltip title='Edit'>
            <IconButton size='small' onClick={() => handleOpen(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Delete'>
            <IconButton size='small' onClick={() => handleDelete(params.row.id)}>
              <DeleteIcon fontSize='small' />
            </IconButton>
          </Tooltip>
        </>
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
          onChange={e => {
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
            setFilterGrade(e.target.value)
          }}
        >
          <MenuItem value=''>All Grades</MenuItem>
          {grades.map(g => (
            <MenuItem key={g.id} value={g.id}>
              {g.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size='small'
          label='Assigned'
          value={filterAssigned}
          onChange={e => {
            setFilterAssigned(e.target.value)
          }}
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

      {loading ? (
        <Box display='flex' justifyContent='center' p={4}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity='error'>{error}</Alert>
      ) : (
        <div style={{ width: '100%' }}>
          <DataGrid
            rows={sections}
            columns={columns}
            autoHeight
            rowCount={rowCount}
            paginationMode='server'
            paginationModel={paginationModel}
            onPaginationModelChange={model => setPaginationModel(model)}
            pageSizeOptions={[10, 25, 50]}
            getRowId={r => r.id}
          />
        </div>
      )}

      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>{form.id ? 'Edit Section' : 'Add Section'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            select
            label='Grade'
            value={form.grade_id}
            onChange={e => setForm({ ...form, grade_id: e.target.value })}
          >
            {grades.map(g => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label='Section Name'
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
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
