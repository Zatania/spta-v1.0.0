// pages/teacher/dashboard.js
import { useEffect, useState, useRef } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Tooltip,
  Grid,
  Button,
  Chip,
  Paper,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Avatar,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import VisibilityIcon from '@mui/icons-material/Visibility'
import DownloadIcon from '@mui/icons-material/Download'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import AssessmentIcon from '@mui/icons-material/Assessment'
import CloseIcon from '@mui/icons-material/Close'
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
  const [downloadingReport, setDownloadingReport] = useState(false)
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('')
  const [pdfPreviewStudent, setPdfPreviewStudent] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [previewEndpoint, setPreviewEndpoint] = useState('')
  const router = useRouter()

  const attendanceDetailsRef = useRef(null)

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

      // Remove auto-selection - only load details when user clicks
      // if (activities.length > 0 && !selectedActivity) {
      //   setSelectedActivity(activities[0])
      //   fetchStudents(activities[0].id)
      // }
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

  useEffect(() => {
    if (selectedActivity && attendanceDetailsRef.current) {
      attendanceDetailsRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    }
  }, [selectedActivity])

  const handlePreviewForm = async student => {
    if (!student || !selectedActivity) return

    setPdfPreviewStudent(student)
    setPdfPreviewUrl('')
    setPdfError('')
    setPdfLoading(true)
    setPdfPreviewOpen(true)

    const sy = inferSchoolYear()

    const url = `/api/teacher/forms/parent-checklist?student_id=${student.id}&school_year=${encodeURIComponent(
      sy
    )}&preview=true`
    setPreviewEndpoint(url)

    try {
      const resp = await axios.get(url, { responseType: 'blob', withCredentials: true })

      console.log('preview response status (axios):', resp.status)
      console.log(
        'preview response content-type:',
        resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])
      )

      if (!resp || !resp.data) {
        throw new Error('No data received from preview endpoint')
      }

      const blob = resp.data

      // Read first bytes to check file signature
      const ab = await blob.arrayBuffer()
      const headerBytes = new Uint8Array(ab).slice(0, 8)
      let headerStr = ''
      try {
        headerStr = new TextDecoder().decode(headerBytes)
      } catch (e) {
        headerStr = ''
      }
      console.log('preview blob header (first 8 chars):', headerStr)

      // PDFs start with "%PDF-"
      if (!headerStr.startsWith('%PDF')) {
        // not a valid PDF — try to show the first part of the text body for debugging
        let bodyText = ''
        try {
          // convert arrayBuffer to string (may contain HTML)
          bodyText = new TextDecoder().decode(new Uint8Array(ab).slice(0, 2000))
        } catch (e) {
          bodyText = '<could not decode response text>'
        }
        console.warn('Preview endpoint returned non-PDF payload:', bodyText.slice(0, 1000))
        setPdfError(
          `Preview did not return a valid PDF. Server returned something else (first 1000 chars):\n\n${bodyText.slice(
            0,
            1000
          )}`
        )

        return
      }

      // Valid PDF header — create a new blob from the buffer and show
      const validPdfBlob = new Blob([ab], { type: 'application/pdf' })
      const blobUrl = URL.createObjectURL(validPdfBlob)
      setPdfPreviewUrl(blobUrl)
    } catch (err) {
      console.error('Error generating form preview:', err)

      const serverMsg =
        err?.response?.data && typeof err.response.data === 'string'
          ? err.response.data
          : err?.message || JSON.stringify(err?.response || err) || 'Failed to generate preview'
      setPdfError(serverMsg)
    } finally {
      setPdfLoading(false)
    }
  }

  const handleDownloadFromPreview = () => {
    if (!pdfPreviewUrl || !pdfPreviewStudent) return

    const a = document.createElement('a')

    const filename =
      `SPTA_Checklist_${pdfPreviewStudent.last_name}_${pdfPreviewStudent.first_name}_${pdfPreviewStudent.grade_name}_${pdfPreviewStudent.section_name}.pdf`.replace(
        /\s+/g,
        '_'
      )

    a.href = pdfPreviewUrl
    a.download = filename
    a.click()
  }

  const handleClosePreview = () => {
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl)
    }
    setPdfPreviewOpen(false)
    setPdfPreviewUrl('')
    setPdfPreviewStudent(null)
    setPdfLoading(false)
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

  const handleDownloadAttendanceReport = async () => {
    if (!selectedActivity) return

    setDownloadingReport(true)
    try {
      const url = `/api/teacher/reports/attendance?activity_id=${selectedActivity.id}`
      const resp = await fetch(url)

      if (!resp.ok) {
        console.error('Failed to generate attendance report')

        return
      }

      const blob = await resp.blob()
      const a = document.createElement('a')

      const filename = `Attendance_Report_${selectedActivity.title}_${dayjs(selectedActivity.activity_date).format(
        'YYYY-MM-DD'
      )}.pdf`.replace(/\s+/g, '_')

      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (error) {
      console.error('Error downloading attendance report:', error)
    } finally {
      setDownloadingReport(false)
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

  const getStatusColor = status => {
    switch (status) {
      case 'present':
        return 'success'
      case 'absent':
        return 'error'
      default:
        return 'default'
    }
  }

  const getPaymentColor = paid => {
    if (paid === null) return 'default'

    return paid ? 'primary' : 'warning'
  }

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        try {
          URL.revokeObjectURL(pdfPreviewUrl)
        } catch (e) {}
      }
    }
  }, [pdfPreviewUrl])

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
          <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
            Click on any activity row to view detailed attendance information
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

      {/* Detailed Students Attendance Table */}
      {selectedActivity && (
        <Card ref={attendanceDetailsRef}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                <Typography variant='h6' gutterBottom>
                  Attendance Details - {selectedActivity.title}
                </Typography>
                <Stack direction='row' spacing={1} sx={{ mb: 2 }}>
                  <Chip label={dayjs(selectedActivity.activity_date).format('YYYY-MM-DD')} size='small' />
                  <Chip label={`Total: ${students.length}`} size='small' variant='outlined' />
                  <Chip
                    label={`Present: ${students.filter(s => s.attendance_status === 'present').length}`}
                    size='small'
                    color='success'
                    variant='outlined'
                  />
                  <Chip
                    label={`Absent: ${students.filter(s => s.attendance_status === 'absent').length}`}
                    size='small'
                    color='error'
                    variant='outlined'
                  />
                </Stack>
              </Box>
              <Button
                variant='contained'
                startIcon={<AssessmentIcon />}
                onClick={handleDownloadAttendanceReport}
                disabled={downloadingReport}
                color='primary'
              >
                {downloadingReport ? 'Generating...' : 'Download Report'}
              </Button>
            </Box>

            {studentsLoading ? (
              <Typography>Loading students...</Typography>
            ) : (
              <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>
                        <strong>LRN</strong>
                      </TableCell>
                      <TableCell>
                        <strong>Student Name</strong>
                      </TableCell>
                      <TableCell>
                        <strong>Grade & Section</strong>
                      </TableCell>
                      <TableCell>
                        <strong>Student Presence</strong>
                      </TableCell>
                      <TableCell>
                        <strong>Parent Presence</strong>
                      </TableCell>
                      <TableCell>
                        <strong>Payment Status</strong>
                      </TableCell>
                      <TableCell>
                        <strong>Payment Date</strong>
                      </TableCell>
                      <TableCell>
                        <strong>Parents</strong>
                      </TableCell>
                      <TableCell>
                        <strong>Action</strong>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {students.map(student => (
                      <TableRow key={student.id} hover>
                        <TableCell>
                          <Typography variant='body2' fontWeight='medium'>
                            {student.lrn}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {student.picture_url && <Avatar src={student.picture_url} sx={{ width: 32, height: 32 }} />}
                            <Typography variant='body2'>
                              {student.last_name}, {student.first_name}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant='body2'>
                            {student.grade_name} - {student.section_name}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={
                              student.attendance_status
                                ? student.attendance_status.charAt(0).toUpperCase() + student.attendance_status.slice(1)
                                : 'Not Marked'
                            }
                            size='small'
                            color={getStatusColor(student.attendance_status)}
                            variant={student.attendance_status ? 'filled' : 'outlined'}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={student.parent_present ? 'Present' : 'Absent'}
                            size='small'
                            color={student.parent_present ? 'info' : 'default'}
                            variant={student.parent_present ? 'filled' : 'outlined'}
                          />
                        </TableCell>
                        <TableCell>
                          {student.payment_paid !== null ? (
                            <Chip
                              label={student.payment_paid ? 'Paid' : 'Unpaid'}
                              size='small'
                              color={getPaymentColor(student.payment_paid)}
                            />
                          ) : (
                            <Chip label='Not Set' size='small' variant='outlined' />
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant='body2'>
                            {student.payment_date ? dayjs(student.payment_date).format('MMM DD, YYYY') : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant='caption' color='text.secondary'>
                            {student.parents || 'No parents listed'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Stack direction='row' spacing={1}>
                            <Button
                              size='small'
                              startIcon={<VisibilityIcon />}
                              onClick={() => handlePreviewForm(student)}
                              variant='outlined'
                              color='primary'
                            >
                              Preview
                            </Button>
                            <Button
                              size='small'
                              startIcon={<DownloadIcon />}
                              onClick={() => handleDownloadForm(student)}
                              variant='outlined'
                              color='secondary'
                            >
                              Download
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* PDF Preview Dialog */}
      {/* PDF Preview Dialog */}
      <Dialog
        open={pdfPreviewOpen}
        onClose={handleClosePreview}
        fullWidth
        maxWidth='lg'
        aria-labelledby='pdf-preview-title'
      >
        <DialogTitle
          id='pdf-preview-title'
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>Form Preview</span>
          <IconButton edge='end' onClick={handleClosePreview}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ minHeight: 240 }}>
          {pdfLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : pdfError ? (
            <Box sx={{ p: 2 }}>
              <Typography color='error' sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
                {pdfError}
              </Typography>
              <Typography variant='body2' sx={{ mb: 1 }}>
                Tip: open the preview endpoint directly in a new tab to inspect the server response.
              </Typography>
              <Stack direction='row' spacing={1}>
                <Button onClick={() => previewEndpoint && window.open(previewEndpoint, '_blank')} variant='outlined'>
                  Open endpoint in new tab
                </Button>
                <Button onClick={handleClosePreview} variant='contained'>
                  Close
                </Button>
              </Stack>
            </Box>
          ) : pdfPreviewUrl ? (
            <iframe src={pdfPreviewUrl} style={{ width: '100%', height: '70vh', border: 'none' }} title='PDF Preview' />
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography>No preview available.</Typography>
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClosePreview} variant='outlined'>
            Close
          </Button>
          <Button
            onClick={handleDownloadFromPreview}
            variant='contained'
            disabled={!pdfPreviewUrl || pdfLoading}
            startIcon={<PictureAsPdfIcon />}
          >
            Download
          </Button>
        </DialogActions>
      </Dialog>
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
