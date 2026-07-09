import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import axios from 'axios'

const entityTypes = [
  '',
  'activity',
  'activity_assignment',
  'attendance',
  'payment',
  'contribution',
  'student',
  'student_enrollment',
  'teacher',
  'teacher_section',
  'section',
  'school_year',
  'parent',
  'user'
]

export default function AuditLogsPage() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 })
  const [filters, setFilters] = useState({
    action: '',
    entity_type: '',
    entity_id: '',
    actor_user_id: '',
    from_date: '',
    to_date: ''
  })

  const fetchRows = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get('/api/audit-logs', {
        params: {
          page: paginationModel.page + 1,
          page_size: paginationModel.pageSize,
          ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''))
        }
      })
      setRows(data.rows || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginationModel.page, paginationModel.pageSize])

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }))

  const columns = [
    { field: 'created_at', headerName: 'Date/Time', width: 170 },
    { field: 'actor_name', headerName: 'Actor', width: 180 },
    { field: 'action', headerName: 'Action', width: 190 },
    {
      field: 'entity_type',
      headerName: 'Entity',
      width: 150,
      renderCell: params => <Chip size='small' label={params.value || 'N/A'} />
    },
    { field: 'entity_id', headerName: 'Entity ID', width: 100 },
    {
      field: 'details',
      headerName: 'Details',
      flex: 1,
      minWidth: 350,
      renderCell: params => (
        <Typography variant='caption' sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          {params.value ? JSON.stringify(params.value) : ''}
        </Typography>
      )
    }
  ]

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent='space-between' spacing={2}>
              <Box>
                <Typography variant='h5'>Audit Logs</Typography>
                <Typography variant='body2' color='text.secondary'>
                  Review sensitive actions such as activity edits, attendance, payments, assignments, and student movement.
                </Typography>
              </Box>
              <Button variant='outlined' onClick={fetchRows}>Refresh</Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Grid container spacing={2}>
              <Grid item xs={12} md={2}>
                <TextField fullWidth size='small' label='Action' value={filters.action} onChange={e => updateFilter('action', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField fullWidth select size='small' label='Entity Type' value={filters.entity_type} onChange={e => updateFilter('entity_type', e.target.value)}>
                  {entityTypes.map(type => <MenuItem key={type || 'all'} value={type}>{type || 'All'}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField fullWidth size='small' label='Entity ID' value={filters.entity_id} onChange={e => updateFilter('entity_id', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField fullWidth size='small' label='Actor User ID' value={filters.actor_user_id} onChange={e => updateFilter('actor_user_id', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField fullWidth size='small' type='date' label='From' InputLabelProps={{ shrink: true }} value={filters.from_date} onChange={e => updateFilter('from_date', e.target.value)} />
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField fullWidth size='small' type='date' label='To' InputLabelProps={{ shrink: true }} value={filters.to_date} onChange={e => updateFilter('to_date', e.target.value)} />
              </Grid>
              <Grid item xs={12}>
                <Stack direction='row' spacing={2}>
                  <Button variant='contained' onClick={() => { setPaginationModel(prev => ({ ...prev, page: 0 })); fetchRows() }}>Apply Filters</Button>
                  <Button variant='text' onClick={() => setFilters({ action: '', entity_type: '', entity_id: '', actor_user_id: '', from_date: '', to_date: '' })}>Clear</Button>
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Grid>

      {error && <Grid item xs={12}><Alert severity='error'>{error}</Alert></Grid>}

      <Grid item xs={12}>
        <Card>
          <DataGrid
            autoHeight
            rows={rows}
            columns={columns}
            rowCount={total}
            loading={loading}
            paginationMode='server'
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 25, 50, 100]}
            disableRowSelectionOnClick
          />
        </Card>
      </Grid>
    </Grid>
  )
}

AuditLogsPage.acl = {
  action: 'manage',
  subject: 'all'
}
