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
  Stack,
  IconButton,
  Tooltip,
  Typography,
  Select,
  InputLabel,
  FormControl
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import axios from 'axios'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import dayjs from 'dayjs'

const CONTRIB_TYPES = [
  { value: '', label: '— Select —' },
  { value: 'service', label: 'Service' },
  { value: 'materials', label: 'Materials' },
  { value: 'labor', label: 'Labor' },
  { value: 'other', label: 'Other' }
]

export default function AttendancePage() {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeAssignment, setActiveAssignment] = useState(null)

  // students rows come with attendance, payment and contributions aggregates
  const [students, setStudents] = useState([])
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [savingPayments, setSavingPayments] = useState(false)
  const [savingContribs, setSavingContribs] = useState(false)

  useEffect(() => {
    fetchAssignments()
  }, [page, pageSize])

  const fetchAssignments = async (opts = {}) => {
    setLoading(true)
    try {
      const params = {
        page: (opts.page ?? page) + 1,
        page_size: opts.pageSize ?? pageSize
      }
      Object.keys(params).forEach(k => (params[k] == null || params[k] === '') && delete params[k])
      const res = await axios.get('/api/activity_assignments', { params })
      setAssignments(res.data.assignments ?? [])
      setTotal(res.data.total ?? 0)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const openAssignment = async assignment => {
    setActiveAssignment(assignment)
    setDialogOpen(true)
    try {
      const res = await axios.get(`/api/activity_assignments/${assignment.id}/students`)

      const s = (res.data.students ?? []).map(st => ({
        ...st,

        // attendance defaults
        attendance_state: st.attendance ? st.attendance.status : 'absent',
        parent_present: st.attendance ? !!st.attendance.parent_present : false,

        // payments defaults (now supports amount)
        payment_paid: st.payment ? !!st.payment.paid : false,
        payment_amount: st.payment?.amount ?? '',
        payment_date: st.payment?.payment_date ?? null,

        // contribution quick-entry (new row to be created on save)
        contrib_type: '',
        contrib_description: '',
        contrib_estimated_value: '',
        contrib_hours_worked: '',
        contrib_materials_details: ''
      }))
      setStudents(s)

      // stash fee visibility signals on assignment object for UI
      setActiveAssignment(prev => ({
        ...prev,
        payments_enabled: !!(res.data.payments_enabled ?? 0),
        fee_type: res.data.fee_type || 'fee',
        fee_amount: res.data.fee_amount ?? null
      }))
    } catch (err) {
      console.error(err)
      alert('Failed to load students for this assignment')
      setDialogOpen(false)
    }
  }

  const handleChange = (studentId, field, value) => {
    setStudents(prev =>
      prev.map(s => {
        if (s.id !== studentId) return s
        let next = { ...s, [field]: value }

        // If fee-only and paid toggled on, clear quick-entry contribution fields
        if (field === 'payment_paid' && value === true && activeAssignment?.fee_type === 'fee') {
          next = {
            ...next,
            contrib_type: '',
            contrib_description: '',
            contrib_estimated_value: '',
            contrib_hours_worked: '',
            contrib_materials_details: ''
          }
        }

        return next
      })
    )
  }

  const saveAttendance = async () => {
    if (!activeAssignment) return
    setSavingAttendance(true)
    try {
      const records = students.map(s => ({
        student_id: s.id,
        status: s.attendance_state === 'present' ? 'present' : 'absent',
        parent_present: s.parent_present ? 1 : 0
      }))
      await axios.post('/api/attendance/bulk', { activity_assignment_id: activeAssignment.id, records })
      await refreshStudents()
      alert('Attendance saved')
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
        amount: s.payment_amount === '' || s.payment_amount == null ? null : Number(s.payment_amount),
        payment_date: s.payment_date || null
      }))
      await axios.post('/api/payments/bulk', { activity_assignment_id: activeAssignment.id, records })
      await refreshStudents()
      alert('Payments saved')
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSavingPayments(false)
    }
  }

  const saveContributions = async () => {
    if (!activeAssignment) return
    setSavingContribs(true)
    try {
      // only send rows where at least one field is filled in
      const records = students
        .filter(
          s =>
            s.contrib_type &&
            Boolean(
              s.contrib_description ||
                s.contrib_estimated_value ||
                s.contrib_hours_worked ||
                s.contrib_materials_details
            )
        )
        .map(s => ({
          student_id: s.id,
          contribution_type: s.contrib_type,
          description: s.contrib_description || null,
          estimated_value:
            s.contrib_estimated_value === '' || s.contrib_estimated_value == null
              ? null
              : Number(s.contrib_estimated_value),
          hours_worked:
            s.contrib_hours_worked === '' || s.contrib_hours_worked == null ? null : Number(s.contrib_hours_worked),
          materials_details: s.contrib_materials_details || null
        }))

      if (!records.length) {
        alert('Nothing to save. Enter contribution details first.')
        setSavingContribs(false)

        return
      }

      await axios.post('/api/contributions/bulk', { activity_assignment_id: activeAssignment.id, records })
      await refreshStudents()

      // clear quick-entry fields
      setStudents(prev =>
        prev.map(s => ({
          ...s,
          contrib_type: 'service',
          contrib_description: '',
          contrib_estimated_value: '',
          contrib_hours_worked: '',
          contrib_materials_details: ''
        }))
      )
      alert('Contributions saved')
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSavingContribs(false)
    }
  }

  const refreshStudents = async () => {
    const res = await axios.get(`/api/activity_assignments/${activeAssignment.id}/students`)

    const s = (res.data.students ?? []).map(st => ({
      ...st,
      attendance_state: st.attendance ? st.attendance.status : 'absent',
      parent_present: st.attendance ? !!st.attendance.parent_present : false,
      payment_paid: st.payment ? !!st.payment.paid : false,
      payment_amount: st.payment?.amount ?? '',
      payment_date: st.payment?.payment_date ?? null,
      contrib_type: 'service',
      contrib_description: '',
      contrib_estimated_value: '',
      contrib_hours_worked: '',
      contrib_materials_details: ''
    }))
    setStudents(s)
    setActiveAssignment(prev => ({
      ...prev,
      payments_enabled: !!(res.data.payments_enabled ?? 0),
      fee_type: res.data.fee_type || prev?.fee_type || 'fee',
      fee_amount: res.data.fee_amount ?? prev?.fee_amount ?? null
    }))
  }

  // Visibility controls based on activity
  const feeType = activeAssignment?.fee_type || 'fee'
  const showPayments = !!activeAssignment?.payments_enabled && (feeType === 'fee' || feeType === 'mixed')
  const showContribs = feeType === 'donation' || feeType === 'service' || feeType === 'mixed'

  const baseColumns = [
    { field: 'lrn', headerName: 'LRN', width: 180 },
    { field: 'last_name', headerName: 'Last name', width: 160 },
    { field: 'first_name', headerName: 'First name', width: 160 },
    {
      field: 'parent_present',
      headerName: 'Parent Present',
      width: 140,
      sortable: false,
      filterable: false,
      renderCell: params => (
        <Checkbox
          checked={!!params.value}
          onChange={e => handleChange(params.row.id, 'parent_present', e.target.checked)}
        />
      )
    },
    {
      field: 'attendance_state',
      headerName: 'Student Present',
      width: 160,
      sortable: false,
      filterable: false,
      renderCell: params => (
        <Checkbox
          checked={params.value === 'present'}
          onChange={e => handleChange(params.row.id, 'attendance_state', e.target.checked ? 'present' : 'absent')}
        />
      )
    }
  ]

  const paymentColumns = [
    {
      field: 'payment_paid',
      headerName: 'Paid',
      width: 90,
      sortable: false,
      filterable: false,
      renderCell: params => (
        <Checkbox
          checked={!!params.value}
          onChange={e => handleChange(params.row.id, 'payment_paid', e.target.checked)}
        />
      )
    },
    {
      field: 'payment_amount',
      headerName: 'Amount Paid',
      width: 130,
      sortable: false,
      filterable: false,
      renderCell: params => (
        <TextField
          size='small'
          type='number'
          inputProps={{ step: '0.01', min: '0' }}
          value={params.value ?? ''}
          onChange={e => handleChange(params.row.id, 'payment_amount', e.target.value)}
        />
      )
    },
    {
      field: 'payment_date',
      headerName: 'Payment Date',
      width: 160,
      renderCell: params => {
        const raw = params.value ?? ''
        const value = raw ? dayjs(raw).format('YYYY-MM-DD') : ''

        return (
          <TextField
            type='date'
            size='small'
            value={value}
            onChange={e => handleChange(params.row.id, 'payment_date', e.target.value || null)}
            InputLabelProps={{ shrink: true }}
          />
        )
      }
    }
  ]

  const contributionColumns = [
    {
      field: 'contrib_type',
      headerName: 'Contrib. Type',
      width: 150,
      renderCell: params => (
        <FormControl size='small' fullWidth>
          <Select
            displayEmpty
            value={params.value ?? ''}
            onChange={e => handleChange(params.row.id, 'contrib_type', e.target.value)}
          >
            {CONTRIB_TYPES.map(ct => (
              <MenuItem key={ct.value} value={ct.value}>
                {ct.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )
    },
    {
      field: 'contrib_estimated_value',
      headerName: 'Est. Value',
      width: 120,
      renderCell: params => (
        <TextField
          size='small'
          type='number'
          inputProps={{ step: '0.01', min: '0' }}
          value={params.value ?? ''}
          onChange={e => handleChange(params.row.id, 'contrib_estimated_value', e.target.value)}
        />
      )
    },
    {
      field: 'contrib_hours_worked',
      headerName: 'Hours',
      width: 100,
      renderCell: params => (
        <TextField
          size='small'
          type='number'
          inputProps={{ step: '0.25', min: '0' }}
          value={params.value ?? ''}
          onChange={e => handleChange(params.row.id, 'contrib_hours_worked', e.target.value)}
        />
      )
    },
    {
      field: 'contrib_materials_details',
      headerName: 'Materials',
      width: 180,
      renderCell: params => (
        <TextField
          size='small'
          value={params.value ?? ''}
          onChange={e => handleChange(params.row.id, 'contrib_materials_details', e.target.value)}
        />
      )
    },
    {
      field: 'contrib_description',
      headerName: 'Description',
      flex: 1,
      minWidth: 220,
      renderCell: params => (
        <TextField
          size='small'
          value={params.value ?? ''}
          onChange={e => handleChange(params.row.id, 'contrib_description', e.target.value)}
        />
      )
    }
  ]

  const isContribLocked = row => activeAssignment?.fee_type === 'fee' && !!row.payment_paid

  const columns = [
    ...baseColumns,
    ...(showPayments ? paymentColumns : []),
    ...(showContribs ? contributionColumns : [])
  ]

  const assignmentColumns = [
    {
      field: 'title',
      headerName: 'Activity',
      flex: 1,
      width: 250,
      valueGetter: p => p.row.title || p.row.activity_title
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
      width: 120,
      renderCell: params => (
        <Tooltip title='Open checklist'>
          <IconButton size='small' onClick={() => openAssignment(params.row)}>
            <OpenInNewIcon />
          </IconButton>
        </Tooltip>
      )
    }
  ]

  return (
    <Box p={3}>
      <Box display='flex' alignItems='center' mb={2}>
        <Typography variant='h5'>Attendance & Contributions</Typography>
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth='xl'>
        <DialogTitle>
          Checklist —{' '}
          {activeAssignment
            ? `${activeAssignment.title} (${activeAssignment.grade_name} - ${activeAssignment.section_name})`
            : ''}
        </DialogTitle>
        <DialogContent>
          <Box mb={2} display='flex' gap={2} alignItems='center' flexWrap='wrap'>
            <Button variant='contained' onClick={saveAttendance} disabled={savingAttendance}>
              {savingAttendance ? 'Saving...' : 'Save Attendance'}
            </Button>
            {showPayments && (
              <Button variant='contained' color='success' onClick={savePayments} disabled={savingPayments}>
                {savingPayments ? 'Saving...' : 'Save Payments'}
              </Button>
            )}
            {showContribs && (
              <Button variant='contained' color='secondary' onClick={saveContributions} disabled={savingContribs}>
                {savingContribs ? 'Saving...' : 'Save Contributions'}
              </Button>
            )}
            <Box sx={{ flexGrow: 1 }} />
            {showPayments && activeAssignment?.fee_amount != null && (
              <Typography variant='body2'>Fee Amount: {Number(activeAssignment.fee_amount).toFixed(2)}</Typography>
            )}
            <Typography variant='caption'>Rows: {students.length}</Typography>
          </Box>

          <div style={{ height: 580, width: '100%' }}>
            <DataGrid
              rows={students}
              columns={columns}
              getRowId={r => r.id}
              disableSelectionOnClick
              hideFooterSelectedRowCount
              initialState={{ pagination: { pageSize: 25 } }}
              pageSizeOptions={[10, 25, 50]}
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
