// pages/teacher/dashboard.js
import { useEffect, useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Tooltip,
  Grid,
  Button,
  List,
  ListItem,
  ListItemText,
  Divider,
  Chip,
  Paper
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import VisibilityIcon from '@mui/icons-material/Visibility'
import DownloadIcon from '@mui/icons-material/Download'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import dayjs from 'dayjs'
import { useRouter } from 'next/router'
import axios from 'axios'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend
} from 'chart.js'

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, ChartTooltip, Legend)

export default function TeacherDashboard() {
  const [rows, setRows] = useState([])
  const [selectedActivity, setSelectedActivity] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(false)
  const [studentsLoading, setStudentsLoading] = useState(false)
  const router = useRouter()

  const fetchSummary = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/teacher/attendance-summary')

      const activities = (data.activities || []).map(a => ({
        id: a.id,
        title: a.title,
        activity_date: a.activity_date,
        present_count: a.present_count,
        absent_count: a.absent_count,
        paid_count: a.paid_count,
        unpaid_count: a.unpaid_count
      }))
      setRows(activities)

      // Auto-select first activity if available
      if (activities.length > 0 && !selectedActivity) {
        setSelectedActivity(activities[0])
        fetchStudents(activities[0].id)
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchStudents = async activityId => {
    if (!activityId) return
    setStudentsLoading(true)
    try {
      const { data } = await axios.get(`/api/teacher/activity/${activityId}/students`, {
        params: {
          page: 1,
          page_size: 1000 // Get all students for the selected activity
        }
      })
      setStudents(data.students || [])
    } catch (error) {
      console.error('Error fetching students:', error)
      setStudents([])
    } finally {
      setStudentsLoading(false)
    }
  }

  useEffect(() => {
    fetchSummary()
  }, [])

  const handleActivitySelect = activity => {
    setSelectedActivity(activity)
    fetchStudents(activity.id)
  }

  const handleDownloadForm = async student => {
    if (!student || !selectedActivity) return

    try {
      const sy = inferSchoolYear()
      const url = `/api/teacher/forms/parent-checklist?student_id=${student.id}&school_year=${encodeURIComponent(sy)}`
      const resp = await fetch(url)

      if (!resp.ok) {
        console.error('Failed to generate form')

        return
      }

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
    } catch (error) {
      console.error('Error downloading form:', error)
    }
  }

  // Prepare attendance chart data
  const attendanceChartData = {
    labels: rows.map(row => row.title),
    datasets: [
      {
        label: 'Present',
        data: rows.map(row => row.present_count),
        backgroundColor: '#4CAF50',
        borderColor: '#4CAF50',
        borderWidth: 1
      },
      {
        label: 'Absent',
        data: rows.map(row => row.absent_count),
        backgroundColor: '#F44336',
        borderColor: '#F44336',
        borderWidth: 1
      }
    ]
  }

  // Prepare payment chart data
  const paymentChartData = {
    labels: rows.map(row => row.title),
    datasets: [
      {
        label: 'Paid',
        data: rows.map(row => row.paid_count),
        backgroundColor: '#2196F3',
        borderColor: '#2196F3',
        borderWidth: 1
      },
      {
        label: 'Unpaid',
        data: rows.map(row => row.unpaid_count),
        backgroundColor: '#FF9800',
        borderColor: '#FF9800',
        borderWidth: 1
      }
    ]
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top'
      },
      tooltip: {
        mode: 'index',
        intersect: false
      }
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'Activities'
        }
      },
      y: {
        display: true,
        title: {
          display: true,
          text: 'Count'
        },
        beginAtZero: true
      }
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const index = elements[0].index
        const activity = rows[index]
        if (activity) {
          handleActivitySelect(activity)
        }
      }
    }
  }

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
    { field: 'unpaid_count', headerName: 'Unpaid', flex: 0.4 }
  ]

  return (
    <Box p={3}>
      {/* Charts Section */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {/* Attendance Chart */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant='h6' gutterBottom>
                Attendance Overview
              </Typography>
              <Box sx={{ height: 300 }}>
                <Bar data={attendanceChartData} options={chartOptions} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Payment Chart */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant='h6' gutterBottom>
                Payment Overview
              </Typography>
              <Box sx={{ height: 300 }}>
                <Bar data={paymentChartData} options={chartOptions} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      {/* Main Summary Table */}
      <Card sx={{ mb: 3 }}>
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
              onRowClick={params => handleActivitySelect(params.row)}
              sx={{
                '& .MuiDataGrid-row': {
                  cursor: 'pointer'
                },
                '& .MuiDataGrid-row:hover': {
                  backgroundColor: 'action.hover'
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Selected Activity Students */}
      {selectedActivity && (
        <Card>
          <CardContent>
            <Typography variant='h6' gutterBottom>
              Students - {selectedActivity.title}
              <Chip label={dayjs(selectedActivity.activity_date).format('YYYY-MM-DD')} size='small' sx={{ ml: 2 }} />
            </Typography>

            {studentsLoading ? (
              <Typography>Loading students...</Typography>
            ) : (
              <>
                <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                  Total Students: {students.length} | Present:{' '}
                  {students.filter(s => s.attendance_status === 'present').length} | Absent:{' '}
                  {students.filter(s => s.attendance_status === 'absent').length}
                </Typography>

                <Paper sx={{ maxHeight: 400, overflow: 'auto' }}>
                  <List dense>
                    {students.map((student, index) => (
                      <div key={student.id}>
                        <ListItem
                          secondaryAction={
                            <Button
                              size='small'
                              startIcon={<PictureAsPdfIcon />}
                              onClick={() => handleDownloadForm(student)}
                              variant='outlined'
                            >
                              Download Form
                            </Button>
                          }
                        >
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant='body1'>
                                  {student.last_name}, {student.first_name}
                                </Typography>
                                <Chip
                                  label={student.attendance_status === 'present' ? 'Present' : 'Absent'}
                                  size='small'
                                  color={student.attendance_status === 'present' ? 'success' : 'error'}
                                />
                                {student.payment_paid !== null && (
                                  <Chip
                                    label={student.payment_paid ? 'Paid' : 'Unpaid'}
                                    size='small'
                                    color={student.payment_paid ? 'primary' : 'warning'}
                                  />
                                )}
                                {student.parent_present && <Chip label='Parent Present' size='small' color='info' />}
                              </Box>
                            }
                            secondary={
                              <Box>
                                <Typography variant='caption' display='block'>
                                  LRN: {student.lrn} | {student.grade_name} - {student.section_name}
                                </Typography>
                                {student.parents && (
                                  <Typography variant='caption' color='text.secondary'>
                                    Parents: {student.parents}
                                  </Typography>
                                )}
                              </Box>
                            }
                          />
                        </ListItem>
                        {index < students.length - 1 && <Divider />}
                      </div>
                    ))}
                  </List>
                </Paper>
              </>
            )}
          </CardContent>
        </Card>
      )}
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

TeacherDashboard.acl = { action: 'read', subject: 'teacher-dashboard' }
