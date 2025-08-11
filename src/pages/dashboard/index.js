// src/pages/index.js (Updated dashboard with drill-down, exports, activities dropdown)
import { useState, useEffect, useContext, useMemo } from 'react'
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  TextField,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
  Divider,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  IconButton
} from '@mui/material'
import { AbilityContext } from 'src/layouts/components/acl/Can'
import UserDetails from 'src/views/pages/dashboard/UserDetails'
import axios from 'axios'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts'
import GetAppIcon from '@mui/icons-material/GetApp'
import VisibilityIcon from '@mui/icons-material/Visibility'

// export libs
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import TablePagination from '@mui/material/TablePagination'
import SearchIcon from '@mui/icons-material/Search'
import InputAdornment from '@mui/material/InputAdornment'

const COLORS = ['#2E86AB', '#F6C85F', '#F26419', '#7BC043', '#A52A2A', '#6A5ACD']

const Dashboard = () => {
  const ability = useContext(AbilityContext)

  // Overview & grade data
  const [overview, setOverview] = useState(null)
  const [byGrade, setByGrade] = useState([])
  const [activities, setActivities] = useState([])

  // filters
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // selected activity + section for summary and drill-down
  const [selectedActivityId, setSelectedActivityId] = useState('')
  const [selectedSectionId, setSelectedSectionId] = useState('')

  // activity summary (by section)
  const [activitySummary, setActivitySummary] = useState(null)
  const [loadingActivitySummary, setLoadingActivitySummary] = useState(false)

  // drilldown
  const [drillOpen, setDrillOpen] = useState(false)
  const [drillRows, setDrillRows] = useState([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState(null)

  const [loadingOverview, setLoadingOverview] = useState(false)
  const [loadingGrades, setLoadingGrades] = useState(false)
  const [loadingActivities, setLoadingActivities] = useState(false)

  const [errorOverview, setErrorOverview] = useState(null)
  const [errorGrades, setErrorGrades] = useState(null)

  // new state for drill pagination + search
  const [drillPage, setDrillPage] = useState(1)
  const [drillPageSize, setDrillPageSize] = useState(50)
  const [drillTotal, setDrillTotal] = useState(0)
  const [drillSearch, setDrillSearch] = useState('')

  // ---------- Fetchers ----------
  const fetchOverview = async () => {
    setLoadingOverview(true)
    setErrorOverview(null)
    try {
      const res = await axios.get('/api/summary', {
        params: { view: 'overview', from_date: fromDate || undefined, to_date: toDate || undefined }
      })
      setOverview(res.data)
    } catch (err) {
      setErrorOverview(err?.response?.data?.message ?? 'Failed to load overview')
    } finally {
      setLoadingOverview(false)
    }
  }

  const fetchByGrade = async () => {
    setLoadingGrades(true)
    setErrorGrades(null)
    try {
      const res = await axios.get('/api/summary', { params: { view: 'byGrade' } })
      setByGrade(res.data.grades ?? [])
    } catch (err) {
      setErrorGrades(err?.response?.data?.message ?? 'Failed to load grade data')
    } finally {
      setLoadingGrades(false)
    }
  }

  const fetchActivities = async () => {
    setLoadingActivities(true)
    try {
      const res = await axios.get('/api/activities', {
        params: { from_date: fromDate || undefined, to_date: toDate || undefined }
      })
      setActivities(res.data.activities ?? [])
    } catch (err) {
      console.error('Failed to load activities', err)
    } finally {
      setLoadingActivities(false)
    }
  }

  // load activity summary (attendance/payments grouped by section)
  const loadActivitySummary = async activityId => {
    if (!activityId) return
    setLoadingActivitySummary(true)
    setActivitySummary(null)
    try {
      const res = await axios.get('/api/summary', { params: { view: 'byActivity', activity_id: activityId } })
      setActivitySummary(res.data)
    } catch (err) {
      console.error('loadActivitySummary', err)
    } finally {
      setLoadingActivitySummary(false)
    }
  }

  // drill-down: fetch student rows for an activity + section
  const openDrillDown = async (activityId, sectionId, page = 1, page_size = drillPageSize, search = drillSearch) => {
    setDrillLoading(true)
    setDrillRows([])
    setDrillError(null)
    setDrillOpen(true)
    setSelectedActivityId(activityId)
    setSelectedSectionId(sectionId)
    setDrillPage(page)
    setDrillSearch(search)

    try {
      const res = await axios.get('/api/activity/details', {
        params: { activity_id: activityId, section_id: sectionId, page, page_size, search }
      })
      setDrillRows(res.data.students ?? [])
      setDrillTotal(res.data.total ?? 0)
    } catch (err) {
      setDrillError(err?.response?.data?.message ?? 'Failed to load details')
    } finally {
      setDrillLoading(false)
    }
  }

  // handlers for pagination and search
  const handleDrillPageChange = (event, newPage) => {
    const page = newPage + 1 // MUI is 0-based
    setDrillPage(page)
    openDrillDown(selectedActivityId, selectedSectionId, page, drillPageSize, drillSearch)
  }

  const handleDrillPageSizeChange = event => {
    const size = parseInt(event.target.value, 10)
    setDrillPageSize(size)
    setDrillPage(1)
    openDrillDown(selectedActivityId, selectedSectionId, 1, size, drillSearch)
  }

  const handleDrillSearch = value => {
    setDrillSearch(value)
    setDrillPage(1)
    openDrillDown(selectedActivityId, selectedSectionId, 1, drillPageSize, value)
  }

  // server export (calls server endpoint and downloads blob)
  const serverExportActivity = async (format = 'csv') => {
    if (!selectedActivityId) return

    const params = new URLSearchParams({
      activity_id: selectedActivityId,
      section_id: selectedSectionId || '',
      format,
      search: drillSearch || ''
    })
    try {
      const res = await axios.get(`/api/export/activity?${params.toString()}`, {
        responseType: 'blob'
      })
      const contentDisposition = res.headers['content-disposition'] || ''
      const filenameMatch = contentDisposition.match(/filename=([^;]+)/)
      const filename = filenameMatch ? filenameMatch[1].replace(/["']/g, '') : `export.${format}`
      saveAs(res.data, filename)
    } catch (err) {
      console.error('Export failed', err)
    }
  }

  // table exports
  const exportTableToCSV = (rows, filename = 'export.csv') => {
    if (!rows || !rows.length) return
    const header = Object.keys(rows[0])
    const csv = [header.join(',')]
    for (const r of rows) {
      csv.push(
        header
          .map(h => {
            const val = r[h] ?? ''

            // escape quotes and commas
            if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
              return `"${val.replace(/"/g, '""')}"`
            }

            return val
          })
          .join(',')
      )
    }
    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' })
    saveAs(blob, filename)
  }

  const exportTableToXLSX = (rows, filename = 'export.xlsx') => {
    if (!rows || !rows.length) return
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([wbout], { type: 'application/octet-stream' }), filename)
  }

  const exportTableToPDF = (rows, filename = 'export.pdf', title = '') => {
    if (!rows || !rows.length) return
    const doc = new jsPDF()
    const header = Object.keys(rows[0])
    const body = rows.map(r => header.map(h => r[h] ?? ''))
    doc.text(title || filename, 14, 20)
    // eslint-disable-next-line no-underscore-dangle
    doc.autoTable({ head: [header], body, startY: 26 })
    doc.save(filename)
  }

  // flatten sections for chart
  const flattenedSections = useMemo(() => {
    const out = []
    for (const g of byGrade) {
      for (const s of g.sections) {
        out.push({
          grade_id: g.grade_id,
          grade_name: g.grade_name,
          section_id: s.section_id,
          section_name: s.section_name ?? '—',
          students: Number(s.total_students ?? 0),
          label: `${g.grade_name} • ${s.section_name ?? '—'}`
        })
      }
    }

    return out
  }, [byGrade])

  // initial load & when date filters change
  useEffect(() => {
    fetchOverview()
    fetchByGrade()
    fetchActivities()
  }, [fromDate, toDate])

  // ---------- UI ----------
  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Stack direction='row' spacing={2} alignItems='center' justifyContent='space-between' sx={{ mb: 2 }}>
          <Box display='flex' gap={2} alignItems='center'>
            <TextField
              label='From'
              type='date'
              size='small'
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label='To'
              type='date'
              size='small'
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Button
              variant='outlined'
              onClick={() => {
                setFromDate('')
                setToDate('')
              }}
            >
              Clear
            </Button>
          </Box>

          <Box>
            <Button
              onClick={() => {
                fetchOverview()
                fetchByGrade()
                fetchActivities()
              }}
              variant='contained'
            >
              Refresh
            </Button>
          </Box>
        </Stack>

        <Grid container spacing={3}>
          {/* Overview cards (same as earlier) */}
          {ability?.can('read', 'total_students') && (
            <Grid item xs={12} sm={6} md={2.4}>
              <UserDetails
                icon='mdi:account-group-outline'
                color='primary'
                count={loadingOverview ? <CircularProgress size={20} /> : overview?.total_students ?? 0}
                title='Total Students'
              />
            </Grid>
          )}
          {ability?.can('read', 'total_activities') && (
            <Grid item xs={12} sm={6} md={2.4}>
              <UserDetails
                icon='mdi:calendar-check'
                color='primary'
                count={loadingOverview ? <CircularProgress size={20} /> : overview?.total_activities ?? 0}
                title='Total Activities'
              />
            </Grid>
          )}
          {ability?.can('read', 'attendance') && (
            <>
              <Grid item xs={12} sm={6} md={2.4}>
                <UserDetails
                  icon='mdi:account-check'
                  color='success'
                  count={loadingOverview ? <CircularProgress size={20} /> : overview?.attendance?.total_present ?? 0}
                  title='Total Present'
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2.4}>
                <UserDetails
                  icon='mdi:account-cancel'
                  color='error'
                  count={loadingOverview ? <CircularProgress size={20} /> : overview?.attendance?.total_absent ?? 0}
                  title='Total Absent'
                />
              </Grid>
            </>
          )}
          {ability?.can('read', 'payments') && (
            <>
              <Grid item xs={12} sm={6} md={2.4}>
                <UserDetails
                  icon='mdi:cash-check'
                  color='success'
                  count={loadingOverview ? <CircularProgress size={20} /> : overview?.payments?.total_paid ?? 0}
                  title='Total Paid'
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2.4}>
                <UserDetails
                  icon='mdi:cash-remove'
                  color='warning'
                  count={loadingOverview ? <CircularProgress size={20} /> : overview?.payments?.total_unpaid ?? 0}
                  title='Total Unpaid'
                />
              </Grid>
            </>
          )}
        </Grid>
      </Grid>

      {/* main charts and table */}
      <Grid item xs={12} md={8}>
        <Card>
          <CardContent>
            <Typography variant='h6' gutterBottom>
              Students by Section
            </Typography>
            {loadingGrades ? (
              <Box display='flex' justifyContent='center' p={4}>
                <CircularProgress />
              </Box>
            ) : errorGrades ? (
              <Alert severity='error'>{errorGrades}</Alert>
            ) : (
              <>
                <Box height={320}>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart data={flattenedSections} margin={{ top: 20, right: 20, left: 10, bottom: 60 }}>
                      <XAxis dataKey='label' interval={0} angle={-40} textAnchor='end' height={80} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey='students'>
                        {flattenedSections.map((e, i) => (
                          <Cell key={`c-${i}`} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box display='flex' justifyContent='space-between' alignItems='center' sx={{ mb: 1 }}>
                  <Typography variant='subtitle2'>Breakdown (grade → section)</Typography>
                  <Box>
                    <Button
                      size='small'
                      startIcon={<GetAppIcon />}
                      onClick={() =>
                        exportTableToCSV(
                          byGrade.flatMap(g =>
                            g.sections.map(s => ({
                              grade: g.grade_name,
                              section: s.section_name ?? '—',
                              students: s.total_students
                            }))
                          ),
                          'sections.csv'
                        )
                      }
                    >
                      CSV
                    </Button>

                    <Button
                      size='small'
                      startIcon={<GetAppIcon />}
                      onClick={() =>
                        exportTableToXLSX(
                          byGrade.flatMap(g =>
                            g.sections.map(s => ({
                              grade: g.grade_name,
                              section: s.section_name ?? '—',
                              students: s.total_students
                            }))
                          ),
                          'sections.xlsx'
                        )
                      }
                    >
                      XLSX
                    </Button>

                    <Button
                      size='small'
                      startIcon={<GetAppIcon />}
                      onClick={() =>
                        exportTableToPDF(
                          byGrade.flatMap(g =>
                            g.sections.map(s => ({
                              grade: g.grade_name,
                              section: s.section_name ?? '—',
                              students: s.total_students
                            }))
                          ),
                          'sections.pdf',
                          'Sections - Students'
                        )
                      }
                    >
                      PDF
                    </Button>
                  </Box>
                </Box>

                <Box sx={{ maxHeight: 280, overflow: 'auto' }}>
                  <Table size='small'>
                    <TableHead>
                      <TableRow>
                        <TableCell>Grade</TableCell>
                        <TableCell>Section</TableCell>
                        <TableCell align='right'>Students</TableCell>
                        <TableCell align='right'>Details</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {byGrade.map(g =>
                        g.sections.map(s => (
                          <TableRow key={`${g.grade_id}-${s.section_id}`}>
                            <TableCell>{g.grade_name}</TableCell>
                            <TableCell>{s.section_name ?? '—'}</TableCell>
                            <TableCell align='right'>{s.total_students ?? 0}</TableCell>
                            <TableCell align='right'>
                              <IconButton
                                size='small'
                                onClick={() => openDrillDown(selectedActivityId || activities[0]?.id, s.section_id)}
                              >
                                <VisibilityIcon fontSize='small' />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </Box>
              </>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* payments + activity summary */}
      <Grid item xs={12} md={4}>
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant='h6' gutterBottom>
              Payments Overview
            </Typography>
            <Box height={220}>
              <ResponsiveContainer width='100%' height='100%'>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Paid', value: overview?.payments?.total_paid ?? 0 },
                      { name: 'Unpaid', value: overview?.payments?.total_unpaid ?? 0 }
                    ]}
                    dataKey='value'
                    nameKey='name'
                    innerRadius={50}
                    outerRadius={80}
                    label
                  >
                    <Cell fill='#7BC043' />
                    <Cell fill='#F26419' />
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <Stack direction='row' spacing={1} mt={1}>
              <Typography variant='body2'>
                Paid: <strong>{overview?.payments?.total_paid ?? 0}</strong>
              </Typography>
              <Typography variant='body2' sx={{ ml: 2 }}>
                Unpaid: <strong>{overview?.payments?.total_unpaid ?? 0}</strong>
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant='h6' gutterBottom>
              Activity Summary (by Section)
            </Typography>

            <Stack spacing={1} sx={{ mb: 2 }}>
              <TextField
                select
                size='small'
                label='Select Activity'
                value={selectedActivityId}
                onChange={e => {
                  setSelectedActivityId(e.target.value)
                  loadActivitySummary(e.target.value)
                }}
              >
                <MenuItem value=''>-- choose --</MenuItem>
                {activities.map(a => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.activity_date} — {a.title}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                size='small'
                label='Filter section (optional)'
                value={selectedSectionId}
                onChange={e => setSelectedSectionId(e.target.value)}
              >
                <MenuItem value=''>All sections</MenuItem>
                {flattenedSections.map(s => (
                  <MenuItem key={s.section_id} value={s.section_id}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>

              <Box display='flex' gap={1}>
                <Button
                  variant='contained'
                  disabled={!selectedActivityId}
                  onClick={() => loadActivitySummary(selectedActivityId)}
                >
                  {loadingActivitySummary ? <CircularProgress size={20} /> : 'Load'}
                </Button>

                <Button
                  variant='outlined'
                  startIcon={<GetAppIcon />}
                  disabled={!activitySummary}
                  onClick={() => {
                    // export attendance summary (combine both attendance_by_section and payments_by_section nicely)
                    const att = (activitySummary?.attendance_by_section ?? []).map(r => ({
                      grade_id: r.grade_id,
                      section: r.section_name,
                      present: r.present_count ?? 0,
                      absent: r.absent_count ?? 0,
                      parent_present: r.parent_present_count ?? 0
                    }))
                    exportTableToCSV(att, 'activity_attendance.csv')
                  }}
                >
                  Export Attendance CSV
                </Button>
              </Box>
            </Stack>

            {loadingActivitySummary ? (
              <Box display='flex' justifyContent='center' p={2}>
                <CircularProgress />
              </Box>
            ) : activitySummary ? (
              <>
                <Typography variant='subtitle2'>Attendance by Section</Typography>
                <Box sx={{ maxHeight: 180, overflow: 'auto', mb: 1 }}>
                  <Table size='small'>
                    <TableHead>
                      <TableRow>
                        <TableCell>Grade</TableCell>
                        <TableCell>Section</TableCell>
                        <TableCell align='right'>Present</TableCell>
                        <TableCell align='right'>Absent</TableCell>
                        <TableCell align='right'>Parent Present</TableCell>
                        <TableCell align='right'>Details</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {activitySummary.attendance_by_section?.map((r, idx) => (
                        <TableRow key={`a-${idx}`}>
                          <TableCell>{r.grade_id}</TableCell>
                          <TableCell>{r.section_name}</TableCell>
                          <TableCell align='right'>{r.present_count ?? 0}</TableCell>
                          <TableCell align='right'>{r.absent_count ?? 0}</TableCell>
                          <TableCell align='right'>{r.parent_present_count ?? 0}</TableCell>
                          <TableCell align='right'>
                            <Button size='small' onClick={() => openDrillDown(selectedActivityId, r.section_id)}>
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>

                <Divider sx={{ my: 1 }} />

                <Typography variant='subtitle2'>Payments by Section</Typography>
                <Box sx={{ maxHeight: 180, overflow: 'auto' }}>
                  <Table size='small'>
                    <TableHead>
                      <TableRow>
                        <TableCell>Grade</TableCell>
                        <TableCell>Section</TableCell>
                        <TableCell align='right'>Paid</TableCell>
                        <TableCell align='right'>Unpaid</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {activitySummary.payments_by_section?.map((r, idx) => (
                        <TableRow key={`p-${idx}`}>
                          <TableCell>{r.grade_id}</TableCell>
                          <TableCell>{r.section_name}</TableCell>
                          <TableCell align='right'>{r.paid_count ?? 0}</TableCell>
                          <TableCell align='right'>{r.unpaid_count ?? 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </>
            ) : (
              <Typography variant='body2' color='text.secondary'>
                Choose an activity and press <strong>Load</strong> to view attendance/payment breakdown.
              </Typography>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* Drill-down modal */}
      <Dialog fullWidth maxWidth='lg' open={drillOpen} onClose={() => setDrillOpen(false)}>
        <DialogTitle>
          Student Details (Activity {selectedActivityId} — Section {selectedSectionId})
        </DialogTitle>
        <DialogContent>
          <Box display='flex' justifyContent='space-between' sx={{ mb: 1 }}>
            <TextField
              size='small'
              placeholder='Search by name or LRN'
              value={drillSearch}
              onChange={e => handleDrillSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position='start'>
                    <SearchIcon />
                  </InputAdornment>
                )
              }}
            />

            <Box>
              <Button size='small' sx={{ mr: 1 }} onClick={() => serverExportActivity('csv')}>
                Export CSV
              </Button>
              <Button size='small' sx={{ mr: 1 }} onClick={() => serverExportActivity('xlsx')}>
                Export XLSX
              </Button>
              <Button size='small' onClick={() => serverExportActivity('pdf')}>
                Export PDF
              </Button>
            </Box>
          </Box>

          {drillLoading ? (
            <Box display='flex' justifyContent='center' p={4}>
              <CircularProgress />
            </Box>
          ) : drillError ? (
            <Alert severity='error'>{drillError}</Alert>
          ) : (
            <>
              <Table size='small'>
                <TableHead>
                  <TableRow>
                    <TableCell>LRN</TableCell>
                    <TableCell>Student</TableCell>
                    <TableCell>Parents</TableCell>
                    <TableCell>Attendance</TableCell>
                    <TableCell>Parent Present</TableCell>
                    <TableCell>Paid</TableCell>
                    <TableCell>Payment Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {drillRows.map((r, i) => (
                    <TableRow key={`dr-${i}`}>
                      <TableCell>{r.lrn}</TableCell>
                      <TableCell>
                        {r.last_name}, {r.first_name}
                      </TableCell>
                      <TableCell>{r.parents ?? ''}</TableCell>
                      <TableCell>{r.attendance_status ?? '—'}</TableCell>
                      <TableCell>{r.parent_present ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{r.payment_paid === 1 ? 'Yes' : r.payment_paid === 0 ? 'No' : '—'}</TableCell>
                      <TableCell>{r.payment_date ? new Date(r.payment_date).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <TablePagination
                component='div'
                count={drillTotal}
                page={drillPage - 1}
                onPageChange={handleDrillPageChange}
                rowsPerPage={drillPageSize}
                onRowsPerPageChange={handleDrillPageSizeChange}
                rowsPerPageOptions={[10, 25, 50, 100]}
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDrillOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Grid>
  )
}

Dashboard.acl = { action: 'read', subject: 'dashboard' }

export default Dashboard
