// pages/admin/sections.js
import { useEffect, useState, useCallback } from 'react'
import { Box, Button, TextField, MenuItem, IconButton, Tooltip, CircularProgress, InputAdornment } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import axios from 'axios'
import { DataGrid } from '@mui/x-data-grid'
import debounce from 'lodash.debounce'

export default function SectionsPage() {
  const [sections, setSections] = useState([])
  const [grades, setGrades] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  // filters
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [assignedFilter, setAssignedFilter] = useState('') // '', '1', '0'

  // pagination
  const [page, setPage] = useState(0) // 0-based for DataGrid
  const [pageSize, setPageSize] = useState(25)

  // fetch grades
  useEffect(() => {
    axios.get('/api/grades').then(r => setGrades(r.data ?? []))
  }, [])

  // fetch sections with filters/pagination
  const fetchSections = useCallback(
    async (opts = {}) => {
      setLoading(true)
      try {
        const params = {
          search: opts.search ?? search,
          grade_id: opts.gradeFilter ?? gradeFilter,
          assigned: opts.assignedFilter ?? assignedFilter,
          page: (opts.page ?? page) + 1, // API is 1-based
          page_size: opts.pageSize ?? pageSize
        }

        // remove empty params to keep urls clean
        Object.keys(params).forEach(k => {
          if (params[k] === '' || params[k] == null) delete params[k]
        })

        const res = await axios.get('/api/sections', { params })
        setSections(res.data.sections ?? [])
        setTotal(res.data.total ?? 0)
      } catch (err) {
        console.error('Failed to load sections', err)
      } finally {
        setLoading(false)
      }
    },
    [search, gradeFilter, assignedFilter, page, pageSize]
  )

  // debounced version of fetch when user types search
  const debouncedFetch = useCallback(
    debounce(s => {
      fetchSections({ search: s, page: 0 })
      setPage(0)
    }, 400),
    [fetchSections]
  )

  useEffect(() => {
    fetchSections()

    // cleanup debounce on unmount
    return () => debouncedFetch.cancel()
  }, [fetchSections])

  // when search input changes, use debounce
  const onSearchChange = e => {
    const v = e.target.value
    setSearch(v)
    debouncedFetch(v)
  }

  // when grade/assigned changed, reset page and fetch
  useEffect(() => {
    fetchSections({ page: 0 })
    setPage(0)
  }, [gradeFilter, assignedFilter]) // eslint-disable-line

  const columns = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'grade_name', headerName: 'Grade', width: 140 },
    { field: 'section_name', headerName: 'Section', flex: 1, minWidth: 160 },
    {
      field: 'assigned',
      headerName: 'Assigned',
      width: 130,
      renderCell: params => {
        const a = params.row.assigned
        const teacher = params.row.assigned_teacher

        return a ? (teacher ? `${teacher.full_name}` : 'Yes') : 'Unassigned'
      }
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      sortable: false,
      filterable: false,
      renderCell: params => (
        <>
          <Tooltip title='Edit'>
            <IconButton size='small'>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Delete'>
            <IconButton size='small' color='error'>
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
          placeholder='Search sections or grade...'
          value={search}
          onChange={onSearchChange}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <SearchIcon />
              </InputAdornment>
            )
          }}
          sx={{ minWidth: 300 }}
        />

        <TextField
          select
          size='small'
          label='Grade'
          value={gradeFilter}
          onChange={e => setGradeFilter(e.target.value)}
          sx={{ minWidth: 180 }}
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
          value={assignedFilter}
          onChange={e => setAssignedFilter(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value=''>All</MenuItem>
          <MenuItem value='1'>Assigned</MenuItem>
          <MenuItem value='0'>Unassigned</MenuItem>
        </TextField>

        <Box sx={{ flexGrow: 1 }} />

        <Button startIcon={<AddIcon />} variant='contained'>
          Add Section
        </Button>
      </Box>

      <div style={{ width: '100%' }}>
        <DataGrid
          rows={sections}
          columns={columns}
          autoHeight
          pageSize={pageSize}
          rowCount={total}
          paginationMode='server'
          onPageChange={newPage => {
            setPage(newPage)
            fetchSections({ page: newPage })
          }}
          onPageSizeChange={newSize => {
            setPageSize(newSize)
            fetchSections({ page: 0, pageSize: newSize })
            setPage(0)
          }}
          page={page}
          rowsPerPageOptions={[10, 25, 50, 100]}
          getRowId={r => r.id}
          loading={loading}
        />
      </div>
    </Box>
  )
}
