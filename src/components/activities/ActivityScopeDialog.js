import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import axios from 'axios'

export default function ActivityScopeDialog({ open, activityId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      if (!open || !activityId) return
      setLoading(true)
      setError('')
      try {
        const res = await axios.get(`/api/activities/${activityId}/scope`)
        if (active) setData(res.data)
      } catch (err) {
        if (active) setError(err?.response?.data?.message || 'Failed to load activity scope')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
    }
  }, [open, activityId])

  const columns = [
    { field: 'grade_name', headerName: 'Grade', width: 130 },
    { field: 'section_name', headerName: 'Section', width: 150 },
    { field: 'enrolled_students', headerName: 'Enrolled', width: 110, type: 'number' },
    { field: 'attendance_records', headerName: 'Attendance Records', width: 155, type: 'number' },
    { field: 'payment_records', headerName: 'Payment Records', width: 145, type: 'number' },
    { field: 'contribution_records', headerName: 'Contribution Records', width: 175, type: 'number' },
    {
      field: 'status',
      headerName: 'Scope Status',
      width: 160,
      valueGetter: params => {
        const locked = Number(params.row.attendance_records || 0) + Number(params.row.payment_records || 0) + Number(params.row.contribution_records || 0)
        return locked > 0 ? 'Has records' : 'No records yet'
      },
      renderCell: params => (
        <Chip
          size='small'
          color={params.value === 'Has records' ? 'warning' : 'success'}
          label={params.value}
        />
      )
    }
  ]

  const rows = (data?.assignments || []).map(row => ({ id: row.assignment_id, ...row }))
  const hasRecords = Number(data?.totals?.locking_records || 0) > 0

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth='lg'>
      <DialogTitle>Activity Scope</DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Stack direction='row' alignItems='center' spacing={2}>
            <CircularProgress size={24} />
            <Typography>Loading scope...</Typography>
          </Stack>
        )}

        {error && <Alert severity='error'>{error}</Alert>}

        {!loading && data && (
          <Stack spacing={2}>
            <Box>
              <Typography variant='h6'>{data.activity?.title}</Typography>
              <Typography variant='body2' color='text.secondary'>
                Date: {data.activity?.activity_date} • School Year: {data.activity?.school_year_name}
              </Typography>
            </Box>

            {hasRecords ? (
              <Alert severity='warning'>
                This activity already has attendance/payment/contribution records. Changing its scope should be blocked or handled very carefully to avoid orphaned historical records.
              </Alert>
            ) : (
              <Alert severity='success'>This activity has no records yet. Its scope can still be safely edited.</Alert>
            )}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Chip label={`Assignments: ${data.totals?.assignments || 0}`} />
              <Chip label={`Expected Students: ${data.totals?.enrolled_students || 0}`} />
              <Chip color={hasRecords ? 'warning' : 'default'} label={`Historical Records: ${data.totals?.locking_records || 0}`} />
            </Stack>

            <DataGrid autoHeight rows={rows} columns={columns} disableRowSelectionOnClick pageSizeOptions={[10, 25, 50]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
