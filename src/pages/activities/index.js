// pages/activities.js
import { useEffect, useState, useMemo } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Stack,
  IconButton,
  Tooltip,
  FormControlLabel,
  Checkbox,
  Switch,
  MenuItem
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { DataGrid } from '@mui/x-data-grid'
import axios from 'axios'
import { useSession } from 'next-auth/react'

export default function ActivitiesPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const isAdmin = role === 'admin'
  const isTeacher = role === 'teacher'

  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(false)
  const [me, setMe] = useState(null) // { user, teacher: { assigned_sections: [...] } }
  const [grades, setGrades] = useState([])

  const [open, setOpen] = useState(false)

  const emptyForm = {
    id: null,
    title: '',
    activity_date: '',
    payments_enabled: true,

    // Stored but only rendered for admins; teachers don’t see or edit these inputs
    fee_type: 'none',
    fee_amount: '',

    // for edit checks
    created_by: null,

    // admin-only
    apply_all_grades: true,
    selected_grade_ids: [],

    // teacher-only
    section_id: ''
  }

  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchMyInfo()
    fetchGrades()
  }, [])

  useEffect(() => {
    fetchActivities()
  }, [role])

  const fetchMyInfo = async () => {
    try {
      const res = await axios.get('/api/teachers/me')
      setMe(res.data)
    } catch (err) {
      console.error('Failed to fetch my info', err)
    }
  }

  const fetchGrades = async () => {
    try {
      const res = await axios.get('/api/grades')
      setGrades(res.data ?? [])
    } catch (err) {
      console.error('Failed to fetch grades', err)
    }
  }

  const fetchActivities = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/activities')
      setActivities(res.data.activities ?? [])
    } catch (err) {
      console.error('Fetch activities error', err)
    } finally {
      setLoading(false)
    }
  }

  const teacherSections = useMemo(() => me?.teacher?.assigned_sections ?? [], [me])

  const openCreate = () => {
    const base = { ...emptyForm }

    // Teachers: preselect a section if they only have one
    if (isTeacher && teacherSections.length === 1) {
      base.section_id = String(teacherSections[0].id)
    }

    // Teachers: start with payments enabled OFF and fee_type 'none' by default
    if (isTeacher) {
      base.payments_enabled = false
      base.fee_type = 'none'
    }

    // Admins can choose any fee_type; default to 'none'
    if (isAdmin) {
      base.fee_type = 'none'
      base.fee_amount = ''
      base.apply_all_grades = true
      base.selected_grade_ids = []
    }

    setForm(base)
    setOpen(true)
  }

  const openEdit = row => {
    const canEdit =
      row.can_edit ?? (session?.user?.role === 'admin' || Number(row.created_by) === Number(session?.user?.id))
    if (!canEdit) {
      alert('You can only edit activities you created.')

      return
    }
    setForm({
      ...emptyForm,
      id: row.id,
      title: row.title,
      activity_date: row.activity_date,
      payments_enabled: !!row.payments_enabled,
      fee_type: row.fee_type || 'none',
      fee_amount: row.fee_amount ?? '',
      created_by: row.created_by

      // We intentionally do not re-open assignment scope in this dialog.
    })
    setOpen(true)
  }

  const saveActivity = async () => {
    if (!form.title || !form.activity_date) {
      alert('Title and date are required')

      return
    }

    const creating = !form.id

    // Build payload role-aware
    const payload = {
      title: form.title,
      activity_date: form.activity_date
    }

    // ==== Admin logic (full control on policy/fees) ====
    if (isAdmin) {
      // Sanitize fee fields
      const ft = form.fee_type || 'none'

      const fa =
        ft === 'fee' || ft === 'mixed'
          ? form.fee_amount !== '' && form.fee_amount != null
            ? Number(form.fee_amount)
            : null
          : null

      payload.fee_type = ft
      payload.fee_amount = fa
      payload.payments_enabled = form.payments_enabled ? 1 : 0

      // Admin scope
      payload.assignment_mode = form.apply_all_grades ? 'ALL' : 'GRADES'
      payload.grade_ids = form.apply_all_grades ? [] : form.selected_grade_ids.map(String)
    }

    // ==== Teacher logic (simple switch only) ====
    if (isTeacher) {
      // Teachers don’t set fee type explicitly.
      // Behavior:
      //  - On CREATE:
      //     payments_enabled = false → fee_type = 'none'
      //     payments_enabled = true  → fee_type = 'mixed'  (attendance shows payments + contributions)
      //  - On UPDATE:
      //     If they flip payments from OFF→ON and current fee_type is 'none',
      //     also set fee_type = 'mixed' so payments column appears on attendance.
      const willEnable = !!form.payments_enabled

      payload.payments_enabled = willEnable ? 1 : 0

      if (creating) {
        payload.fee_type = willEnable ? 'mixed' : 'none'
        payload.fee_amount = null
      } else {
        // Only include fee_type when we need to lift it from 'none' to 'mixed'
        if (willEnable && (form.fee_type === 'none' || !form.fee_type)) {
          // Only do this if the teacher is the creator (teachers can only edit their own activities anyway)
          if (Number(form.created_by) === Number(session?.user?.id)) {
            payload.fee_type = 'mixed'
          }
        }
      }

      // Teacher scope: must target one of their sections
      if (creating) {
        if (!teacherSections.length) {
          alert('No assigned section found.')

          return
        }
        if (!form.section_id) {
          alert('Please choose a section.')

          return
        }
        payload.assignment_mode = 'SECTION'
        payload.section_id = String(form.section_id)
      }
    }

    setSaving(true)
    try {
      if (creating) {
        await axios.post('/api/activities', payload)
      } else {
        await axios.put(`/api/activities/${form.id}`, payload)
      }
      setOpen(false)
      fetchActivities()
    } catch (err) {
      console.error('Save failed', err)
      alert(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePaymentsInline = async (row, checked) => {
    // Optimistic toggle
    const id = row.id
    setActivities(prev => prev.map(a => (a.id === id ? { ...a, payments_enabled: checked } : a)))

    try {
      // Teachers toggling ON for their own activity: make sure fee_type is lifted to 'mixed' if needed
      const extra =
        isTeacher &&
        Number(row.created_by) === Number(session?.user?.id) &&
        checked &&
        (!row.fee_type || row.fee_type === 'none')
          ? { fee_type: 'mixed' }
          : {}

      await axios.put(`/api/activities/${id}`, {
        payments_enabled: checked ? 1 : 0,
        ...extra
      })
    } catch (err) {
      // revert on error
      setActivities(prev => prev.map(a => (a.id === id ? { ...a, payments_enabled: !checked } : a)))

      const msg =
        err?.response?.status === 403
          ? 'You can only change payments for activities you created.'
          : 'Failed to update payments flag'
      alert(msg)
    }
  }

  const handleDelete = async row => {
    if (!confirm(`Delete activity "${row.title}"?`)) return
    try {
      await axios.delete(`/api/activities/${row.id}`)
      setActivities(prev => prev.filter(a => a.id !== row.id))
    } catch (err) {
      console.error(err)
      alert(err?.response?.data?.message ?? 'Delete failed')
    }
  }

  const columns = [
    { field: 'title', headerName: 'Title', flex: 1 },
    { field: 'activity_date', headerName: 'Date', width: 130 },
    { field: 'created_by_name', headerName: 'Created by', width: 180 },
    {
      field: 'scope',
      headerName: 'Scope',
      flex: 0.8,
      valueGetter: p => p.row.scope_text || ''
    },
    {
      field: 'fee',
      headerName: 'Fee / Type',
      width: 160,
      valueGetter: p => {
        const t = p.row.fee_type
        if (!t || t === 'none') return 'None'
        if ((t === 'fee' || t === 'mixed') && p.row.fee_amount != null)
          return `${t} • ${Number(p.row.fee_amount).toFixed(2)}`

        return t
      }
    },
    {
      field: 'payments_enabled',
      headerName: 'Collections',
      width: 150,
      renderCell: params => {
        const canToggle =
          params.row.can_toggle ??
          (session?.user?.role === 'admin' || Number(params.row.created_by) === Number(session?.user?.id))

        return (
          <FormControlLabel
            control={
              <Switch
                checked={!!params.row.payments_enabled}
                onChange={e => handleTogglePaymentsInline(params.row, e.target.checked)}
                disabled={!canToggle}
                size='small'
              />
            }
            label={params.row.payments_enabled ? 'On' : 'Off'}
          />
        )
      }
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 160,
      renderCell: params => {
        const canEdit =
          params.row.can_edit ??
          (session?.user?.role === 'admin' || Number(params.row.created_by) === Number(session?.user?.id))

        return (
          <Stack direction='row' spacing={1}>
            <Tooltip title='Edit'>
              <IconButton size='small' onClick={() => openEdit(params.row)} disabled={!canEdit}>
                <EditIcon fontSize='small' />
              </IconButton>
            </Tooltip>
            <Tooltip title='Delete'>
              <IconButton size='small' color='error' onClick={() => handleDelete(params.row)} disabled={!canEdit}>
                <DeleteIcon fontSize='small' />
              </IconButton>
            </Tooltip>
          </Stack>
        )
      }
    }
  ]

  return (
    <Box p={3}>
      <Box display='flex' justifyContent='space-between' mb={2}>
        <Typography variant='h6'>Activities</Typography>
        <Button startIcon={<AddIcon />} variant='contained' onClick={openCreate}>
          Create Activity
        </Button>
      </Box>

      <div style={{ height: 540, width: '100%' }}>
        <DataGrid rows={activities} columns={columns} getRowId={r => r.id} loading={loading} disableSelectionOnClick />
      </div>

      {/* Create/Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>{form.id ? 'Edit Activity' : 'Create Activity'}</DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label='Title'
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            fullWidth
          />

          <TextField
            type='date'
            label='Date'
            value={form.activity_date}
            onChange={e => setForm({ ...form, activity_date: e.target.value })}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />

          {/* Admin-only: fee policy */}
          {isAdmin && (
            <>
              <TextField
                select
                label='Fee type'
                value={form.fee_type}
                onChange={e => setForm({ ...form, fee_type: e.target.value })}
                fullWidth
              >
                <MenuItem value='fee'>Fee (money required)</MenuItem>
                <MenuItem value='donation'>Donation (money/materials/service)</MenuItem>
                <MenuItem value='service'>Service/Labor required</MenuItem>
                <MenuItem value='mixed'>Mixed (accept money & contributions)</MenuItem>
                <MenuItem value='none'>None</MenuItem>
              </TextField>

              {(form.fee_type === 'fee' || form.fee_type === 'mixed') && (
                <TextField
                  type='number'
                  inputProps={{ step: '0.01', min: 0 }}
                  label='Fee amount (optional)'
                  value={form.fee_amount}
                  onChange={e => setForm({ ...form, fee_amount: e.target.value })}
                  fullWidth
                />
              )}
            </>
          )}

          {/* Teachers: they only toggle collections; fee type is inferred on the backend */}
          {isTeacher && (
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.payments_enabled}
                  onChange={e => setForm({ ...form, payments_enabled: e.target.checked })}
                />
              }
              label='Allow collections (money or contributions)'
            />
          )}

          {/* Admins may also toggle payment collection switch (kept for convenience) */}
          {isAdmin && (
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.payments_enabled}
                  onChange={e => setForm({ ...form, payments_enabled: e.target.checked })}
                />
              }
              label='Collections enabled'
            />
          )}

          {/* Admin scope controls */}
          {isAdmin && (
            <>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!form.apply_all_grades}
                    onChange={e =>
                      setForm({
                        ...form,
                        apply_all_grades: e.target.checked,
                        selected_grade_ids: e.target.checked ? [] : form.selected_grade_ids
                      })
                    }
                  />
                }
                label='Apply to ALL grades'
              />
              {!form.apply_all_grades && (
                <TextField
                  select
                  label='Select grades'
                  value={form.selected_grade_ids}
                  onChange={e => setForm({ ...form, selected_grade_ids: e.target.value })}
                  SelectProps={{ multiple: true }}
                  fullWidth
                >
                  {grades.map(g => (
                    <MenuItem key={g.id} value={String(g.id)}>
                      {g.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </>
          )}

          {/* Teacher scope control on CREATE only */}
          {isTeacher && !form.id && (
            <TextField
              select
              label='Your section'
              value={form.section_id}
              onChange={e => setForm({ ...form, section_id: e.target.value })}
              fullWidth
            >
              {teacherSections.map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.grade_name} - {s.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant='contained' onClick={saveActivity} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

ActivitiesPage.acl = { action: 'read', subject: 'activities-page' }
