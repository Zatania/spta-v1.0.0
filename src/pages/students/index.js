// pages/admin/students.js
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
  InputAdornment,
  Stack,
  Avatar,
  Typography,
  FormControl,
  InputLabel,
  Select,
  Divider,
  Alert
} from '@mui/material'
import FlagIcon from '@mui/icons-material/Flag'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import UpgradeIcon from '@mui/icons-material/Upgrade'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import DeleteIcon from '@mui/icons-material/Delete'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import axios from 'axios'
import { DataGrid } from '@mui/x-data-grid'
import debounce from 'lodash.debounce'
import { saveAs } from 'file-saver'
import Autocomplete from '@mui/material/Autocomplete'

export default function StudentsPage() {
  const { data: session, status } = useSession()
  const [students, setStudents] = useState([])
  const [grades, setGrades] = useState([])
  const [sectionsAll, setSectionsAll] = useState([])
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  const [schoolYears, setSchoolYears] = useState([])
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [activeRow, setActiveRow] = useState(null)

  // filters & paging
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('') // '' = All grades
  const [sectionFilter, setSectionFilter] = useState('') // '' = All sections
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  // role-aware: teacher info
  const [me, setMe] = useState(null) // { user, teacher: { assigned_sections: [...] } }

  // dialog (add/edit)
  const [open, setOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false) // Track if we're editing vs creating

  // parents
  const [parents, setParents] = useState([])
  const [parentsLoading, setParentsLoading] = useState(false)
  const [parentsInput, setParentsInput] = useState('')

  const emptyForm = {
    id: null,
    first_name: '',
    last_name: '',
    lrn: '',
    grade_id: '',
    section_id: '',
    teacher_id: '',
    parent_id: '',
    parent_relation: '',
    picture: null,
    picture_preview: null
  }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  // parent dialog
  const [parentDialogOpen, setParentDialogOpen] = useState(false)

  const [parentForm, setParentForm] = useState({
    first_name: '',
    last_name: '',
    contact_info: '',
    relation: ''
  })
  const [savingParent, setSavingParent] = useState(false)

  const [promoteForm, setPromoteForm] = useState({
    school_year_id: '', // default to next SY after load
    grade_id: '',
    section_id: ''
  })

  const [transferForm, setTransferForm] = useState({
    grade_id: '',
    section_id: ''
  })

  const [statusOpen, setStatusOpen] = useState(false)

  const [statusForm, setStatusForm] = useState({
    enrollment_id: '',
    status: '',
    completion_school_year_id: '',
    completion_grade_id: '',
    completion_section_id: ''
  })

  const Hint = ({ title }) => (
    <InputAdornment position='end' sx={{ ml: 0.5 }}>
      <Tooltip title={title}>
        <InfoOutlinedIcon fontSize='small' sx={{ color: 'text.secondary', cursor: 'help' }} />
      </Tooltip>
    </InputAdornment>
  )

  const openStatus = row => {
    setActiveRow(row)
    setStatusForm({
      enrollment_id: String(row.enrollment_id || ''), // must be provided by API
      status: row.enrollment_status || '',
      completion_school_year_id: row.completion_school_year_id ? String(row.completion_school_year_id) : '',
      completion_grade_id: row.completion_grade_id ? String(row.completion_grade_id) : '',
      completion_section_id: row.completion_section_id ? String(row.completion_section_id) : ''
    })
    setStatusOpen(true)
  }

  useEffect(() => {
    // load school years once
    axios
      .get('/api/school-years')
      .then(r => setSchoolYears(r.data ?? []))
      .catch(() => {})
  }, [])

  const openPromote = row => {
    setActiveRow(row)

    // find current and next SY
    const current = schoolYears.find(sy => sy.is_current === 1)
    const next = schoolYears.find(sy => new Date(sy.start_date) > new Date(current?.start_date || 0))
    setPromoteForm({
      school_year_id: String(next?.id || ''), // allow manual change if needed
      grade_id: '',
      section_id: ''
    })
    setPromoteOpen(true)
  }

  const openTransfer = row => {
    setActiveRow(row)
    setTransferForm({ grade_id: '', section_id: '' })
    setTransferOpen(true)
  }

  // load user info and static lists
  useEffect(() => {
    fetchMyInfo()
    fetchGrades()
    fetchSectionsAll()
    fetchTeachers()
    fetchParents()
  }, [])

  useEffect(() => {
    fetchStudents()
  }, [page, pageSize])

  // fetch current user + assigned sections (if teacher)
  const fetchMyInfo = async () => {
    try {
      const res = await axios.get('/api/teachers/me')
      setMe(res.data) // { user, teacher }
      // If user is a teacher and has assigned sections: set filters to limit listing
      if (res.data?.teacher?.assigned_sections) {
        const assigned = res.data.teacher.assigned_sections
        if (assigned.length === 1) {
          // single assigned section -> constrain filters to that
          setGradeFilter(String(assigned[0].grade_id ?? ''))
          setSectionFilter(String(assigned[0].id ?? ''))
        } else if (assigned.length > 1) {
          // multiple assigned sections -> default to showing all of those sections (no global filter)
          // We'll keep filters empty but keep assigned list for UI restriction later
        }
      }
    } catch (err) {
      console.error('Failed to fetch my info', err)
    }
  }

  const fetchGrades = async () => {
    try {
      const res = await axios.get('/api/grades')
      setGrades(res.data ?? [])
    } catch (err) {
      console.error('Failed to load grades', err)
    }
  }

  // Fetch all non-deleted sections (for filters & student assignment)
  const fetchSectionsAll = async () => {
    try {
      const res = await axios.get('/api/sections', { params: { page: 1, page_size: 1000 } })
      const list = res.data?.sections ?? res.data ?? []
      setSectionsAll(
        list.map(s => ({
          id: s.id,
          name: s.section_name ?? s.name ?? '',
          grade_id: s.grade_id ?? s.gradeId,
          grade_name: s.grade_name ?? s.gradeName
        }))
      )
    } catch (err) {
      console.error('Failed to load sections', err)
    }
  }

  // Fetch teachers for assignment
  const fetchTeachers = async () => {
    try {
      const res = await axios.get('/api/teachers/list')
      setTeachers(res.data ?? [])
    } catch (err) {
      console.error('Failed to load teachers', err)
    }
  }

  // Fetch all parents for dropdown

  const searchParents = debounce((query, loader) => {
    loader(query)
  }, 300)

  const fetchParents = async (q = '') => {
    setParentsLoading(true)
    try {
      const res = await axios.get('/api/parents', {
        params: { search: q || undefined, page_size: 100, page: 1 }
      })
      setParents(res.data?.parents ?? [])

      return res.data // <-- so callers can inspect
    } finally {
      setParentsLoading(false)
    }
  }

  const selectedParent = (() => {
    const fromOptions = parents.find(p => String(p.id) === String(form.parent_id))

    return fromOptions || form.parent || null
  })()

  const parentOptionsMerged =
    selectedParent && !parents.some(p => p.id === selectedParent.id) ? [selectedParent, ...parents] : parents

  // Build query params for listing students, always ensure teacher restrictions are applied client-side too
  const buildListParams = (overrides = {}) => {
    // If current user is a teacher and they have assigned_sections, limit values returned
    const params = {}

    // base filters: prefer overrides, else current state
    const searchVal = overrides.search ?? search
    const gradeVal = overrides.grade ?? gradeFilter
    const sectionVal = overrides.section ?? sectionFilter

    if (searchVal) params.search = searchVal
    if (gradeVal) params.grade_id = gradeVal
    if (sectionVal) params.section_id = sectionVal

    // If user is teacher with assigned_sections:
    if (me?.teacher?.assigned_sections) {
      const assigned = me.teacher.assigned_sections
      if (assigned.length === 1) {
        // enforce single assigned section
        params.section_id = String(assigned[0].id)
        params.grade_id = String(assigned[0].grade_id)
      } else if (assigned.length > 1) {
        // teacher with multiple sections: if section filter is empty, do nothing (server must restrict)
        // but to be safe, you could send a list of allowed section_ids as CSV param
        // (server currently restricts teacher to only their sections; this is an optional enhancement)
        // For now, we leave params as-is so teacher can pick which of their sections to filter by.
      }
    }

    // pagination
    params.page = (overrides.page ?? page) + 1
    params.page_size = overrides.pageSize ?? pageSize

    return params
  }

  const fetchStudents = async (opts = {}) => {
    setLoading(true)
    try {
      const params = buildListParams(opts)

      // remove empty entries
      Object.keys(params).forEach(k => {
        if (params[k] === '' || params[k] == null) delete params[k]
      })
      const res = await axios.get('/api/students', { params })
      setStudents(res.data.students ?? [])
      setTotal(res.data.total ?? 0)
    } catch (err) {
      console.error('Failed to fetch students', err)
    } finally {
      setLoading(false)
    }
  }

  // search debounced
  const debouncedSearch = useCallback(
    debounce(v => {
      setPage(0)
      fetchStudents({ search: v, page: 0 })
    }, 400),
    [me, gradeFilter, sectionFilter]
  )

  const onSearchChange = e => {
    const v = e.target.value
    setSearch(v)
    debouncedSearch(v)
  }

  // Filter interactions (admins vs teachers)
  const onGradeFilterChange = value => {
    // If teacher with single assigned section, ignore changes (disabled in UI)
    if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length === 1) return

    setGradeFilter(value)
    setSectionFilter('') // when grade changes, reset section to All
    setPage(0)
    fetchStudents({ grade: value, section: '', page: 0 })
  }

  const onSectionFilterChange = value => {
    // If teacher with single assigned section, ignore changes (disabled in UI)
    if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length === 1) return

    if (!value) {
      setSectionFilter('')
      setPage(0)
      fetchStudents({ page: 0 })

      return
    }
    const sec = sectionsAll.find(s => String(s.id) === String(value))
    if (sec) {
      setSectionFilter(value)
      setGradeFilter(String(sec.grade_id ?? ''))
      setPage(0)
      fetchStudents({ section: value, grade: String(sec.grade_id ?? ''), page: 0 })
    } else {
      setSectionFilter(value)
      setPage(0)
      fetchStudents({ section: value, page: 0 })
    }
  }

  // Handle image upload
  const handleImageChange = event => {
    const file = event.target.files[0]
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file')

        return
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size should be less than 5MB')

        return
      }

      const reader = new FileReader()
      reader.onloadend = () => {
        setForm(prev => ({
          ...prev,
          picture: file,
          picture_preview: reader.result
        }))
      }
      reader.readAsDataURL(file)
    }
  }

  // Auto-select teacher based on grade and section (only for new students)
  const autoSelectTeacher = (gradeId, sectionId, skipIfEditing = false) => {
    if (!gradeId || !sectionId) return ''

    // Skip auto-selection when editing existing student
    if (skipIfEditing && isEditing) return form.teacher_id

    // Find teacher assigned to this section
    // Add safe access to assigned_sections
    const teacher = teachers.find(t =>
      t.assigned_sections?.some(
        s => s && s.id && String(s.id) === String(sectionId) && s.grade_id && String(s.grade_id) === String(gradeId)
      )
    )

    return teacher ? String(teacher.id) : ''
  }

  // Open create/edit dialog
  const openCreate = () => {
    setIsEditing(false)
    const newForm = { ...emptyForm }

    // If teacher with single assigned section, prefill and lock grade/section
    if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length === 1) {
      const a = me.teacher.assigned_sections[0]
      newForm.grade_id = String(a.grade_id)
      newForm.section_id = String(a.id)
      newForm.teacher_id = String(me.user.id) // Auto-select current teacher
    } else if (me?.teacher?.assigned_sections && me.teacher.assigned_sections.length > 1) {
      const gradeIds = Array.from(new Set(me.teacher.assigned_sections.map(s => String(s.grade_id))))
      if (gradeIds.length === 1) newForm.grade_id = gradeIds[0]
      newForm.teacher_id = String(me.user.id)
    }

    setForm(newForm)
    setOpen(true)
  }

  const openEdit = async row => {
    setIsEditing(true)
    try {
      const res = await axios.get(`/api/students/${row.id}`)
      const stu = res.data

      const primaryParent = (stu.parents && stu.parents[0]) || null

      const newForm = {
        id: stu.id,
        first_name: stu.first_name,
        last_name: stu.last_name,
        lrn: stu.lrn,
        grade_id: String(stu.grade_id ?? ''),
        section_id: String(stu.section_id ?? ''),
        teacher_id: String(stu.teacher_id ?? ''),
        parent_id: primaryParent?.id ? String(primaryParent.id) : '',
        parent: primaryParent, // <-- keep the whole object for Autocomplete stability
        parent_relation: primaryParent?.relation || '',
        picture: null,
        picture_preview: stu.picture_url || null
      }

      setForm(newForm)
      setOpen(true)
    } catch (err) {
      console.error('Failed to load student', err)
      alert('Failed to load student data')
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      // Validate required fields
      if (!form.first_name || !form.last_name || !form.lrn || !form.grade_id || !form.section_id) {
        alert('Please fill in all required fields')
        setSaving(false)

        return
      }

      if (isTeacher && !isEditing) {
        const ownsSelectedSection = teacherAssignedSections.some(
          s => String(s.id) === String(form.section_id) && String(s.grade_id) === String(form.grade_id)
        )
        if (!ownsSelectedSection) {
          alert('Teachers can only add students to their active assigned section for the current school year.')
          setSaving(false)

          return
        }
      }

      /* // For new students, require image
      if (!form.id && !form.picture) {
        alert('Please upload a student picture')
        setSaving(false)

        return
      } */

      const formData = new FormData()
      formData.append('first_name', form.first_name)
      formData.append('last_name', form.last_name)
      formData.append('lrn', form.lrn)
      formData.append('grade_id', form.grade_id)
      formData.append('section_id', form.section_id)
      formData.append('teacher_id', form.teacher_id)
      formData.append('parent_id', form.parent_id)
      formData.append('parent_relation', form.parent_relation || '')

      if (form.picture) {
        formData.append('picture', form.picture)
      }

      if (form.id) {
        await axios.put(`/api/students/${form.id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      } else {
        await axios.post('/api/students', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      }

      setOpen(false)
      fetchStudents({ page: 0 })
      fetchSectionsAll()
    } catch (err) {
      console.error('Save failed', err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async id => {
    if (!confirm('Soft-delete this student?')) return
    try {
      await axios.delete(`/api/students/${id}`)
      fetchStudents({ page: 0 })
    } catch (err) {
      console.error('Delete failed', err)
      alert(err?.response?.data?.message ?? 'Delete failed')
    }
  }

  // Parent creation
  const saveParent = async () => {
    setSavingParent(true)
    try {
      if (!parentForm.first_name || !parentForm.last_name) {
        alert('Please fill in parent first name and last name')
        setSavingParent(false)

        return
      }

      const res = await axios.post('/api/parents', parentForm)
      const newParentId = res.data.id

      // Refresh and try to center the new parent by searching its name
      const q = `${parentForm.last_name} ${parentForm.first_name}`.trim()

      const listResp = await axios.get('/api/parents', {
        params: { search: q, page_size: 20 }
      })
      const refreshedParents = listResp.data?.parents ?? []
      setParents(refreshedParents)

      const created = refreshedParents.find(p => String(p.id) === String(newParentId)) || {
        id: newParentId,
        first_name: parentForm.first_name,
        last_name: parentForm.last_name,
        contact_info: parentForm.contact_info,
        relations: parentForm.relation ? [parentForm.relation] : []
      }

      // Auto-select the newly created parent
      setForm(prev => ({
        ...prev,
        parent_id: String(newParentId),
        parent: created, // keep the object so Autocomplete value stays stable
        parent_relation: parentForm.relation || prev.parent_relation || ''
      }))

      setParentDialogOpen(false)
      setParentForm({
        first_name: '',
        last_name: '',
        contact_info: '',
        relation: ''
      })
    } catch (err) {
      console.error('Failed to create parent', err)
      alert(err?.response?.data?.message ?? 'Failed to create parent')
    } finally {
      setSavingParent(false)
    }
  }

  // Export (honor teacher filters)
  const exportStudents = async (format = 'csv') => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      params.set('format', format)

      // build params same as list
      const built = buildListParams({})
      if (built.grade_id) params.set('grade_id', built.grade_id)
      if (built.section_id) params.set('section_id', built.section_id)
      if (built.search) params.set('search', built.search)

      const res = await axios.get(`/api/export/students?${params.toString()}`, { responseType: 'blob' })
      const cd = res.headers['content-disposition'] || ''
      const m = cd.match(/filename="?([^"]+)"?/)
      const filename = m ? m[1] : `students_export.${format === 'xlsx' ? 'xlsx' : 'csv'}`
      saveAs(res.data, filename)
    } catch (err) {
      console.error('Export failed', err)
      alert(err?.response?.data?.message ?? 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const columns = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'lrn', headerName: 'LRN', width: 140 },
    { field: 'last_name', headerName: 'Last name', width: 140 },
    { field: 'first_name', headerName: 'First name', width: 140 },
    { field: 'grade_name', headerName: 'Grade', width: 120 },
    {
      field: 'enrollment_status',
      headerName: 'Status',
      width: 150,
      valueGetter: p => {
        const m = {
          active: 'Active',
          promoted: 'Promoted',
          withdrawn: 'Drop out',
          retained: 'Retain',
          transferred: 'Transfer',
          completed: 'Complete'
        }

        return m[p.row.enrollment_status] || p.row.enrollment_status || ''
      }
    },

    /* { field: 'section_name', headerName: 'Section', width: 140 },
    { field: 'teacher_name', headerName: 'Teacher', width: 160 }, */
    {
      field: 'actions',
      headerName: 'Actions',
      width: 200,
      renderCell: params => (
        <Stack direction='row' spacing={1}>
          <Tooltip title='Edit student details'>
            <IconButton size='small' onClick={() => openEdit(params.row)}>
              <EditIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Delete'>
            <IconButton size='small' color='error' onClick={() => remove(params.row.id)}>
              <DeleteIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='End-of-year move to next school year. Marks this year as Promoted.'>
            <IconButton size='small' onClick={() => openPromote(params.row)}>
              <UpgradeIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Mid-year internal move within the same school year.'>
            <IconButton size='small' onClick={() => openTransfer(params.row)}>
              <SwapHorizIcon fontSize='small' />
            </IconButton>
          </Tooltip>
          <Tooltip title='Set end-of-year outcome: Retain, Drop out, Transfer (out), or Complete (Grade 6).'>
            <IconButton size='small' onClick={() => openStatus(params.row)}>
              <FlagIcon fontSize='small' />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    }
  ]

  // UI state helpers
  const isTeacher = session?.user?.role === 'teacher'
  const teacherAssignedSections = me?.teacher?.assigned_sections ?? []
  const teacherAllowedGradeIds = Array.from(new Set(teacherAssignedSections.map(s => String(s.grade_id))))
  const visibleGrades = isTeacher ? grades.filter(g => teacherAllowedGradeIds.includes(String(g.id))) : grades

  // If teacher has exactly 1 assigned section and is creating (not editing), show that grade/section as fixed
  const shouldDisableGradeSection = isTeacher && teacherAssignedSections.length === 1 && !isEditing

  // Get available sections based on selected grade and user role
  const getAvailableSections = () => {
    if (isTeacher && !isEditing) {
      // For teachers creating new students, limit to assigned sections
      return teacherAssignedSections.filter(s => !form.grade_id || String(s.grade_id) === String(form.grade_id))
    } else {
      // For admins or when editing, show all sections for the selected grade
      return sectionsAll.filter(s => !form.grade_id || String(s.grade_id) === String(form.grade_id))
    }
  }

  // Get available teachers based on selected grade and section
  const getAvailableTeachers = () => {
    if (!form.grade_id || !form.section_id) return teachers

    return teachers.filter(t =>
      t.assigned_sections?.some(
        s => String(s.id) === String(form.section_id) && String(s.grade_id) === String(form.grade_id)
      )
    )
  }

  // Helper function to get teacher display name
  const getTeacherDisplayName = teacher => {
    return (
      teacher.full_name ||
      (teacher.first_name && teacher.last_name ? `${teacher.first_name} ${teacher.last_name}` : '') ||
      teacher.username ||
      teacher.name ||
      `Teacher ${teacher.id}`
    )
  }

  return (
    <Box p={3}>
      <Box display='flex' gap={2} alignItems='center' mb={2} flexWrap='wrap'>
        <TextField
          size='small'
          placeholder='Search student name / LRN'
          value={search}
          onChange={onSearchChange}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <SearchIcon />
              </InputAdornment>
            )
          }}
          sx={{ minWidth: 320 }}
        />

        {/* Grade filter: admins can change. Teachers either have it disabled (single section) or it auto-selects */}
        <TextField
          select
          size='small'
          label='Grade'
          value={gradeFilter}
          onChange={e => onGradeFilterChange(e.target.value)}
          sx={{ minWidth: 160 }}
          disabled={isTeacher && teacherAssignedSections.length === 1}
        >
          <MenuItem value=''>{isTeacher ? 'All assigned grades' : 'All Grades'}</MenuItem>
          {visibleGrades.map(g => (
            <MenuItem key={g.id} value={String(g.id)}>
              {g.name}
            </MenuItem>
          ))}
        </TextField>

        {/* Section filter: admins can pick any, teachers limited to assigned sections */}
        <TextField
          select
          size='small'
          label='Section'
          value={sectionFilter}
          onChange={e => onSectionFilterChange(e.target.value)}
          sx={{ minWidth: 200 }}
          disabled={isTeacher && teacherAssignedSections.length === 1}
        >
          <MenuItem value=''>{isTeacher ? 'All assigned sections' : 'All Sections'}</MenuItem>

          {isTeacher
            ? // teacher sees only their assigned sections in the filter list (or all if admin)
              teacherAssignedSections.map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.name}
                </MenuItem>
              ))
            : // admins see all sections
              sectionsAll
                .filter(s => !gradeFilter || String(s.grade_id) === String(gradeFilter))
                .map(s => (
                  <MenuItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </MenuItem>
                ))}
        </TextField>

        <Box sx={{ flexGrow: 1 }} />

        <Button variant='outlined' onClick={() => exportStudents('csv')} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </Button>
        <Button variant='outlined' onClick={() => exportStudents('xlsx')} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export XLSX'}
        </Button>
        <Button startIcon={<AddIcon />} variant='contained' onClick={openCreate}>
          Add Student
        </Button>
      </Box>

      <div style={{ width: '100%' }}>
        <DataGrid
          rows={students}
          columns={columns}
          autoHeight
          pageSize={pageSize}
          rowsPerPageOptions={[10, 25, 50]}
          paginationMode='server'
          rowCount={total}
          page={page}
          onPageChange={newPage => {
            setPage(newPage)
            fetchStudents({ page: newPage })
          }}
          onPageSizeChange={newSize => {
            setPageSize(newSize)
            setPage(0)
            fetchStudents({ page: 0, pageSize: newSize })
          }}
          getRowId={r => r.id}
          loading={loading}
        />
      </div>

      {/* Student Dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='md'>
        <DialogTitle>{form.id ? 'Edit Student' : 'Add Student'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {isTeacher && !teacherAssignedSections.length && (
            <Alert severity='warning'>You have no active section assignment for the current school year. Ask the admin to assign you before adding students.</Alert>
          )}

          {/* Student Picture Upload */}
          {/* <Box display='flex' alignItems='center' gap={2}>
            <Avatar src={form.picture_preview} sx={{ width: 80, height: 80 }}>
              {form.first_name?.[0]}
              {form.last_name?.[0]}
            </Avatar>
            <Box>
              <input
                accept='image/*'
                style={{ display: 'none' }}
                id='picture-upload'
                type='file'
                onChange={handleImageChange}
              />
              <label htmlFor='picture-upload'>
                <Button variant='outlined' component='span' startIcon={<PhotoCameraIcon />}>
                  Upload Picture
                </Button>
              </label>
              {!form.id && (
                <Typography variant='caption' display='block' color='textSecondary' mt={1}>
                  * Picture required for new students
                </Typography>
              )}
            </Box>
          </Box>

          <Divider /> */}

          {/* Basic Info */}
          <Box display='flex' gap={2}>
            <TextField
              label='First Name *'
              value={form.first_name}
              onChange={e => setForm({ ...form, first_name: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label='Last Name *'
              value={form.last_name}
              onChange={e => setForm({ ...form, last_name: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label='LRN *'
              value={form.lrn}
              onChange={e => setForm({ ...form, lrn: e.target.value })}
              fullWidth
              required
              helperText='LRN must be unique in the system.'
              InputProps={{ endAdornment: <Hint title='LRN duplicates are blocked on save.' /> }}
            />
          </Box>

          {/* Academic Info */}
          <Box display='flex' gap={2}>
            <TextField
              select
              label='Grade *'
              value={form.grade_id}
              onChange={e => {
                const newGradeId = e.target.value
                const newTeacherId = autoSelectTeacher(newGradeId, form.section_id, true)
                setForm({
                  ...form,
                  grade_id: newGradeId,
                  section_id: shouldDisableGradeSection ? form.section_id : '', // Keep section if teacher restricted
                  teacher_id: newTeacherId
                })
              }}
              fullWidth
              disabled={shouldDisableGradeSection}
              required
              helperText={isTeacher ? 'Limited to your active assigned grade/section.' : 'Choose a grade first; available sections will follow.'}
              InputProps={{ endAdornment: <Hint title='Sections list depends on the selected grade.' /> }}
            >
              <MenuItem value=''>-- Select Grade --</MenuItem>
              {visibleGrades.map(g => (
                <MenuItem key={g.id} value={String(g.id)}>
                  {g.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label='Section *'
              value={form.section_id}
              onChange={e => {
                const newSectionId = e.target.value
                const newTeacherId = autoSelectTeacher(form.grade_id, newSectionId, true)
                setForm({
                  ...form,
                  section_id: newSectionId,
                  teacher_id: newTeacherId
                })
              }}
              disabled={shouldDisableGradeSection}
              fullWidth
              required
              helperText='After picking a section, the teacher may auto-fill.'
              InputProps={{
                endAdornment: <Hint title='We try to auto-select the teacher assigned to this section.' />
              }}
            >
              <MenuItem value=''>-- Select Section --</MenuItem>
              {getAvailableSections().map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          {/* Teacher Assignment */}
          <TextField
            select
            label='Teacher'
            value={form.teacher_id}
            onChange={e => setForm({ ...form, teacher_id: e.target.value })}
            fullWidth
            helperText='Optional: assign a primary teacher for quick reference.'
            InputProps={{ endAdornment: <Hint title='This links the student to a teacher’s section view.' /> }}
          >
            <MenuItem value=''>-- Select Teacher --</MenuItem>
            {getAvailableTeachers().map(t => (
              <MenuItem key={t.id} value={String(t.id)}>
                {getTeacherDisplayName(t)}
              </MenuItem>
            ))}
          </TextField>

          <Divider />

          {/* Parent Selection */}
          <Box>
            <Box display='flex' justifyContent='space-between' alignItems='center' mb={1}>
              <Typography variant='subtitle1'>Parent/Guardian</Typography>
              <Button size='small' startIcon={<PersonAddIcon />} onClick={() => setParentDialogOpen(true)}>
                Add New Parent
              </Button>
            </Box>

            <Autocomplete
              options={parents}
              size='small'
              fullWidth
              value={selectedParent}
              onChange={(_e, val) => setForm({ ...form, parent_id: val ? String(val.id) : '' })}
              getOptionLabel={o =>
                o ? `${o.last_name}, ${o.first_name}${o.contact_info ? ` (${o.contact_info})` : ''}` : ''
              }
              isOptionEqualToValue={(opt, val) => String(opt?.id) === String(val?.id)}
              onInputChange={(_e, input, reason) => {
                setParentsInput(input)
                if (reason === 'input') {
                  if (input && input.length >= 2) fetchParents(input)
                  else fetchParents('')
                }
              }}
              loadingText='Searching...'
              renderInput={params => (
                <TextField
                  {...params}
                  label='Select Parent'
                  placeholder='Type to search parents'
                  helperText='Type 2+ characters to search • Use “Add New Parent” if not found.'
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        <Hint title='Searching starts after 2 characters. You can also add a new parent.' />
                        {params.InputProps.endAdornment}
                      </>
                    )
                  }}
                />
              )}
              noOptionsText='No parents found'
            />
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={save} disabled={saving}>
            {saving ? 'Saving...' : form.id ? 'Update Student' : 'Save Student'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Parent Dialog */}
      <Dialog open={parentDialogOpen} onClose={() => setParentDialogOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>Add New Parent</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label='First Name *'
            value={parentForm.first_name}
            onChange={e => setParentForm({ ...parentForm, first_name: e.target.value })}
            fullWidth
            required
          />
          <TextField
            label='Last Name *'
            value={parentForm.last_name}
            onChange={e => setParentForm({ ...parentForm, last_name: e.target.value })}
            fullWidth
            required
          />
          <TextField
            label='Contact Info'
            value={parentForm.contact_info}
            onChange={e => setParentForm({ ...parentForm, contact_info: e.target.value })}
            fullWidth
            placeholder='Phone number, email, etc.'
          />
          <TextField
            select
            label='Relation'
            value={parentForm.relation}
            onChange={e => setParentForm({ ...parentForm, relation: e.target.value })}
            fullWidth
          >
            <MenuItem value=''>-- Select Relation --</MenuItem>
            <MenuItem value='Father'>Father</MenuItem>
            <MenuItem value='Mother'>Mother</MenuItem>
            <MenuItem value='Guardian'>Guardian</MenuItem>
            <MenuItem value='Grandmother'>Grandmother</MenuItem>
            <MenuItem value='Grandfather'>Grandfather</MenuItem>
            <MenuItem value='Aunt'>Aunt</MenuItem>
            <MenuItem value='Uncle'>Uncle</MenuItem>
            <MenuItem value='Other'>Other</MenuItem>
          </TextField>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setParentDialogOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={saveParent} disabled={savingParent}>
            {savingParent ? 'Saving...' : 'Save Parent'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={promoteOpen} onClose={() => setPromoteOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>Promote {activeRow ? `${activeRow.last_name}, ${activeRow.first_name}` : ''}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            select
            label='Target School Year'
            value={promoteForm.school_year_id}
            onChange={e => setPromoteForm(f => ({ ...f, school_year_id: e.target.value }))}
            fullWidth
            helperText='Creates a new enrollment row for the selected school year.'
            InputProps={{ endAdornment: <Hint title='This does not modify the current year row.' /> }}
          >
            {schoolYears
              .filter(
                sy =>
                  !schoolYears.find(s => s.is_current === 1) ||
                  new Date(sy.start_date) >= new Date(schoolYears.find(s => s.is_current === 1).start_date)
              )
              .map(sy => (
                <MenuItem key={sy.id} value={String(sy.id)}>
                  {sy.name}
                  {sy.is_current ? ' (current)' : ''}
                </MenuItem>
              ))}
          </TextField>

          <TextField
            select
            label='Target Grade'
            value={promoteForm.grade_id}
            onChange={e => setPromoteForm(f => ({ ...f, grade_id: e.target.value }))}
            fullWidth
            helperText='Pick the grade for next school year (same grade if retained).'
            InputProps={{ endAdornment: <Hint title='For repeaters, choose the same grade next SY.' /> }}
          >
            <MenuItem value=''>-- Select Grade --</MenuItem>
            {visibleGrades.map(g => (
              <MenuItem key={g.id} value={String(g.id)}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label='Target Section'
            value={promoteForm.section_id}
            onChange={e => setPromoteForm(f => ({ ...f, section_id: e.target.value }))}
            fullWidth
            disabled={!promoteForm.grade_id}
            helperText='Select a section in the chosen grade.'
            InputProps={{ endAdornment: <Hint title='Section list is filtered by the selected grade.' /> }}
          >
            <MenuItem value=''>-- Select Section --</MenuItem>
            {sectionsAll
              .filter(s => !promoteForm.grade_id || String(s.grade_id) === String(promoteForm.grade_id))
              .map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.name}
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromoteOpen(false)}>Cancel</Button>
          <Button
            variant='contained'
            onClick={async () => {
              if (!activeRow) return
              try {
                await axios.post(`/api/students/${activeRow.id}/promote`, {
                  to_school_year_id: promoteForm.school_year_id || undefined,
                  to_grade_id: promoteForm.grade_id,
                  to_section_id: promoteForm.section_id,
                  mark_previous_as: 'promoted'
                })
                setPromoteOpen(false)
                fetchStudents({ page: 0 }) // refresh
              } catch (e) {
                alert(e?.response?.data?.message ?? 'Promote failed')
              }
            }}
            disabled={!promoteForm.grade_id || !promoteForm.section_id}
          >
            Promote
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={transferOpen} onClose={() => setTransferOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>Transfer {activeRow ? `${activeRow.last_name}, ${activeRow.first_name}` : ''}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            select
            label='New Grade'
            value={transferForm.grade_id}
            onChange={e => setTransferForm(f => ({ ...f, grade_id: e.target.value }))}
            fullWidth
            helperText='Mid-year internal move (same school year).'
            InputProps={{ endAdornment: <Hint title='Internal reassignment—does not set status to “transferred”.' /> }}
          >
            <MenuItem value=''>-- Select Grade --</MenuItem>
            {visibleGrades.map(g => (
              <MenuItem key={g.id} value={String(g.id)}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label='New Section'
            value={transferForm.section_id}
            onChange={e => setTransferForm(f => ({ ...f, section_id: e.target.value }))}
            fullWidth
            disabled={!transferForm.grade_id}
            helperText='Pick a section in the selected grade.'
            InputProps={{ endAdornment: <Hint title='Section list depends on the chosen grade.' /> }}
          >
            <MenuItem value=''>-- Select Section --</MenuItem>
            {sectionsAll
              .filter(s => !transferForm.grade_id || String(s.grade_id) === String(transferForm.grade_id))
              .map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.name}
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransferOpen(false)}>Cancel</Button>
          <Button
            variant='contained'
            onClick={async () => {
              if (!activeRow) return
              try {
                await axios.put(`/api/students/${activeRow.id}/transfer`, {
                  to_grade_id: transferForm.grade_id,
                  to_section_id: transferForm.section_id
                })
                setTransferOpen(false)
                fetchStudents({ page: 0 })
              } catch (e) {
                alert(e?.response?.data?.message ?? 'Transfer failed')
              }
            }}
            disabled={!transferForm.grade_id || !transferForm.section_id}
          >
            Transfer
          </Button>
        </DialogActions>
      </Dialog>

      {/* Status Dialog */}
      <Dialog open={statusOpen} onClose={() => setStatusOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>Set Status{activeRow ? ` – ${activeRow.last_name}, ${activeRow.first_name}` : ''}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            select
            label='Status'
            value={statusForm.status}
            onChange={e => setStatusForm(f => ({ ...f, status: e.target.value }))}
            fullWidth
            helperText={
              statusForm.status === 'retained'
                ? 'Retained = failed 3 or more learning areas this school year (still in roster).'
                : statusForm.status === 'withdrawn'
                ? 'Drop out = learner left during the current school year.'
                : statusForm.status === 'transferred'
                ? 'Transfer = learner moved to another school (exit).'
                : statusForm.status === 'completed'
                ? 'Complete = Grade 6 graduation (elementary completion).'
                : 'Choose an end-of-year outcome or exit state.'
            }
            InputProps={{
              endAdornment: (
                <Hint title='Status tracks outcome for this school year. “Transfer” here means transfer OUT (exit).' />
              )
            }}
          >
            <MenuItem value='retained'>Retain</MenuItem>
            <MenuItem value='withdrawn'>Drop out</MenuItem>
            <MenuItem value='transferred'>Transfer</MenuItem>
            <MenuItem value='completed'>Complete</MenuItem>
          </TextField>

          {statusForm.status === 'completed' && (
            <>
              <TextField
                select
                label='School Year *'
                value={statusForm.completion_school_year_id}
                onChange={e => setStatusForm(f => ({ ...f, completion_school_year_id: e.target.value }))}
                fullWidth
                required
                helperText='Usually the current school year. Adjust only when encoding late.'
                InputProps={{ endAdornment: <Hint title='Completion is recorded against a specific school year.' /> }}
              >
                {schoolYears.map(sy => (
                  <MenuItem key={sy.id} value={String(sy.id)}>
                    {sy.name}
                    {sy.is_current ? ' (current)' : ''}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label='Grade Level *'
                value={statusForm.completion_grade_id}
                onChange={e => setStatusForm(f => ({ ...f, completion_grade_id: e.target.value }))}
                fullWidth
                required
                helperText='Must be Grade 6 to mark elementary completion.'
                InputProps={{ endAdornment: <Hint title='API will reject non–Grade 6 completion.' /> }}
              >
                {visibleGrades.map(g => (
                  <MenuItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label='Grade Section (optional)'
                value={statusForm.completion_section_id}
                onChange={e => setStatusForm(f => ({ ...f, completion_section_id: e.target.value }))}
                fullWidth
                helperText='Optional: for record completeness if needed.'
                InputProps={{ endAdornment: <Hint title='You may leave this blank.' /> }}
              >
                <MenuItem value=''>-- None --</MenuItem>
                {sectionsAll
                  .filter(
                    s =>
                      !statusForm.completion_grade_id || String(s.grade_id) === String(statusForm.completion_grade_id)
                  )
                  .map(s => (
                    <MenuItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </MenuItem>
                  ))}
              </TextField>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusOpen(false)}>Cancel</Button>
          <Button
            variant='contained'
            onClick={async () => {
              try {
                if (!statusForm.enrollment_id) {
                  alert('Missing enrollment id from API response. Please include enrollment_id in /api/students.')

                  return
                }

                // require fields only if completed
                if (
                  statusForm.status === 'completed' &&
                  (!statusForm.completion_school_year_id || !statusForm.completion_grade_id)
                ) {
                  alert('School Year and Grade Level are required when status is Complete.')

                  return
                }

                await axios.post(`/api/student-enrollments/${statusForm.enrollment_id}/status`, {
                  status: statusForm.status,
                  completion_school_year_id:
                    statusForm.status === 'completed' ? Number(statusForm.completion_school_year_id) : undefined,
                  completion_grade_id:
                    statusForm.status === 'completed' ? Number(statusForm.completion_grade_id) : undefined,
                  completion_section_id:
                    statusForm.status === 'completed' && statusForm.completion_section_id
                      ? Number(statusForm.completion_section_id)
                      : undefined
                })

                setStatusOpen(false)
                fetchStudents({ page: 0 })
              } catch (e) {
                alert(e?.response?.data?.message ?? 'Update failed')
              }
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

StudentsPage.acl = { action: 'read', subject: 'students-page' }
