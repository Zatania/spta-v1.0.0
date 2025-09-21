// src/pages/dashboard/index.js
import { useState, useEffect, useContext, useMemo, useRef } from 'react'
import {
  Avatar,
  Checkbox,
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
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton
} from '@mui/material'
import Autocomplete from '@mui/material/Autocomplete'
import { AbilityContext } from 'src/layouts/components/acl/Can'
import UserDetails from 'src/views/pages/dashboard/UserDetails'
import CloseIcon from '@mui/icons-material/Close'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
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

  const [parentFilter, setParentFilter] = useState([]) // array of parent objects
  const [parentOptions, setParentOptions] = useState([])
  const [parentLoading, setParentLoading] = useState(false)
  const [parentPupils, setParentPupils] = useState({}) // { parentId: [students...] }

  const [schoolYears, setSchoolYears] = useState([])
  const [schoolYearId, setSchoolYearId] = useState(null)
  const [loadingSY, setLoadingSY] = useState(false)

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

  // Activities overview states
  const [activitiesLevel, setActivitiesLevel] = useState('overview') // 'overview', 'byGrade', 'bySection', 'sectionActivities'
  const [activitiesOverviewData, setActivitiesOverviewData] = useState([])
  const [activitiesByGrade, setActivitiesByGrade] = useState([])
  const [activitiesBySection, setActivitiesBySection] = useState([])
  const [activitiesSectionActivities, setActivitiesSectionActivities] = useState([])
  const [activitiesSelectedGrade, setActivitiesSelectedGrade] = useState(null)
  const [activitiesSelectedSection, setActivitiesSelectedSection] = useState(null)
  const [activitiesSelectedActivity, setActivitiesSelectedActivity] = useState(null)
  const [activitiesStudents, setActivitiesStudents] = useState([])
  const [loadingActivitiesOverview, setLoadingActivitiesOverview] = useState(false)
  const [loadingActivitiesByGrade, setLoadingActivitiesByGrade] = useState(false)
  const [loadingActivitiesBySection, setLoadingActivitiesBySection] = useState(false)
  const [loadingActivitiesStudents, setLoadingActivitiesStudents] = useState(false)
  const [errorActivitiesOverview, setErrorActivitiesOverview] = useState(null)
  const activitiesRef = useRef(null)

  //PDF
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('')
  const [pdfPreviewStudent, setPdfPreviewStudent] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [previewEndpoint, setPreviewEndpoint] = useState('')

  // ---------- Fetchers ----------

  const parentIdsParam = () => (parentFilter && parentFilter.length ? parentFilter.map(p => p.id).join(',') : undefined)

  const selectedSchoolYear = useMemo(
    () => schoolYears.find(sy => sy.id === schoolYearId) || null,
    [schoolYears, schoolYearId]
  )

  const fetchOverview = async () => {
    setLoadingOverview(true)
    setErrorOverview(null)
    try {
      const res = await axios.get('/api/summary', {
        params: {
          view: 'overview',
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          school_year_id: schoolYearId || undefined
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
          view: 'byGrade',
          school_year_id: schoolYearId || undefined
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
          grade_id: gradeId,
          school_year_id: schoolYearId || undefined
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
          to_date: toDate || undefined,
          school_year_id: schoolYearId || undefined
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
          search,
          parent_ids: parentIdsParam(),
          school_year_id: schoolYearId || undefined
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
          to_date: toDate || undefined,
          parent_ids: parentIdsParam(),
          school_year_id: schoolYearId || undefined
        }
      })

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
          to_date: toDate || undefined,
          parent_ids: parentIdsParam(),
          school_year_id: schoolYearId || undefined
        }
      })

      setPaymentsBySection(res.data.payments_by_section ?? [])
      setPaymentsLevel(PAYMENTS_LEVELS.BY_SECTION)
    } catch (err) {
      setErrorPayments(err?.response?.data?.message ?? 'Failed to load payments by section')
    } finally {
      setLoadingPaymentsBySection(false)
    }
  }

  const fetchActivitiesOverview = async () => {
    setLoadingActivitiesOverview(true)
    setErrorActivitiesOverview(null)
    try {
      const res = await axios.get('/api/summary', {
        params: {
          view: 'activitiesOverview',
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          parent_ids: parentIdsParam(),
          school_year_id: schoolYearId || undefined
        }
      })
      setActivitiesOverviewData(res.data.activities_by_grade ?? [])
      setActivitiesLevel('overview')
    } catch (err) {
      setErrorActivitiesOverview(err?.response?.data?.message ?? 'Failed to load activities overview')
    } finally {
      setLoadingActivitiesOverview(false)
    }
  }

  const fetchActivitiesByGrade = async gradeId => {
    if (!gradeId) return
    setLoadingActivitiesByGrade(true)
    setErrorActivitiesOverview(null)
    try {
      const res = await axios.get('/api/summary', {
        params: {
          view: 'activitiesByGrade',
          grade_id: gradeId,
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          parent_ids: parentIdsParam(),
          school_year_id: schoolYearId || undefined
        }
      })
      setActivitiesByGrade(res.data.activities_by_section ?? [])
      setActivitiesLevel('byGrade')
    } catch (err) {
      setErrorActivitiesOverview(err?.response?.data?.message ?? 'Failed to load activities by grade')
    } finally {
      setLoadingActivitiesByGrade(false)
    }
  }

  const fetchActivitiesBySection = async sectionId => {
    if (!sectionId) return
    setLoadingActivitiesBySection(true)
    setErrorActivitiesOverview(null)
    try {
      const res = await axios.get('/api/summary', {
        params: {
          view: 'activitiesBySection',
          section_id: sectionId,
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          parent_ids: parentIdsParam(),
          school_year_id: schoolYearId || undefined
        }
      })
      setActivitiesSectionActivities(res.data.section_activities ?? [])
      setActivitiesLevel('sectionActivities')
    } catch (err) {
      setErrorActivitiesOverview(err?.response?.data?.message ?? 'Failed to load section activities')
    } finally {
      setLoadingActivitiesBySection(false)
    }
  }

  const fetchActivitiesStudents = async (activityId, sectionId) => {
    if (!activityId || !sectionId) return
    setLoadingActivitiesStudents(true)
    setErrorActivitiesOverview(null)
    try {
      const res = await axios.get('/api/activities/students', {
        params: {
          activity_id: activityId,
          section_id: sectionId,
          page: 1,
          page_size: 1000,
          parent_ids: parentIdsParam(),
          school_year_id: schoolYearId || undefined
        }
      })
      setActivitiesStudents(res.data.students ?? [])
    } catch (err) {
      setErrorActivitiesOverview(err?.response?.data?.message ?? 'Failed to load activity students')
    } finally {
      setLoadingActivitiesStudents(false)
    }
  }

  // --- NEW: Parent search / fetch helpers ---
  const fetchParents = async (q = '') => {
    setParentLoading(true)
    try {
      const res = await axios.get('/api/parents', { params: { search: q } })
      setParentOptions(res.data.parents ?? [])
    } catch (e) {
      console.error('Failed to fetch parents', e)
    } finally {
      setParentLoading(false)
    }
  }

  const fetchPupilsForParents = async parents => {
    if (!parents || parents.length === 0) {
      setParentPupils({})

      return
    }
    try {
      const ids = parents.map(p => p.id).join(',')

      const res = await axios.get('/api/parents/pupils', {
        params: { parent_ids: ids, school_year_id: schoolYearId || undefined }
      })

      // expected res.data: { parent_id: [{student}, ...], ... }
      setParentPupils(res.data || {})
    } catch (err) {
      console.error('Failed to fetch pupils for parents', err)
      setParentPupils({})
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

    // ADD THESE LINES FOR ACTIVITIES RESET
    setActivitiesLevel('overview')
    setActivitiesSelectedGrade(null)
    setActivitiesSelectedSection(null)
    setActivitiesSelectedActivity(null)
    setActivitiesByGrade([])
    setActivitiesBySection([])
    setActivitiesSectionActivities([])
    setActivitiesStudents([])
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

  const handleActivitiesOverviewGradeClick = grade => {
    setActivitiesSelectedGrade(grade)
    fetchActivitiesByGrade(grade.grade_id ?? grade.id)
    if (activitiesRef.current) {
      activitiesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleActivitiesSectionClick = section => {
    setActivitiesSelectedSection(section)
    fetchActivitiesBySection(section.section_id ?? section.id)
    if (activitiesRef.current) {
      activitiesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleActivitiesActivityClick = activity => {
    setActivitiesSelectedActivity(activity)
    fetchActivitiesStudents(activity.id, activitiesSelectedSection.section_id ?? activitiesSelectedSection.id)
  }

  const handleActivitiesBack = () => {
    if (activitiesLevel === 'sectionActivities') {
      setActivitiesLevel('byGrade')
      setActivitiesSelectedActivity(null)
      setActivitiesStudents([])
    } else if (activitiesLevel === 'byGrade') {
      setActivitiesLevel('overview')
      setActivitiesSelectedGrade(null)
      setActivitiesByGrade([])
    }
  }

  const handleActivitiesDownloadForm = async student => {
    try {
      console.log(
        'Download form clicked — student:',
        student,
        'activitiesSelectedActivity:',
        activitiesSelectedActivity
      )

      if (!student) {
        console.error('handleActivitiesDownloadForm: student is falsy')
        alert('Student data missing. Check console for details.')

        return
      }

      const studentId = student.id ?? student.student_id ?? student.studentId
      if (!studentId) {
        console.error('handleActivitiesDownloadForm: no student id found on object. Keys:', Object.keys(student))
        alert('Student id missing — check console for details.')

        return
      }

      const activityPart = activitiesSelectedActivity?.id
        ? `&activity_id=${encodeURIComponent(activitiesSelectedActivity.id)}`
        : ''

      // Prefer the new school_year_id. Also send legacy school_year=name for backward compat.
      const legacyName = selectedSchoolYear?.name || ''

      const url =
        `/api/teacher/forms/parent-checklist?student_id=${encodeURIComponent(studentId)}${activityPart}` +
        `&school_year_id=${encodeURIComponent(schoolYearId ?? '')}` +
        (legacyName ? `&school_year=${encodeURIComponent(legacyName)}` : '')

      console.log('Requesting PDF from:', url)
      const resp = await fetch(url, { method: 'GET' })

      if (!resp.ok) {
        let text = '<empty response>'
        try {
          text = await resp.text()
        } catch (e) {
          /* ignore */
        }
        console.error('Failed to generate form', resp.status, text)
        alert(`Failed to generate form (status ${resp.status}). See console for details.`)

        return
      }

      const blob = await resp.blob()
      const a = document.createElement('a')

      const filename = `SPTA_Checklist_${student.last_name ?? 'lastname'}_${student.first_name ?? 'firstname'}_${
        student.grade_name ?? 'grade'
      }_${student.section_name ?? 'section'}.pdf`.replace(/\s+/g, '_')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (error) {
      console.error('Error downloading form:', error)
      alert('Error downloading form — check console for details.')
    }
  }

  const openActivitiesSection = () => {
    setActivitiesLevel('overview')
    fetchActivitiesOverview()
    if (activitiesRef.current) {
      activitiesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
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
    fetchActivitiesOverview()
  }, [fromDate, toDate, parentFilter, schoolYearId])

  // load parent options on mount (or you can lazy-load via Autocomplete's onInputChange)
  useEffect(() => {
    fetchParents()
  }, [])

  // fetch pupils whenever parentFilter changes
  useEffect(() => {
    fetchPupilsForParents(parentFilter)
  }, [parentFilter, schoolYearId])

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
                <Typography variant='h6'>
                  Payments Overview
                  {selectedSchoolYear && (
                    <Chip component='span' label={selectedSchoolYear.name} size='small' sx={{ ml: 1 }} />
                  )}
                </Typography>
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
                            { name: 'Paid', value: paid, fill: paymentColors.Paid },
                            { name: 'Unpaid', value: unpaid, fill: paymentColors.Unpaid }
                          ]
                        : [{ name: 'No data', value: 1 }]

                    // colors for slices; use neutral color for "No data"
                    //const sliceColors = total > 0 ? pieData.map(d => paymentColors[d.name] || '#CCCCCC') : ['#CCCCCC']

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
                                  <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                              </Pie>

                              <Legend
                                payload={
                                  total > 0
                                    ? [
                                        { value: 'Paid', type: 'square', color: paymentColors.Paid },
                                        { value: 'Unpaid', type: 'square', color: paymentColors.Unpaid }
                                      ]
                                    : [{ value: 'No data', type: 'square', color: '#CCCCCC' }]
                                }
                              />
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
                            fill={paymentColors.Paid}
                            onClick={data => handlePaymentsGradeClick(data.payload)}
                            style={{ cursor: 'pointer' }}
                          >
                            {paymentsByGrade.map((g, i) => (
                              <Cell key={`paid-${i}`} fill={paymentColors['Paid']} />
                            ))}
                          </Bar>
                          <Bar dataKey='unpaid_count' name='Unpaid' fill={paymentColors.Unpaid}>
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
                          <Bar dataKey='paid_count' name='Paid' fill={paymentColors.Paid}>
                            {paymentsBySection.map((s, i) => (
                              <Cell key={`psec-${i}`} fill={paymentColors['Paid']} />
                            ))}
                          </Bar>
                          <Bar dataKey='unpaid_count' name='Unpaid' fill={paymentColors.Unpaid}>
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

  const renderActivitiesOverview = () => {
    const attendanceColors = {
      Present: '#7BC043',
      Absent: '#F26419'
    }

    return (
      <Box ref={activitiesRef} sx={{ mt: 3 }}>
        <Card>
          <CardContent>
            <Box display='flex' justifyContent='space-between' alignItems='center' sx={{ mb: 2 }}>
              <Box>
                <Typography variant='h6'>
                  Activities Attendance Overview
                  {selectedSchoolYear && (
                    <Chip component='span' label={selectedSchoolYear.name} size='small' sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant='body2' color='text.secondary'>
                  Click the chart to drill-down by grade, then by section, then by activity.
                </Typography>
              </Box>

              <Box>
                {activitiesLevel !== 'overview' && (
                  <Button startIcon={<ArrowBackIcon />} onClick={handleActivitiesBack} sx={{ mr: 1 }}>
                    Back
                  </Button>
                )}
                <Button
                  size='small'
                  startIcon={<GetAppIcon />}
                  onClick={() => {
                    if (activitiesLevel === 'overview') {
                      exportTableToCSV(
                        activitiesOverviewData.map(g => ({
                          grade: g.grade_name,
                          present: g.parent_present_count || 0,
                          absent: g.parent_absent_count || 0
                        })),
                        'activities_overview.csv'
                      )
                    } else if (activitiesLevel === 'byGrade') {
                      exportTableToCSV(
                        activitiesByGrade.map(s => ({
                          section: s.section_name,
                          present: s.parent_present_count || 0,
                          absent: s.parent_absent_count || 0
                        })),
                        'activities_by_section.csv'
                      )
                    } else if (activitiesLevel === 'sectionActivities') {
                      exportTableToCSV(
                        activitiesSectionActivities.map(a => ({
                          activity: a.title,
                          date: a.activity_date,
                          present: a.parent_present_count || 0,
                          absent: a.parent_absent_count || 0
                        })),
                        'section_activities.csv'
                      )
                    }
                  }}
                >
                  Export CSV
                </Button>
              </Box>
            </Box>

            {/* Level: Overview (by grade) */}
            {activitiesLevel === 'overview' && (
              <>
                {loadingActivitiesOverview ? (
                  <Box display='flex' justifyContent='center' p={4}>
                    <CircularProgress />
                  </Box>
                ) : errorActivitiesOverview ? (
                  <Alert severity='error'>{errorActivitiesOverview}</Alert>
                ) : activitiesOverviewData.length === 0 ? (
                  <Alert severity='info'>No activities data found for the selected date range.</Alert>
                ) : (
                  <>
                    <Box height={320}>
                      <ResponsiveContainer width='100%' height='100%'>
                        <BarChart data={activitiesOverviewData} margin={{ top: 20, right: 20, left: 10, bottom: 60 }}>
                          <XAxis dataKey='grade_name' interval={0} angle={-40} textAnchor='end' height={80} />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey='parent_present_count'
                            name='Parent Present'
                            fill={attendanceColors.Present}
                            onClick={data => handleActivitiesOverviewGradeClick(data.payload)}
                            style={{ cursor: 'pointer' }}
                          >
                            {activitiesOverviewData.map((g, i) => (
                              <Cell key={`present-${i}`} fill={attendanceColors['Present']} />
                            ))}
                          </Bar>
                          <Bar dataKey='parent_absent_count' name='Parent Absent' fill={attendanceColors.Absent}>
                            {activitiesOverviewData.map((g, i) => (
                              <Cell key={`absent-${i}`} fill={attendanceColors['Absent']} />
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
                            <TableCell align='right'>Present</TableCell>
                            <TableCell align='right'>Absent</TableCell>
                            <TableCell align='right'>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {activitiesOverviewData.map(g => (
                            <TableRow key={g.grade_id} hover>
                              <TableCell>{g.grade_name}</TableCell>
                              <TableCell align='right'>{g.parent_present_count ?? 0}</TableCell>
                              <TableCell align='right'>{g.parent_absent_count ?? 0}</TableCell>
                              <TableCell align='right'>
                                <Button size='small' onClick={() => handleActivitiesOverviewGradeClick(g)}>
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

            {/* Level: By Grade (sections) */}
            {activitiesLevel === 'byGrade' && (
              <>
                {loadingActivitiesByGrade ? (
                  <Box display='flex' justifyContent='center' p={4}>
                    <CircularProgress />
                  </Box>
                ) : errorActivitiesOverview ? (
                  <Alert severity='error'>{errorActivitiesOverview}</Alert>
                ) : activitiesByGrade.length === 0 ? (
                  <Alert severity='info'>No activities data found for sections in this grade/date range.</Alert>
                ) : (
                  <>
                    <Typography variant='subtitle1' sx={{ mb: 2 }}>
                      Activities Attendance for {activitiesSelectedGrade?.grade_name}
                    </Typography>
                    <Box height={320}>
                      <ResponsiveContainer width='100%' height='100%'>
                        <BarChart data={activitiesByGrade} margin={{ top: 20, right: 20, left: 10, bottom: 60 }}>
                          <XAxis dataKey='section_name' interval={0} angle={-40} textAnchor='end' height={80} />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey='parent_present_count'
                            name='Parent Present'
                            fill={attendanceColors.Present}
                            onClick={data => handleActivitiesSectionClick(data.payload)}
                            style={{ cursor: 'pointer' }}
                          >
                            {activitiesByGrade.map((s, i) => (
                              <Cell key={`sec-present-${i}`} fill={attendanceColors['Present']} />
                            ))}
                          </Bar>
                          <Bar dataKey='parent_absent_count' name='Parent Absent' fill={attendanceColors.Absent}>
                            {activitiesByGrade.map((s, i) => (
                              <Cell key={`sec-absent-${i}`} fill={attendanceColors['Absent']} />
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
                            <TableCell align='right'>Present</TableCell>
                            <TableCell align='right'>Absent</TableCell>
                            <TableCell align='right'>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {activitiesByGrade.map(s => (
                            <TableRow key={s.section_id} hover>
                              <TableCell>{s.section_name}</TableCell>
                              <TableCell align='right'>{s.parent_present_count ?? 0}</TableCell>
                              <TableCell align='right'>{s.parent_absent_count ?? 0}</TableCell>
                              <TableCell align='right'>
                                <Button size='small' onClick={() => handleActivitiesSectionClick(s)}>
                                  View Activities
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

            {/* Level: Section Activities */}
            {activitiesLevel === 'sectionActivities' && (
              <>
                {loadingActivitiesBySection ? (
                  <Box display='flex' justifyContent='center' p={4}>
                    <CircularProgress />
                  </Box>
                ) : errorActivitiesOverview ? (
                  <Alert severity='error'>{errorActivitiesOverview}</Alert>
                ) : activitiesSectionActivities.length === 0 ? (
                  <Alert severity='info'>No activities found for this section/date range.</Alert>
                ) : (
                  <>
                    <Typography variant='subtitle1' sx={{ mb: 2 }}>
                      Activities for {activitiesSelectedGrade?.grade_name} - {activitiesSelectedSection?.section_name}
                    </Typography>
                    <Box height={320}>
                      <ResponsiveContainer width='100%' height='100%'>
                        <BarChart
                          data={activitiesSectionActivities}
                          margin={{ top: 20, right: 20, left: 10, bottom: 60 }}
                        >
                          <XAxis dataKey='title' interval={0} angle={-40} textAnchor='end' height={80} />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey='parent_present_count'
                            name='Parent Present'
                            fill={attendanceColors.Present}
                            onClick={data => handleActivitiesActivityClick(data.payload)}
                            style={{ cursor: 'pointer' }}
                          >
                            {activitiesSectionActivities.map((a, i) => (
                              <Cell key={`act-present-${i}`} fill={attendanceColors['Present']} />
                            ))}
                          </Bar>
                          <Bar dataKey='parent_absent_count' name='Parent Absent' fill={attendanceColors.Absent}>
                            {activitiesSectionActivities.map((a, i) => (
                              <Cell key={`act-absent-${i}`} fill={attendanceColors['Absent']} />
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
                            <TableCell>Activity</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell align='right'>Present</TableCell>
                            <TableCell align='right'>Absent</TableCell>
                            <TableCell align='right'>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {activitiesSectionActivities.map(a => (
                            <TableRow key={a.id} hover>
                              <TableCell>{a.title}</TableCell>
                              <TableCell>{a.activity_date}</TableCell>
                              <TableCell align='right'>{a.parent_present_count ?? 0}</TableCell>
                              <TableCell align='right'>{a.parent_absent_count ?? 0}</TableCell>
                              <TableCell align='right'>
                                <Button size='small' onClick={() => handleActivitiesActivityClick(a)}>
                                  View Students
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>

                    {/* Students list when activity is selected */}
                    {activitiesSelectedActivity && (
                      <Box sx={{ mt: 3 }}>
                        <Card variant='outlined'>
                          <CardContent>
                            <Typography variant='h6' sx={{ mb: 2 }}>
                              Students - {activitiesSelectedActivity.title}
                              <Chip label={activitiesSelectedActivity.activity_date} size='small' sx={{ ml: 2 }} />
                            </Typography>

                            {loadingActivitiesStudents ? (
                              <Box display='flex' justifyContent='center' p={4}>
                                <CircularProgress />
                              </Box>
                            ) : activitiesStudents.length === 0 ? (
                              <Alert severity='info'>No students found for this activity.</Alert>
                            ) : (
                              <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                                <Table size='small'>
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>LRN</TableCell>
                                      <TableCell>Student Name</TableCell>
                                      <TableCell>Parent Name</TableCell>
                                      <TableCell>Grade</TableCell>
                                      <TableCell>Section</TableCell>
                                      <TableCell align='center'>Parent Present</TableCell>
                                      <TableCell align='center'>Student Present</TableCell>

                                      {/* ⬇️ rename + add a new column */}
                                      <TableCell align='center'>Payment Status</TableCell>
                                      <TableCell align='right'>Amount Paid</TableCell>
                                      <TableCell>Payment Date</TableCell>
                                    </TableRow>
                                  </TableHead>

                                  <TableBody>
                                    {activitiesStudents.map((student, i) => {
                                      const isFullyPaid =
                                        typeof student.is_fully_paid === 'number'
                                          ? student.is_fully_paid
                                          : student.payment_paid === 1
                                          ? 1
                                          : student.payment_paid === 0
                                          ? 0
                                          : null

                                      const paidAmount =
                                        student.paid_amount != null
                                          ? Number(student.paid_amount)
                                          : student.payment_amount != null
                                          ? Number(student.payment_amount)
                                          : null

                                      const latestPaymentDate =
                                        student.latest_payment_date || student.payment_date || null
                                      const contribEntries = Number(student.contrib_entries || 0)

                                      const unpaidButContrib =
                                        (isFullyPaid === 0 || isFullyPaid === null) && contribEntries > 0

                                      const paymentStatusChip =
                                        isFullyPaid === 1 ? (
                                          <Chip label='Paid' color='success' size='small' />
                                        ) : unpaidButContrib ? (
                                          <Chip label='N/A (Contrib)' color='default' size='small' />
                                        ) : (
                                          <Chip label='Unpaid' color='warning' size='small' />
                                        )

                                      const amountDisplay =
                                        isFullyPaid === 1
                                          ? paidAmount != null
                                            ? `₱${paidAmount.toFixed(2)}`
                                            : '₱0.00'
                                          : unpaidButContrib
                                          ? 'N/A'
                                          : '—'

                                      const dateDisplay =
                                        isFullyPaid === 1
                                          ? latestPaymentDate
                                            ? new Date(latestPaymentDate).toLocaleDateString()
                                            : '—'
                                          : unpaidButContrib
                                          ? 'N/A'
                                          : '—'

                                      const studentPresent = student.attendance_status === 'present'

                                      return (
                                        <TableRow key={student.id || i} hover>
                                          <TableCell>{student.lrn}</TableCell>
                                          <TableCell>
                                            {student.last_name}, {student.first_name}
                                          </TableCell>
                                          <TableCell>{student.parents || '—'}</TableCell>
                                          <TableCell>{student.grade_name}</TableCell>
                                          <TableCell>{student.section_name}</TableCell>
                                          <TableCell align='center'>
                                            <Chip
                                              label={student.parent_present ? 'Yes' : 'No'}
                                              color={student.parent_present ? 'success' : 'default'}
                                              size='small'
                                            />
                                          </TableCell>
                                          <TableCell align='center'>
                                            <Chip
                                              label={studentPresent ? 'Yes' : 'No'}
                                              color={studentPresent ? 'success' : 'error'}
                                              size='small'
                                            />
                                          </TableCell>

                                          {/* NEW/ADJUSTED payment cells */}
                                          <TableCell align='center'>{paymentStatusChip}</TableCell>
                                          <TableCell align='right'>{amountDisplay}</TableCell>
                                          <TableCell>{dateDisplay}</TableCell>
                                        </TableRow>
                                      )
                                    })}
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
            <Box onClick={openActivitiesSection} sx={{ cursor: 'pointer' }}>
              <UserDetails
                icon='mdi:calendar-account'
                color='info'
                count={loadingOverview ? <CircularProgress size={20} /> : overview?.total_activities ?? 0}
                title='Total Activities'
              />
            </Box>
          </Grid>
        )}
        {ability?.can('read', 'attendance') && (
          <>
            <Grid item xs={12} sm={6} md={2.4}>
              <UserDetails
                icon='mdi:account-check'
                color='success'
                count={
                  loadingOverview ? <CircularProgress size={20} /> : overview?.attendance?.parent_present_count ?? 0
                }
                title='Total Present'
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2.4}>
              <UserDetails
                icon='mdi:account-cancel'
                color='error'
                count={
                  loadingOverview ? <CircularProgress size={20} /> : overview?.attendance?.parent_absent_count ?? 0
                }
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
                <Typography variant='h6'>
                  Students by Grade
                  {selectedSchoolYear && (
                    <Chip component='span' label={selectedSchoolYear.name} size='small' sx={{ ml: 1 }} />
                  )}
                </Typography>
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

        {/* Activities Overview Section */}
        <Grid item xs={12} md={12}>
          {renderActivitiesOverview()}
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
                    present: a.parent_present_count || 0,
                    absent: a.parent_absent_count || 0,
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
                      <Chip label={activity.parent_present_count || 0} color='success' size='small' />
                    </TableCell>
                    <TableCell align='center'>
                      <Chip label={activity.parent_absent_count || 0} color='error' size='small' />
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

                    {/* ⬇️ rename + add a new column */}
                    <TableCell align='center'>Payment Status</TableCell>
                    <TableCell align='right'>Amount Paid</TableCell>
                    <TableCell>Payment Date</TableCell>

                    <TableCell align='center'>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activityStudents.map((student, i) => {
                    // ----- derived fields (works with old/new API) -----
                    // Prefer new fields (from Part B API): is_fully_paid, paid_amount, latest_payment_date, contrib_entries.
                    // Fallback to existing ones if needed.
                    const isFullyPaid =
                      typeof student.is_fully_paid === 'number'
                        ? student.is_fully_paid
                        : student.payment_paid === 1
                        ? 1
                        : student.payment_paid === 0
                        ? 0
                        : null

                    const paidAmount =
                      student.paid_amount != null
                        ? Number(student.paid_amount)
                        : student.payment_amount != null
                        ? Number(student.payment_amount)
                        : null

                    const latestPaymentDate = student.latest_payment_date || student.payment_date || null

                    const contribEntries = Number(student.contrib_entries || 0)

                    // rule: if UNPAID but has contributions -> show N/A for Amount + Date and a neutral status chip
                    const unpaidButContrib = (isFullyPaid === 0 || isFullyPaid === null) && contribEntries > 0

                    const paymentStatusChip =
                      isFullyPaid === 1 ? (
                        <Chip label='Paid' color='success' size='small' />
                      ) : unpaidButContrib ? (
                        <Chip label='N/A (Contrib)' color='default' size='small' />
                      ) : (
                        <Chip label='Unpaid' color='warning' size='small' />
                      )

                    const amountDisplay =
                      isFullyPaid === 1
                        ? paidAmount != null
                          ? `₱${paidAmount.toFixed(2)}`
                          : '₱0.00'
                        : unpaidButContrib
                        ? 'N/A'
                        : '—'

                    const dateDisplay =
                      isFullyPaid === 1
                        ? latestPaymentDate
                          ? new Date(latestPaymentDate).toLocaleDateString()
                          : '—'
                        : unpaidButContrib
                        ? 'N/A'
                        : '—'

                    return (
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

                        {/* NEW/ADJUSTED payment cells */}
                        <TableCell align='center'>{paymentStatusChip}</TableCell>
                        <TableCell align='right'>{amountDisplay}</TableCell>
                        <TableCell>{dateDisplay}</TableCell>

                        <TableCell align='center'>
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
                          </Stack>
                        </TableCell>
                      </TableRow>
                    )
                  })}
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

  // PDF Functions
  const handlePreviewForm = async student => {
    if (!student) return

    setPdfPreviewStudent(student)
    setPdfPreviewUrl('')
    setPdfError('')
    setPdfLoading(true)
    setPdfPreviewOpen(true)

    const legacyName = selectedSchoolYear?.name || ''

    const url =
      `/api/teacher/forms/parent-checklist?student_id=${student.student_id}` +
      `&school_year_id=${encodeURIComponent(schoolYearId ?? '')}` +
      (legacyName ? `&school_year=${encodeURIComponent(legacyName)}` : '') +
      `&preview=true`

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
        let bodyText = ''
        try {
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

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        try {
          URL.revokeObjectURL(pdfPreviewUrl)
        } catch (e) {}
      }
    }
  }, [pdfPreviewUrl])

  // Dialog
  const renderPdfPreviewDialog = () => (
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
  )

  useEffect(() => {
    const run = async () => {
      setLoadingSY(true)
      try {
        const { data } = await axios.get('/api/school-years')
        const list = data.school_years || []
        setSchoolYears(list)
        const current = list.find(sy => sy.is_current === 1) || list[0]
        setSchoolYearId(current?.id ?? null)
      } catch (e) {
        console.error('Failed to load school years', e)
      } finally {
        setLoadingSY(false)
      }
    }
    run()
  }, [])

  const renderTopFilters = () => (
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

        <Autocomplete
          size='small'
          sx={{ minWidth: 220 }}
          options={schoolYears}
          getOptionLabel={o => o.name}
          value={schoolYears.find(sy => sy.id === schoolYearId) || null}
          onChange={(_e, val) => setSchoolYearId(val?.id ?? null)}
          loading={loadingSY}
          renderInput={params => <TextField {...params} label='School Year' placeholder='Select school year' />}
        />

        <Autocomplete
          multiple
          size='small'
          sx={{ minWidth: 320 }}
          options={parentOptions}
          getOptionLabel={option => `${option.last_name}, ${option.first_name}`}
          filterSelectedOptions
          value={parentFilter}
          onChange={(_e, value) => {
            setParentFilter(value)

            // other fetches will run automatically because parentFilter is in the useEffect deps
          }}
          onInputChange={(_e, value) => {
            // lazy search parents
            if (value && value.length >= 2) fetchParents(value)
          }}
          loading={parentLoading}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <Checkbox sx={{ mr: 1 }} size='small' checked={parentFilter.some(p => p.id === option.id)} />
              <Avatar sx={{ width: 24, height: 24, mr: 1 }}>{(option.first_name || '').charAt(0)}</Avatar>
              {option.last_name}, {option.first_name}
            </li>
          )}
          renderInput={params => (
            <TextField
              {...params}
              placeholder='Filter by parent (type at least 2 chars)'
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position='start'>
                    <PeopleIcon />
                  </InputAdornment>
                )
              }}
            />
          )}
        />

        <Button
          variant='outlined'
          onClick={() => {
            setParentFilter([])
            setParentPupils({})
          }}
        >
          Clear Parent Filter
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
  )

  const renderSelectedParentsPupils = () => {
    if (!parentFilter || parentFilter.length === 0) return null

    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant='subtitle2'>Selected Parents & Pupils</Typography>
        <Stack direction='row' spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {parentFilter.map(p => (
            <Box key={p.id} sx={{ border: '1px solid #eee', p: 1, borderRadius: 1, minWidth: 220 }}>
              <Typography variant='body2' sx={{ fontWeight: 600 }}>{`${p.last_name}, ${p.first_name}`}</Typography>
              <Typography variant='caption' color='text.secondary'>
                Pupils:
              </Typography>
              <Box>
                {(parentPupils[p.id] || []).map(s => (
                  <Chip
                    key={s.id}
                    label={`${s.last_name}, ${s.first_name} (${s.lrn})`}
                    size='small'
                    sx={{ mr: 0.5, mt: 0.5 }}
                  />
                ))}
                {(parentPupils[p.id] || []).length === 0 && (
                  <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                    No pupils found
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Stack>
      </Box>
    )
  }

  // ---------- UI ----------
  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        {/* Date filters and refresh (always visible) */}
        {/* <Stack direction='row' spacing={2} alignItems='center' justifyContent='space-between' sx={{ mb: 2 }}>
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
        </Stack> */}

        {/* Top filters (includes date + parent filter + refresh) */}
        {renderTopFilters()}

        {/* Optionally render the selected parents and their pupils so the admin/teacher sees who is included */}
        {renderSelectedParentsPupils()}

        {/* Breadcrumbs */}
        {renderBreadcrumbs()}

        {/* Content based on current view */}
        {currentView === VIEW_TYPES.OVERVIEW && renderOverview()}
        {currentView === VIEW_TYPES.ACTIVITIES && renderActivities()}
        {currentView === VIEW_TYPES.STUDENTS && renderStudents()}
      </Grid>
      {renderPdfPreviewDialog()}
    </Grid>
  )
}

Dashboard.acl = { action: 'read', subject: 'dashboard' }

export default Dashboard
