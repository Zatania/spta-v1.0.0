// pages/teacher/activity/[activityId].js
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  InputAdornment,
  IconButton,
  MenuItem,
  Stack,
  Button
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import SearchIcon from '@mui/icons-material/Search'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import axios from 'axios'

export default function ActivityStudentsPage() {
  const router = useRouter()
  const { activityId } = router.query

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0) // DataGrid zero-based
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [sectionId, setSectionId] = useState('') // optional if activity covers multiple sections
  const [sections, setSections] = useState([])

  const fetchStudents = async () => {
    if (!activityId) return
    setLoading(true)
    try {
      const { data } = await axios.get(`/api/teacher/activity/${activityId}/students`, {
        params: {
          page: page + 1,
          page_size: pageSize,
          search: search || '',
          section_id: sectionId || ''
        }
      })
      setRows(data.students || [])
      setTotal(data.total || 0)
    } finally {
      setLoading(false)
    }
  }

  const fetchActivitySections = async () => {
    if (!activityId) return

    // simple helper: request minimal students once and extract unique sections from response,
    // or build a tiny API if you prefer. Here we reuse students endpoint to discover sections on first load.
    const { data } = await axios.get(`/api/teacher/activity/${activityId}/students`, {
      params: { page: 1, page_size: 1 }
    })

    const unique = new Map()
    ;(data.students || []).forEach(s =>
      unique.set(s.section_id, { id: s.section_id, name: `${s.grade_name} • ${s.section_name}` })
    )

    // If none returned because page_size=1, keep it empty; it will populate once list is loaded
    setSections(Array.from(unique.values()))
  }

  useEffect(() => {
    fetchActivitySections()
  }, [activityId])
  useEffect(() => {
    fetchStudents()
  }, [activityId, page, pageSize, search, sectionId])

  const handleGenerateForm = async student => {
    const sy = inferSchoolYear()
    const url = `/api/teacher/forms/parent-checklist?student_id=${student.id}&school_year=${encodeURIComponent(sy)}`
    const resp = await fetch(url)
    if (!resp.ok) return
    const blob = await resp.blob()
    const a = document.createElement('a')

    const filename =
      `SPTA_Checklist_${student.last_name}_${student.first_name}_${student.grade_name}_${student.section_name}.pdf`.replace(
        /\s+/g,
        '_'
      )
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const columns = [
    { field: 'lrn', headerName: 'LRN', flex: 0.7 },
    {
      field: 'name',
      headerName: 'Student',
      flex: 1.2,
      valueGetter: p => `${p.row.last_name}, ${p.row.first_name}`
    },
    { field: 'parents', headerName: 'Parents/Guardians', flex: 1.5 },
    { field: 'attendance_status', headerName: 'Attendance', flex: 0.8 },
    {
      field: 'parent_present',
      headerName: 'Parent Present',
      flex: 0.7,
      valueGetter: p => (p.row.parent_present ? 'Yes' : 'No')
    },
    {
      field: 'payment_paid',
      headerName: 'Paid',
      flex: 0.5,
      valueGetter: p => (p.row.payment_paid === null ? '—' : p.row.payment_paid ? 'Yes' : 'No')
    },
    {
      field: 'actions',
      headerName: 'SPTA Form',
      sortable: false,
      filterable: false,
      width: 110,
      renderCell: params => (
        <IconButton onClick={() => handleGenerateForm(params.row)} title='Generate PDF'>
          <PictureAsPdfIcon fontSize='small' />
        </IconButton>
      )
    }
  ]

  return (
    <Box p={3}>
      <Card>
        <CardContent>
          <Stack direction='row' alignItems='center' justifyContent='space-between' mb={2}>
            <Typography variant='h6'>Students — Activity #{activityId}</Typography>
            <Stack direction='row' spacing={2}>
              <TextField
                size='small'
                placeholder='Search name or LRN'
                value={search}
                onChange={e => {
                  setPage(0)
                  setSearch(e.target.value)
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position='start'>
                      <SearchIcon />
                    </InputAdornment>
                  )
                }}
              />
              <TextField
                select
                size='small'
                label='Section (optional)'
                value={sectionId}
                onChange={e => {
                  setPage(0)
                  setSectionId(e.target.value)
                }}
                sx={{ minWidth: 220 }}
              >
                <MenuItem value=''>All</MenuItem>
                {sections.map(s => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Stack>

          <div style={{ width: '100%' }}>
            <DataGrid
              autoHeight
              rows={rows}
              getRowId={r => r.id}
              columns={columns}
              loading={loading}
              rowCount={total}
              pagination
              paginationMode='server'
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </CardContent>
      </Card>
    </Box>
  )
}

// Simple PH school year inference (Jun–May)
function inferSchoolYear(date = new Date()) {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  if (m >= 6) return `${y}-${y + 1}`

  return `${y - 1}-${y}`
}

ActivityStudentsPage.acl = { action: 'read', subject: 'teacher-activity' }
