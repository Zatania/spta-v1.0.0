// src/pages/index.js
import { useState, useEffect, useContext, useMemo, useRef } from 'react'
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
  Chip,
  Breadcrumbs,
  Link,
  InputAdornment
} from '@mui/material'
import { AbilityContext } from 'src/layouts/components/acl/Can'
import UserDetails from 'src/views/pages/dashboard/UserDetails'
import axios from 'axios'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts'
import GetAppIcon from '@mui/icons-material/GetApp'
import VisibilityIcon from '@mui/icons-material/Visibility'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import HomeIcon from '@mui/icons-material/Home'
import SchoolIcon from '@mui/icons-material/School'
import EventIcon from '@mui/icons-material/Event'
import PeopleIcon from '@mui/icons-material/People'
import SearchIcon from '@mui/icons-material/Search'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import TablePagination from '@mui/material/TablePagination'

const COLORS = ['#2E86AB', '#F6C85F', '#F26419', '#7BC043', '#A52A2A', '#6A5ACD']

const paymentColors = {
  Paid: '#7BC043',
  Unpaid: '#F26419'
}

// View types
const VIEW_TYPES = {
  OVERVIEW: 'overview',
  SECTIONS: 'sections',
  ACTIVITIES: 'activities',
  STUDENTS: 'students'
}

const PAYMENTS_LEVELS = {
  OVERVIEW: 'overview',
  BY_GRADE: 'byGrade',
  BY_SECTION: 'bySection'
}

