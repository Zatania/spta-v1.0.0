// pages/teacher/dashboard.js
import { useEffect, useState } from 'react'
import { Box, Card, CardContent, Typography, IconButton, Tooltip } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import VisibilityIcon from '@mui/icons-material/Visibility'
import dayjs from 'dayjs'
import { useRouter } from 'next/router'
import axios from 'axios'

export default function TeacherDashboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const fetchSummary = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/teacher/attendance-summary')
      setRows(
        (data.activities || []).map(a => ({
          id: a.id,
          title: a.title,
          activity_date: a.activity_date,
          present_count: a.present_count,
          absent_count: a.absent_count,
          paid_count: a.paid_count,
          unpaid_count: a.unpaid_count
        }))
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSummary()
  }, [])

  const columns = [
    { field: 'title', headerName: 'Activity', flex: 1 },
    {
      field: 'activity_date',
      headerName: 'Date',
      flex: 0.5,
      valueGetter: p => (p.row.activity_date ? dayjs(p.row.activity_date).format('YYYY-MM-DD') : '')
    },
    { field: 'present_count', headerName: 'Present', flex: 0.4 },
    { field: 'absent_count', headerName: 'Absent', flex: 0.4 },
    { field: 'paid_count', headerName: 'Paid', flex: 0.4 },
    { field: 'unpaid_count', headerName: 'Unpaid', flex: 0.4 },
    {
      field: 'actions',
      headerName: 'Details',
      sortable: false,
      filterable: false,
      width: 100,
      renderCell: params => (
        <Tooltip title='View Students'>
          <IconButton onClick={() => router.push(`/teacher/activity/${params.row.id}`)}>
            <VisibilityIcon fontSize='small' />
          </IconButton>
        </Tooltip>
      )
    }
  ]

  return (
    <Box p={3}>
      <Card>
        <CardContent>
          <Typography variant='h6' gutterBottom>
            Attendance Summary
          </Typography>
          <div style={{ width: '100%' }}>
            <DataGrid
              autoHeight
              rows={rows}
              columns={columns}
              loading={loading}
              pageSize={10}
              rowsPerPageOptions={[10, 25, 50]}
            />
          </div>
        </CardContent>
      </Card>
    </Box>
  )
}

TeacherDashboard.acl = { action: 'read', subject: 'teacher-dashboard' }
