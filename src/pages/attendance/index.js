// pages/attendance.js
import { useEffect, useState, useCallback } from 'react'
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
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Stack,
  IconButton,
  Tooltip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import axios from 'axios'
import { useSession } from 'next-auth/react'
import debounce from 'lodash.debounce'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

export default function AttendancePage() {
  const { data: session } = useSession()
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')

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
        search: opts.search ?? search,
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

  const debouncedSearch = useCallback(
    debounce(v => {
      setPage(0)
      fetchAssignments({ search: v, page: 0 })
    }, 400),
    []
  )

  const onSearchChange = e => {
    const v = e.target.value
    setSearch(v)
    debouncedSearch(v)
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

  const handleAttendanceChange = (idx, field, value) => {
    setStudents(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }

      return next
    })
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
    { field: 'id', headerName: 'ID', width: 80 },
    {
      field: 'title',
      headerName: 'Activity',
      flex: 1,
      valueGetter: params => params.row.title || params.row.activity_title
    },
    { field: 'activity_date', headerName: 'Date', width: 120 },
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
      <Box display='flex' alignItems='center' gap={2} mb={2}>
        <TextField
          size='small'
          placeholder='Search activity title...'
          value={search}
          onChange={onSearchChange}
          sx={{ minWidth: 320 }}
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button variant='contained' onClick={() => (window.location.href = '/activities')}>
          Manage Activities
        </Button>
      </Box>

      <div style={{ height: 600, width: '100%' }}>
        <DataGrid
          rows={assignments}
          columns={columns}
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
          <Box mb={2} display='flex' gap={2}>
            <Button variant='contained' color='primary' onClick={saveAttendance} disabled={savingAttendance}>
              {savingAttendance ? 'Saving...' : 'Save Attendance'}
            </Button>
            <Button variant='contained' color='success' onClick={savePayments} disabled={savingPayments}>
              {savingPayments ? 'Saving...' : 'Save Payments'}
            </Button>
          </Box>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>LRN</TableCell>
                <TableCell>Last name</TableCell>
                <TableCell>First name</TableCell>
                <TableCell>Parent Present</TableCell>
                <TableCell>Attendance Status</TableCell>
                <TableCell>Payment</TableCell>
                <TableCell>Payment Date</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {students.map((s, idx) => (
                <TableRow key={s.id}>
                  <TableCell>{s.lrn}</TableCell>
                  <TableCell>{s.last_name}</TableCell>
                  <TableCell>{s.first_name}</TableCell>
                  <TableCell>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!s.parent_present}
                          onChange={e => handleAttendanceChange(idx, 'parent_present', e.target.checked)}
                        />
                      }
                      label=''
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      size='small'
                      value={s.attendance_state}
                      onChange={e => handleAttendanceChange(idx, 'attendance_state', e.target.value)}
                      sx={{
                        minWidth: 140,

                        // color coding via background
                        ...(s.attendance_state === 'present'
                          ? { backgroundColor: '#e8f5e9' }
                          : { backgroundColor: '#ffebee' })
                      }}
                    >
                      <MenuItem value='present'>Present</MenuItem>
                      <MenuItem value='absent'>Absent</MenuItem>
                    </TextField>
                  </TableCell>

                  <TableCell>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!s.payment_paid}
                          onChange={e => handleAttendanceChange(idx, 'payment_paid', e.target.checked)}
                        />
                      }
                      label=''
                    />
                  </TableCell>

                  <TableCell>
                    <TextField
                      type='date'
                      size='small'
                      value={s.payment_date ?? ''}
                      onChange={e => handleAttendanceChange(idx, 'payment_date', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

AttendancePage.acl = { action: 'read', subject: 'attendance-page' }