const Dashboard = () => {
  const ability = useContext(AbilityContext)

  // Overview & grade data
  const [overview, setOverview] = useState(null)
  const [byGrade, setByGrade] = useState([])
  const [grades, setGrades] = useState([])

  // filters
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Navigation state
  const [currentView, setCurrentView] = useState(VIEW_TYPES.OVERVIEW)
  const [selectedGrade, setSelectedGrade] = useState(null)
  const [selectedSection, setSelectedSection] = useState(null)
  const [selectedActivity, setSelectedActivity] = useState(null)

  // Sections for selected grade
  const [gradeSections, setGradeSections] = useState([])
  const [loadingSections, setLoadingSections] = useState(false)

  // Activities for selected section
  const [sectionActivities, setSectionActivities] = useState([])
  const [loadingActivities, setLoadingActivities] = useState(false)

  // Students for selected activity
  const [activityStudents, setActivityStudents] = useState([])
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [studentsPage, setStudentsPage] = useState(1)
  const [studentsPageSize, setStudentsPageSize] = useState(50)
  const [studentsTotal, setStudentsTotal] = useState(0)
  const [studentsSearch, setStudentsSearch] = useState('')

  const [loadingOverview, setLoadingOverview] = useState(false)
  const [loadingGrades, setLoadingGrades] = useState(false)

  const [errorOverview, setErrorOverview] = useState(null)
  const [errorGrades, setErrorGrades] = useState(null)
  const [errorSections, setErrorSections] = useState(null)
  const [errorActivities, setErrorActivities] = useState(null)
  const [errorStudents, setErrorStudents] = useState(null)

  // refs for scrolling
  const sectionsRef = useRef(null)
  const paymentsRef = useRef(null)

  // --- Payments drilldown state ---
  const [paymentsLevel, setPaymentsLevel] = useState(PAYMENTS_LEVELS.OVERVIEW)
  const [loadingPaymentsByGrade, setLoadingPaymentsByGrade] = useState(false)
  const [loadingPaymentsBySection, setLoadingPaymentsBySection] = useState(false)
  const [paymentsByGrade, setPaymentsByGrade] = useState([])
  const [paymentsBySection, setPaymentsBySection] = useState([])
  const [errorPayments, setErrorPayments] = useState(null)
  const [paymentsGradeSelected, setPaymentsGradeSelected] = useState(null)

  // ---------- Fetchers ----------
  const fetchOverview = async () => {
    setLoadingOverview(true)
    setErrorOverview(null)
    try {
      const res = await axios.get('/api/summary', {
        params: {
          view: 'overview',
          from_date: fromDate || undefined,
          to_date: toDate || undefined
        }
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
      const res = await axios.get('/api/summary', {
        params: {
          view: 'byGrade'
        }
      })
      setByGrade(res.data.grades ?? [])

      const simpleGrades = (res.data.grades ?? []).map(g => ({
        id: g.grade_id ?? g.id,
        name: g.grade_name ?? g.name
      }))
      setGrades(simpleGrades)
    } catch (err) {
      setErrorGrades(err?.response?.data?.message ?? 'Failed to load grade data')
    } finally {
      setLoadingGrades(false)
    }
  }

  const fetchGradeSections = async gradeId => {
    setLoadingSections(true)
    setErrorSections(null)
    setGradeSections([])
    try {
      const res = await axios.get('/api/summary', {
        params: {
          view: 'byGrade',
          grade_id: gradeId
        }
      })
      const gradeData = res.data.grades?.[0]
      setGradeSections(gradeData?.sections ?? [])
    } catch (err) {
      setErrorSections(err?.response?.data?.message ?? 'Failed to load sections')
    } finally {
      setLoadingSections(false)
    }
  }

  const fetchSectionActivities = async sectionId => {
    setLoadingActivities(true)
    setErrorActivities(null)
    setSectionActivities([])
    try {
      const res = await axios.get('/api/activities/section', {
        params: {
          section_id: sectionId,
          from_date: fromDate || undefined,
          to_date: toDate || undefined
        }
      })
      setSectionActivities(res.data.activities ?? [])
    } catch (err) {
      setErrorActivities(err?.response?.data?.message ?? 'Failed to load activities')
    } finally {
      setLoadingActivities(false)
    }
  }

  const fetchActivityStudents = async (
    activityId,
    sectionId,
    page = 1,
    pageSize = studentsPageSize,
    search = studentsSearch
  ) => {
    setLoadingStudents(true)
    setErrorStudents(null)
    setActivityStudents([])
    try {
      const res = await axios.get('/api/activities/students', {
        params: {
          activity_id: activityId,
          section_id: sectionId,
          page,
          page_size: pageSize,
          search
        }
      })
      setActivityStudents(res.data.students ?? [])
      setStudentsTotal(res.data.total ?? 0)
    } catch (err) {
      setErrorStudents(err?.response?.data?.message ?? 'Failed to load students')
    } finally {
      setLoadingStudents(false)
    }
  }

  // --- Payments fetchers ---
  const fetchPaymentsByGrade = async () => {
    setLoadingPaymentsByGrade(true)
    setErrorPayments(null)
    setPaymentsByGrade([])
    try {
      const res = await axios.get('/api/summary', {
        params: {
          view: 'paymentsByGrade',
          from_date: fromDate || undefined,
          to_date: toDate || undefined
        }
      })

      // expected res.data.payments_by_grade: [{ grade_id, grade_name, paid_count, unpaid_count }, ...]
      setPaymentsByGrade(res.data.payments_by_grade ?? [])
      setPaymentsLevel(PAYMENTS_LEVELS.BY_GRADE)
    } catch (err) {
      setErrorPayments(err?.response?.data?.message ?? 'Failed to load payments by grade')
    } finally {
      setLoadingPaymentsByGrade(false)
    }
  }

  const fetchPaymentsBySection = async gradeId => {
    if (!gradeId) return
    setLoadingPaymentsBySection(true)
    setErrorPayments(null)
    setPaymentsBySection([])
    try {
      const res = await axios.get('/api/summary', {
        params: {
          view: 'paymentsBySection',
          grade_id: gradeId,
          from_date: fromDate || undefined,
          to_date: toDate || undefined
        }
      })

      // expected res.data.payments_by_section: [{ section_id, section_name, paid_count, unpaid_count }, ...]
      setPaymentsBySection(res.data.payments_by_section ?? [])
      setPaymentsLevel(PAYMENTS_LEVELS.BY_SECTION)
    } catch (err) {
      setErrorPayments(err?.response?.data?.message ?? 'Failed to load payments by section')
    } finally {
      setLoadingPaymentsBySection(false)
    }
  }

  // Navigation handlers
  const handleGradeClick = grade => {
    setSelectedGrade(grade)
    setSelectedSection(null)
    setSelectedActivity(null)
    fetchGradeSections(grade.grade_id ?? grade.id)
  }

  const handleSectionClick = section => {
    setSelectedSection(section)
    setCurrentView(VIEW_TYPES.ACTIVITIES)
    fetchSectionActivities(section.section_id)
  }

  const handleActivityClick = activity => {
    setSelectedActivity(activity)
    setCurrentView(VIEW_TYPES.STUDENTS)
    setStudentsPage(1)
    fetchActivityStudents(activity.id, selectedSection.section_id, 1, studentsPageSize, studentsSearch)
  }

  const handleClearSelectedGrade = () => {
    setSelectedGrade(null)
    setGradeSections([])
  }

  const handleBackToOverview = () => {
    setCurrentView(VIEW_TYPES.OVERVIEW)
    setSelectedGrade(null)
    setSelectedSection(null)
    setSelectedActivity(null)
    setGradeSections([])
    setSectionActivities([])
    setActivityStudents([])

    // reset payments drilldown to main overview state
    setPaymentsLevel(PAYMENTS_LEVELS.OVERVIEW)
    setPaymentsByGrade([])
    setPaymentsBySection([])
    setPaymentsGradeSelected(null)
  }

  // payments controls invoked when admin clicks the "Total Paid" card
  const openPaymentsSection = () => {
    setPaymentsLevel(PAYMENTS_LEVELS.OVERVIEW)

    // scroll to payments block
    if (paymentsRef.current) {
      paymentsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const goToPaymentsByGrade = async () => {
    await fetchPaymentsByGrade()

    // scroll to payments block (in case admin clicked the main chart from somewhere else)
    if (paymentsRef.current) paymentsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handlePaymentsGradeClick = grade => {
    setPaymentsGradeSelected(grade)
    fetchPaymentsBySection(grade.grade_id ?? grade.id)
    if (paymentsRef.current) paymentsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handlePaymentsBack = () => {
    if (paymentsLevel === PAYMENTS_LEVELS.BY_SECTION) {
      // go back to grades view
      setPaymentsLevel(PAYMENTS_LEVELS.BY_GRADE)
      setPaymentsBySection([])
      setPaymentsGradeSelected(null)
    } else {
      // back to main payments overview
      setPaymentsLevel(PAYMENTS_LEVELS.OVERVIEW)
      setPaymentsByGrade([])
      setPaymentsBySection([])
      setPaymentsGradeSelected(null)
    }
  }

  // Student pagination handlers
  const handleStudentsPageChange = (event, newPage) => {
    const page = newPage + 1
    setStudentsPage(page)
    fetchActivityStudents(selectedActivity.id, selectedSection.section_id, page, studentsPageSize, studentsSearch)
  }

  const handleStudentsPageSizeChange = event => {
    const size = parseInt(event.target.value, 10)
    setStudentsPageSize(size)
    setStudentsPage(1)
    fetchActivityStudents(selectedActivity.id, selectedSection.section_id, 1, size, studentsSearch)
  }

  const handleStudentsSearch = value => {
    setStudentsSearch(value)
    setStudentsPage(1)
    fetchActivityStudents(selectedActivity.id, selectedSection.section_id, 1, studentsPageSize, value)
  }

  // export functions
  const exportTableToCSV = (rows, filename = 'export.csv') => {
    if (!rows || !rows.length) return
    const header = Object.keys(rows[0])
    const csv = [header.join(',')]
    for (const r of rows) {
      csv.push(
        header
          .map(h => {
            const val = r[h] ?? ''
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
    doc.autoTable({ head: [header], body, startY: 26 })
    doc.save(filename)
  }

  // grade data for chart (grades only)
  const gradeChartData = useMemo(() => {
    return byGrade.map(g => {
      const totalFromSections = g.sections?.reduce((sum, s) => sum + Number(s.total_students ?? 0), 0) ?? 0
      const total = Number(g.total_students ?? totalFromSections ?? 0)

      return {
        grade_id: g.grade_id ?? g.id,
        grade_name: g.grade_name ?? g.name,
        students: total,
        sections: g.sections ?? []
      }
    })
  }, [byGrade])

  // initial load & when filters change
  useEffect(() => {
    fetchOverview()
    fetchByGrade()
  }, [fromDate, toDate])

  // when gradeSections are loaded for a selected grade, scroll to the sections area
  useEffect(() => {
    if (selectedGrade && gradeSections.length && sectionsRef.current) {
      // small timeout to ensure layout has been updated
      sectionsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [gradeSections, selectedGrade])

  // Breadcrumb component
  const renderBreadcrumbs = () => {
    return (
      <Breadcrumbs aria-label='breadcrumb' sx={{ mb: 2 }}>
        <Link
          underline='hover'
          sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          color={currentView === VIEW_TYPES.OVERVIEW ? 'text.primary' : 'inherit'}
          onClick={handleBackToOverview}
        >
          <HomeIcon sx={{ mr: 0.5 }} fontSize='inherit' />
          Dashboard
        </Link>

        {selectedGrade && currentView === VIEW_TYPES.OVERVIEW && (
          <Link
            underline='hover'
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
            color='inherit'
            onClick={handleClearSelectedGrade}
          >
            <SchoolIcon sx={{ mr: 0.5 }} fontSize='inherit' />
            {selectedGrade?.grade_name}
          </Link>
        )}

        {currentView === VIEW_TYPES.ACTIVITIES && selectedSection && (
          <Link
            underline='hover'
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
            color='inherit'
            onClick={handleBackToOverview}
          >
            <SchoolIcon sx={{ mr: 0.5 }} fontSize='inherit' />
            {selectedSection?.grade_name} - {selectedSection?.section_name}
          </Link>
        )}

        {currentView === VIEW_TYPES.STUDENTS && (
          <Typography sx={{ display: 'flex', alignItems: 'center' }} color='text.primary'>
            <PeopleIcon sx={{ mr: 0.5 }} fontSize='inherit' />
            {selectedActivity?.title}
          </Typography>
        )}
      </Breadcrumbs>
    )
  }

  // --- renderPayments: payment charts & drill-down UI ---
  const renderPayments = () => {
    // main summary pie (overview)
    const paid = overview?.payments?.total_paid ?? 0
    const unpaid = overview?.payments?.total_unpaid ?? 0

    return (
      <Box ref={paymentsRef} sx={{ mt: 3 }}>
        <Card>
          <CardContent>
            <Box display='flex' justifyContent='space-between' alignItems='center' sx={{ mb: 2 }}>
              <Box>
                <Typography variant='h6'>Payments Overview</Typography>
                <Typography variant='body2' color='text.secondary'>
                  Click the chart to drill-down by grade, then by section.
                </Typography>
              </Box>

              <Box>
                {paymentsLevel !== PAYMENTS_LEVELS.OVERVIEW && (
                  <Button startIcon={<ArrowBackIcon />} onClick={handlePaymentsBack} sx={{ mr: 1 }}>
                    Back
                  </Button>
                )}
                <Button
                  size='small'
                  startIcon={<GetAppIcon />}
                  onClick={() => {
                    // export based on level
                    if (paymentsLevel === PAYMENTS_LEVELS.OVERVIEW) {
                      exportTableToCSV([{ paid, unpaid }], 'payments_overview.csv')
                    } else if (paymentsLevel === PAYMENTS_LEVELS.BY_GRADE) {
                      exportTableToCSV(
                        paymentsByGrade.map(g => ({
                          grade: g.grade_name,
                          paid: g.paid_count || 0,
                          unpaid: g.unpaid_count || 0
                        })),
                        'payments_by_grade.csv'
                      )
                    } else {
                      exportTableToCSV(
                        paymentsBySection.map(s => ({
                          section: s.section_name,
                          paid: s.paid_count || 0,
                          unpaid: s.unpaid_count || 0
                        })),
                        'payments_by_section.csv'
                      )
                    }
                  }}
                >
                  Export CSV
                </Button>
              </Box>
            </Box>

            {/* Level: Overview (main pie) */}
            {paymentsLevel === PAYMENTS_LEVELS.OVERVIEW && (
              <>
                {!overview || !overview.payments ? (
                  <Box>
                    <Alert severity='info' sx={{ mb: 2 }}>
                      Payments summary not available. Try refreshing or check the network/API.
                    </Alert>
                    <Button
                      variant='contained'
                      onClick={() => {
                        fetchOverview()
                      }}
                    >
                      Retry
                    </Button>
                  </Box>
                ) : (
                  (() => {
                    const paid = Number(overview.payments.total_paid ?? 0)
                    const unpaid = Number(overview.payments.total_unpaid ?? 0)
                    const total = paid + unpaid

                    // if no payments recorded, show a placeholder pie so the UI is not blank
                    const pieData =
                      total > 0
                        ? [
                            { name: 'Paid', value: paid },
                            { name: 'Unpaid', value: unpaid }
                          ]
                        : [{ name: 'No data', value: 1 }]

                    // colors for slices; use neutral color for "No data"
                    const sliceColors = total > 0 ? pieData.map(d => paymentColors[d.name] || '#CCCCCC') : ['#CCCCCC']

                    return (
                      <>
                        <Box
                          height={240}
                          sx={{ cursor: total > 0 ? 'pointer' : 'default' }}
                          onClick={() => total > 0 && goToPaymentsByGrade()}
                        >
                          <ResponsiveContainer width='100%' height='100%'>
                            <PieChart>
                              <Pie
                                data={pieData}
                                dataKey='value'
                                nameKey='name'
                                innerRadius={50}
                                outerRadius={80}
                                label
                              >
                                {pieData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={sliceColors[index % sliceColors.length]} />
                                ))}
                              </Pie>
                              <Legend />
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        </Box>

                        {total === 0 ? (
                          <Alert severity='info' sx={{ mt: 2 }}>
                            No payment records found for the selected date range.
                          </Alert>
                        ) : (
                          <Stack direction='row' spacing={1} mt={1}>
                            <Typography variant='body2'>
                              Paid: <strong>{paid}</strong>
                            </Typography>
                            <Typography variant='body2' sx={{ ml: 2 }}>
                              Unpaid: <strong>{unpaid}</strong>
                            </Typography>
                          </Stack>
                        )}
                      </>
                    )
                  })()
                )}
              </>
            )}

            {/* Level: By Grade (bar chart with paid/unpaid) */}
            {paymentsLevel === PAYMENTS_LEVELS.BY_GRADE && (
              <>
                {loadingPaymentsByGrade ? (
                  <Box display='flex' justifyContent='center' p={4}>
                    <CircularProgress />
                  </Box>
                ) : errorPayments ? (
                  <Alert severity='error'>{errorPayments}</Alert>
                ) : paymentsByGrade.length === 0 ? (
                  <Alert severity='info'>No payment data found by grade for the selected date range.</Alert>
                ) : (
                  <>
                    <Box height={320}>
                      <ResponsiveContainer width='100%' height='100%'>
                        <BarChart data={paymentsByGrade} margin={{ top: 20, right: 20, left: 10, bottom: 60 }}>
                          <XAxis dataKey='grade_name' interval={0} angle={-40} textAnchor='end' height={80} />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey='paid_count'
                            name='Paid'
                            onClick={data => handlePaymentsGradeClick(data.payload)}
                            style={{ cursor: 'pointer' }}
                          >
                            {paymentsByGrade.map((g, i) => (
                              <Cell key={`paid-${i}`} fill={paymentColors['Paid']} />
                            ))}
                          </Bar>
                          <Bar dataKey='unpaid_count' name='Unpaid'>
                            {paymentsByGrade.map((g, i) => (
                              <Cell key={`unpaid-${i}`} fill={paymentColors['Unpaid']} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ maxHeight: 260, overflow: 'auto' }}>
                      <Table size='small'>
                        <TableHead>
                          <TableRow>
                            <TableCell>Grade</TableCell>
                            <TableCell align='right'>Paid</TableCell>
                            <TableCell align='right'>Unpaid</TableCell>
                            <TableCell align='right'>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {paymentsByGrade.map(g => (
                            <TableRow key={g.grade_id} hover>
                              <TableCell>{g.grade_name}</TableCell>
                              <TableCell align='right'>{g.paid_count ?? 0}</TableCell>
                              <TableCell align='right'>{g.unpaid_count ?? 0}</TableCell>
                              <TableCell align='right'>
                                <Button size='small' onClick={() => handlePaymentsGradeClick(g)}>
                                  View Sections
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </>
                )}
              </>
            )}

            {/* Level: By Section (bar chart per section) */}
            {paymentsLevel === PAYMENTS_LEVELS.BY_SECTION && (
              <>
                {loadingPaymentsBySection ? (
                  <Box display='flex' justifyContent='center' p={4}>
                    <CircularProgress />
                  </Box>
                ) : errorPayments ? (
                  <Alert severity='error'>{errorPayments}</Alert>
                ) : paymentsBySection.length === 0 ? (
                  <Alert severity='info'>No payment data found for sections in this grade/date range.</Alert>
                ) : (
                  <>
                    <Box height={320}>
                      <ResponsiveContainer width='100%' height='100%'>
                        <BarChart data={paymentsBySection} margin={{ top: 20, right: 20, left: 10, bottom: 60 }}>
                          <XAxis dataKey='section_name' interval={0} angle={-40} textAnchor='end' height={80} />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey='paid_count' name='Paid'>
                            {paymentsBySection.map((s, i) => (
                              <Cell key={`psec-${i}`} fill={paymentColors['Paid']} />
                            ))}
                          </Bar>
                          <Bar dataKey='unpaid_count' name='Unpaid'>
                            {paymentsBySection.map((s, i) => (
                              <Cell key={`usec-${i}`} fill={paymentColors['Unpaid']} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ maxHeight: 260, overflow: 'auto' }}>
                      <Table size='small'>
                        <TableHead>
                          <TableRow>
                            <TableCell>Section</TableCell>
                            <TableCell align='right'>Paid</TableCell>
                            <TableCell align='right'>Unpaid</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {paymentsBySection.map(s => (
                            <TableRow key={s.section_id} hover>
                              <TableCell>{s.section_name}</TableCell>
                              <TableCell align='right'>{s.paid_count ?? 0}</TableCell>
                              <TableCell align='right'>{s.unpaid_count ?? 0}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </Box>
    )
  }

  // Render overview (grades chart)
  const renderOverview = () => (
    <>
      {/* Total Block Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
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
          <Grid item xs={12} sm={6} md={2.4}>
            <Box onClick={openPaymentsSection} sx={{ cursor: 'pointer' }}>
              <UserDetails
                icon='mdi:cash-check'
                color='success'
                count={loadingOverview ? <CircularProgress size={20} /> : overview?.payments?.total_paid ?? 0}
                title='Total Paid'
              />
            </Box>
          </Grid>
        )}
      </Grid>

      <Grid container spacing={3}>
        {/* Grades Chart - full width */}
        <Grid item xs={12} md={12}>
          <Card>
            <CardContent>
              <Box display='flex' justifyContent='space-between' alignItems='center' sx={{ mb: 2 }}>
                <Typography variant='h6'>Students by Grade</Typography>
              </Box>

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
                      <BarChart data={gradeChartData} margin={{ top: 20, right: 20, left: 10, bottom: 60 }}>
                        <XAxis dataKey='grade_name' interval={0} angle={-40} textAnchor='end' height={80} />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar
                          dataKey='students'
                          onClick={data => handleGradeClick(data.payload)}
                          style={{ cursor: 'pointer' }}
                        >
                          {gradeChartData.map((e, i) => (
                            <Cell key={`c-${i}`} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>

                  <Divider sx={{ my: 2 }} />

                  <Box display='flex' justifyContent='space-between' alignItems='center' sx={{ mb: 1 }}>
                    <Typography variant='subtitle2'>Click on a grade to view its sections</Typography>
                    <Box>
                      <Button
                        size='small'
                        startIcon={<GetAppIcon />}
                        onClick={() =>
                          exportTableToCSV(
                            gradeChartData.map(g => ({
                              grade: g.grade_name,
                              students: g.students
                            })),
                            'grades.csv'
                          )
                        }
                      >
                        Export CSV
                      </Button>
                    </Box>
                  </Box>

                  <Box sx={{ maxHeight: 280, overflow: 'auto' }}>
                    <Table size='small'>
                      <TableHead>
                        <TableRow>
                          <TableCell>Grade</TableCell>
                          <TableCell align='right'>Students</TableCell>
                          <TableCell align='right'>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {gradeChartData.map(g => (
                          <TableRow key={g.grade_id} hover>
                            <TableCell>{g.grade_name}</TableCell>
                            <TableCell align='right'>{g.students}</TableCell>
                            <TableCell align='right'>
                              <Button size='small' onClick={() => handleGradeClick(g)}>
                                View Sections
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>

                  {/* Sections list appears below the chart when a grade is selected */}
                  {selectedGrade && (
                    <Box sx={{ mt: 3 }} ref={sectionsRef}>
                      <Card variant='outlined'>
                        <CardContent>
                          <Box display='flex' justifyContent='space-between' alignItems='center' sx={{ mb: 2 }}>
                            <Box>
                              <Typography variant='h6'>Sections in {selectedGrade.grade_name}</Typography>
                              <Typography variant='body2' color='text.secondary'>
                                {gradeSections.reduce((sum, s) => sum + Number(s.total_students ?? 0), 0)} total
                                students
                              </Typography>
                            </Box>
                            <Box>
                              <Button startIcon={<ArrowBackIcon />} onClick={handleClearSelectedGrade} sx={{ mr: 1 }}>
                                Back
                              </Button>
                              <Button
                                size='small'
                                startIcon={<GetAppIcon />}
                                onClick={() =>
                                  exportTableToCSV(
                                    gradeSections.map(s => ({
                                      section: s.section_name,
                                      students: s.total_students || 0
                                    })),
                                    'grade_sections.csv'
                                  )
                                }
                              >
                                Export CSV
                              </Button>
                            </Box>
                          </Box>

                          {loadingSections ? (
                            <Box display='flex' justifyContent='center' p={4}>
                              <CircularProgress />
                            </Box>
                          ) : errorSections ? (
                            <Alert severity='error'>{errorSections}</Alert>
                          ) : gradeSections.length === 0 ? (
                            <Alert severity='info'>No sections found for this grade.</Alert>
                          ) : (
                            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                              <Table>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Section Name</TableCell>
                                    <TableCell align='center'>Students</TableCell>
                                    <TableCell align='center'>Actions</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {gradeSections.map(section => (
                                    <TableRow key={section.section_id} hover>
                                      <TableCell>{section.section_name || '—'}</TableCell>
                                      <TableCell align='center'>
                                        <Chip label={section.total_students || 0} color='primary' size='small' />
                                      </TableCell>
                                      <TableCell align='center'>
                                        <Button
                                          size='small'
                                          startIcon={<EventIcon />}
                                          onClick={() => handleSectionClick(section)}
                                        >
                                          View Activities
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </Box>
                          )}
                        </CardContent>
                      </Card>
                    </Box>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Payments Overview moved below the chart */}
        <Grid item xs={12} md={12}>
          {renderPayments()}
        </Grid>
      </Grid>
    </>
  )

  // Render activities for selected section
  const renderActivities = () => (
    <Card>
      <CardContent>
        <Box display='flex' justifyContent='space-between' alignItems='center' sx={{ mb: 2 }}>
          <Box>
            <Typography variant='h6'>
              Activities for {selectedSection?.grade_name} - {selectedSection?.section_name}
            </Typography>
            <Typography variant='body2' color='text.secondary'>
              {selectedSection?.students} students in this section
            </Typography>
          </Box>
          <Box>
            <Button startIcon={<ArrowBackIcon />} onClick={handleBackToOverview} sx={{ mr: 1 }}>
              Back to Overview
            </Button>
            <Button
              size='small'
              startIcon={<GetAppIcon />}
              onClick={() =>
                exportTableToCSV(
                  sectionActivities.map(a => ({
                    date: a.activity_date,
                    title: a.title,
                    present: a.present_count || 0,
                    absent: a.absent_count || 0,
                    paid: a.paid_count || 0,
                    unpaid: a.unpaid_count || 0
                  })),
                  'activities.csv'
                )
              }
            >
              Export CSV
            </Button>
          </Box>
        </Box>

        {loadingActivities ? (
          <Box display='flex' justifyContent='center' p={4}>
            <CircularProgress />
          </Box>
        ) : errorActivities ? (
          <Alert severity='error'>{errorActivities}</Alert>
        ) : sectionActivities.length === 0 ? (
          <Alert severity='info'>No activities found for this section.</Alert>
        ) : (
          <Box sx={{ maxHeight: 600, overflow: 'auto' }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Activity Title</TableCell>
                  <TableCell align='center'>Present</TableCell>
                  <TableCell align='center'>Absent</TableCell>
                  <TableCell align='center'>Paid</TableCell>
                  <TableCell align='center'>Unpaid</TableCell>
                  <TableCell align='center'>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sectionActivities.map(activity => (
                  <TableRow key={activity.id} hover>
                    <TableCell>{activity.activity_date}</TableCell>
                    <TableCell>{activity.title}</TableCell>
                    <TableCell align='center'>
                      <Chip label={activity.present_count || 0} color='success' size='small' />
                    </TableCell>
                    <TableCell align='center'>
                      <Chip label={activity.absent_count || 0} color='error' size='small' />
                    </TableCell>
                    <TableCell align='center'>
                      <Chip label={activity.paid_count || 0} color='success' size='small' />
                    </TableCell>
                    <TableCell align='center'>
                      <Chip label={activity.unpaid_count || 0} color='warning' size='small' />
                    </TableCell>
                    <TableCell align='center'>
                      <Button size='small' startIcon={<PeopleIcon />} onClick={() => handleActivityClick(activity)}>
                        View Students
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  )

  // Render students for selected activity
  const renderStudents = () => (
    <Card>
      <CardContent>
        <Box display='flex' justifyContent='space-between' alignItems='center' sx={{ mb: 2 }}>
          <Box>
            <Typography variant='h6'>Student Attendance: {selectedActivity?.title}</Typography>
            <Typography variant='body2' color='text.secondary'>
              {selectedSection?.grade_name} - {selectedSection?.section_name} • {selectedActivity?.activity_date}
            </Typography>
          </Box>
          <Box>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setCurrentView(VIEW_TYPES.ACTIVITIES)} sx={{ mr: 1 }}>
              Back to Activities
            </Button>
            <Button
              size='small'
              startIcon={<GetAppIcon />}
              onClick={() =>
                exportTableToCSV(
                  activityStudents.map(s => ({
                    lrn: s.lrn,
                    student_name: `${s.last_name}, ${s.first_name}`,
                    parents: s.parents || '',
                    attendance_status: s.attendance_status || '—',
                    parent_present: s.parent_present ? 'Yes' : 'No',
                    payment_status: s.payment_paid === 1 ? 'Paid' : s.payment_paid === 0 ? 'Unpaid' : '—',
                    payment_date: s.payment_date || '—'
                  })),
                  'students_attendance.csv'
                )
              }
            >
              Export CSV
            </Button>
          </Box>
        </Box>

        <Box display='flex' justifyContent='space-between' sx={{ mb: 2 }}>
          <TextField
            size='small'
            placeholder='Search by name or LRN'
            value={studentsSearch}
            onChange={e => handleStudentsSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position='start'>
                  <SearchIcon />
                </InputAdornment>
              )
            }}
            sx={{ minWidth: 300 }}
          />
        </Box>

        {loadingStudents ? (
          <Box display='flex' justifyContent='center' p={4}>
            <CircularProgress />
          </Box>
        ) : errorStudents ? (
          <Alert severity='error'>{errorStudents}</Alert>
        ) : activityStudents.length === 0 ? (
          <Alert severity='info'>No students found for this activity.</Alert>
        ) : (
          <>
            <Box sx={{ maxHeight: 600, overflow: 'auto' }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>LRN</TableCell>
                    <TableCell>Student Name</TableCell>
                    <TableCell>Parents/Guardians</TableCell>
                    <TableCell align='center'>Attendance</TableCell>
                    <TableCell align='center'>Parent Present</TableCell>
                    <TableCell align='center'>Payment</TableCell>
                    <TableCell>Payment Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activityStudents.map((student, i) => (
                    <TableRow key={`student-${i}`}>
                      <TableCell>{student.lrn}</TableCell>
                      <TableCell>
                        {student.last_name}, {student.first_name}
                      </TableCell>
                      <TableCell>{student.parents || '—'}</TableCell>
                      <TableCell align='center'>
                        {student.attendance_status ? (
                          <Chip
                            label={student.attendance_status}
                            color={student.attendance_status === 'present' ? 'success' : 'error'}
                            size='small'
                          />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell align='center'>
                        <Chip
                          label={student.parent_present ? 'Present' : 'Absent'}
                          color={student.parent_present ? 'success' : 'default'}
                          size='small'
                        />
                      </TableCell>
                      <TableCell align='center'>
                        {student.payment_paid === 1 ? (
                          <Chip label='Paid' color='success' size='small' />
                        ) : student.payment_paid === 0 ? (
                          <Chip label='Unpaid' color='warning' size='small' />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {student.payment_date ? new Date(student.payment_date).toLocaleDateString() : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>

            <TablePagination
              component='div'
              count={studentsTotal}
              page={studentsPage - 1}
              onPageChange={handleStudentsPageChange}
              rowsPerPage={studentsPageSize}
              onRowsPerPageChange={handleStudentsPageSizeChange}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </>
        )}
      </CardContent>
    </Card>
  )

  // ---------- UI ----------
  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        {/* Date filters and refresh (always visible) */}
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
                if (currentView === VIEW_TYPES.ACTIVITIES && selectedSection) {
                  fetchSectionActivities(selectedSection.section_id)
                } else if (currentView === VIEW_TYPES.STUDENTS && selectedActivity && selectedSection) {
                  fetchActivityStudents(
                    selectedActivity.id,
                    selectedSection.section_id,
                    studentsPage,
                    studentsPageSize,
                    studentsSearch
                  )
                }
              }}
              variant='contained'
            >
              Refresh
            </Button>
          </Box>
        </Stack>

        {/* Breadcrumbs */}
        {renderBreadcrumbs()}

        {/* Content based on current view */}
        {currentView === VIEW_TYPES.OVERVIEW && renderOverview()}
        {currentView === VIEW_TYPES.ACTIVITIES && renderActivities()}
        {currentView === VIEW_TYPES.STUDENTS && renderStudents()}
      </Grid>
    </Grid>
  )
}

Dashboard.acl = { action: 'read', subject: 'dashboard' }

export default Dashboard
