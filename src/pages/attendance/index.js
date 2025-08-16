// pages/attendance.js
import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
  Stack,
  IconButton,
  Tooltip,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import axios from 'axios'
import { useSession } from 'next-auth/react'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import dayjs from 'dayjs'

export default function AttendancePage() {
  const { data: session } = useSession()
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeAssignment, setActiveAssignment] = useState(null)
  const [students, setStudents] = useState([]) // each student row includes attendance/payment fields
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [savingPayments, setSavingPayments] = useState(false)

  useEffect(() => {
    fetchAssignments()
  }, [page, pageSize])

  // fetch assignments (server-side pagination/filters)
  const fetchAssignments = async (opts = {}) => {
    setLoading(true)
    try {
      const params = {
        page: (opts.page ?? page) + 1,
        page_size: opts.pageSize ?? pageSize
      }
      Object.keys(params).forEach(k => {
        if (params[k] === '' || params[k] == null) delete params[k]
      })
      const res = await axios.get('/api/activity_assignments', { params })
      setAssignments(res.data.assignments ?? [])
      setTotal(res.data.total ?? 0)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // open assignment modal
  const openAssignment = async assignment => {
    setActiveAssignment(assignment)
    setDialogOpen(true)
    try {
      const res = await axios.get(`/api/activity_assignments/${assignment.id}/students`)

      // Map students to editable shape:
      const s = (res.data.students ?? []).map(st => ({
        ...st,
        attendance_state: st.attendance ? st.attendance.status : 'absent',
        parent_present: st.attendance ? !!st.attendance.parent_present : false,
        payment_paid: st.payment ? !!st.payment.paid : false,
        payment_date: st.payment ? st.payment.payment_date : null
      }))
      setStudents(s)
    } catch (err) {
      console.error(err)
      alert('Failed to load students for this assignment')
      setDialogOpen(false)
    }
  }

  // update by student id
  const handleAttendanceChange = (studentId, field, value) => {
    setStudents(prev => prev.map(s => (s.id === studentId ? { ...s, [field]: value } : s)))
  }

  const saveAttendance = async () => {
    if (!activeAssignment) return
    setSavingAttendance(true)
    try {
      const records = students.map(s => ({
        student_id: s.id,
        status: s.attendance_state,
        parent_present: s.parent_present ? 1 : 0
      }))
      await axios.post('/api/attendance/bulk', { activity_assignment_id: activeAssignment.id, records })
      alert('Attendance saved')

      // reload to refresh with server data
      const res = await axios.get(`/api/activity_assignments/${activeAssignment.id}/students`)

      const s = (res.data.students ?? []).map(st => ({
        ...st,
        attendance_state: st.attendance ? st.attendance.status : 'absent',
        parent_present: st.attendance ? !!st.attendance.parent_present : false,
        payment_paid: st.payment ? !!st.payment.paid : false,
        payment_date: st.payment ? st.payment.payment_date : null
      }))
      setStudents(s)
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSavingAttendance(false)
    }
  }

  const savePayments = async () => {
    if (!activeAssignment) return
    setSavingPayments(true)
    try {
      const records = students.map(s => ({
        student_id: s.id,
        paid: s.payment_paid ? 1 : 0,
        payment_date: s.payment_date || null
      }))
      await axios.post('/api/payments/bulk', { activity_assignment_id: activeAssignment.id, records })
      alert('Payments saved')

      // refresh
      const res = await axios.get(`/api/activity_assignments/${activeAssignment.id}/students`)

      const s = (res.data.students ?? []).map(st => ({
        ...st,
        attendance_state: st.attendance ? st.attendance.status : 'absent',
        parent_present: st.attendance ? !!st.attendance.parent_present : false,
        payment_paid: st.payment ? !!st.payment.paid : false,
        payment_date: st.payment ? st.payment.payment_date : null
      }))
      setStudents(s)
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSavingPayments(false)
    }
  }

  const columns = [
    { field: 'lrn', headerName: 'LRN', width: 200 },
    { field: 'last_name', headerName: 'Last name', width: 160 },
    { field: 'first_name', headerName: 'First name', width: 160 },
    {
      field: 'parent_present',
      headerName: 'Parent Present',
      width: 140,
      sortable: false,
      filterable: false,
      renderCell: params => {
        return (
          <Checkbox
            checked={!!params.value}
            onChange={e => handleAttendanceChange(params.row.id, 'parent_present', e.target.checked)}
            inputProps={{ 'aria-label': 'parent present' }}
          />
        )
      }
    },
    {
      field: 'attendance_state',
      headerName: 'Attendance Status',
      width: 180,
      sortable: false,
      filterable: false,
      renderCell: params => {
        const val = params.value || 'absent'
        const bg = val === 'present' ? '#e8f5e9' : '#ffebee'

        return (
          <Box sx={{ width: '100%' }}>
            <TextField
              select
              size='small'
              value={val}
              onChange={e => handleAttendanceChange(params.row.id, 'attendance_state', e.target.value)}
              sx={{ minWidth: 140, backgroundColor: bg, borderRadius: 1 }}
            >
              <MenuItem value='present'>Present</MenuItem>
              <MenuItem value='absent'>Absent</MenuItem>
            </TextField>
          </Box>
        )
      }
    },
    {
      field: 'payment_paid',
      headerName: 'Payment',
      width: 110,
      sortable: false,
      filterable: false,
      renderCell: params => (
        <Checkbox
          checked={!!params.value}
          onChange={e => handleAttendanceChange(params.row.id, 'payment_paid', e.target.checked)}
          inputProps={{ 'aria-label': 'payment paid' }}
        />
      )
    },
    {
      field: 'payment_date',
      headerName: 'Payment Date',
      width: 190,
      renderCell: params => {
        const raw = params.value ?? ''

        // ensure ISO date for input value
        const value = raw ? dayjs(raw).format('YYYY-MM-DD') : ''

        return (
          <TextField
            type='date'
            size='small'
            value={value}
            onChange={e => handleAttendanceChange(params.row.id, 'payment_date', e.target.value || null)}
            InputLabelProps={{ shrink: true }}
          />
        )
      }
    }
  ]

  // assignments grid columns for the main page
  const assignmentColumns = [
    {
      field: 'title',
      headerName: 'Activity',
      flex: 1,
      width: 250,
      valueGetter: params => params.row.title || params.row.activity_title
    },
    {
      field: 'activity_date',
      headerName: 'Date',
      width: 120,
      valueGetter: p => (p.row.activity_date ? dayjs(p.row.activity_date).format('YYYY-MM-DD') : '')
    },
    { field: 'grade_name', headerName: 'Grade', width: 120 },
    { field: 'section_name', headerName: 'Section', width: 140 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 140,
      renderCell: params => (
        <Stack direction='row' spacing={1}>
          <Tooltip title='Open checklist'>
            <IconButton size='small' onClick={() => openAssignment(params.row)}>
              <OpenInNewIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    }
  ]

  return (
    <Box p={3}>
      {/* Header title for the page */}
      <Box display='flex' alignItems='center' mb={2}>
        <Typography variant='h5'>Attendance</Typography>
      </Box>

      <div style={{ height: 600, width: '100%' }}>
        <DataGrid
          rows={assignments}
          columns={assignmentColumns}
          pageSize={pageSize}
          rowCount={total}
          paginationMode='server'
          onPageChange={newPage => {
            setPage(newPage)
            fetchAssignments({ page: newPage })
          }}
          onPageSizeChange={newSize => {
            setPageSize(newSize)
            fetchAssignments({ page: 0, pageSize: newSize })
          }}
          getRowId={r => r.id}
          loading={loading}
        />
      </div>

      {/* Checklist Modal */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth='lg'>
        <DialogTitle>
          Checklist —{' '}
          {activeAssignment
            ? `${activeAssignment.title} (${activeAssignment.grade_name} - ${activeAssignment.section_name})`
            : ''}
        </DialogTitle>
        <DialogContent>
          <Box mb={2} display='flex' gap={2} alignItems='center'>
            <Button variant='contained' color='primary' onClick={saveAttendance} disabled={savingAttendance}>
              {savingAttendance ? 'Saving...' : 'Save Attendance'}
            </Button>
            <Button variant='contained' color='success' onClick={savePayments} disabled={savingPayments}>
              {savingPayments ? 'Saving...' : 'Save Payments'}
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant='caption'>Rows: {students.length}</Typography>
          </Box>

          <div style={{ height: 560, width: '100%' }}>
            <DataGrid
              rows={students}
              columns={columns}
              getRowId={r => r.id}
              disableSelectionOnClick
              hideFooterSelectedRowCount
              initialState={{ pagination: { pageSize: 25 } }}
              pageSizeOptions={[10, 25, 50]}
              experimentalFeatures={{ newEditingApi: true }}
            />
          </div>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

AttendancePage.acl = { action: 'read', subject: 'attendance-page' }
