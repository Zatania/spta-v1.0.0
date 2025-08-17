// src/components/UserDropdown.js
import { useState, Fragment, useEffect } from 'react'
import { useRouter } from 'next/router'
import Box from '@mui/material/Box'
import Menu from '@mui/material/Menu'
import Badge from '@mui/material/Badge'
import Avatar from '@mui/material/Avatar'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import { styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import Icon from 'src/@core/components/icon'
import { signOut } from 'next-auth/react'
import { useSession } from 'next-auth/react'

const BadgeContentSpan = styled('span')(({ theme }) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: theme.palette.success.main,
  boxShadow: `0 0 0 2px ${theme.palette.background.paper}`
}))

const styles = {
  py: 2,
  px: 4,
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  color: 'text.primary',
  textDecoration: 'none',
  '& svg': {
    mr: 2,
    fontSize: '1.375rem',
    color: 'text.primary'
  }
}

const emailRegex = /^\S+@\S+\.\S+$/

const UserDropdown = props => {
  const { settings } = props

  const [anchorEl, setAnchorEl] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadingUser, setLoadingUser] = useState(false)
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  // Snackbar (toast) state
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState('success')

  const [form, setForm] = useState({
    username: '',
    email: '',
    full_name: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  const router = useRouter()
  const { direction } = settings

  const handleDropdownOpen = event => setAnchorEl(event.currentTarget)

  const handleDropdownClose = url => {
    if (url) router.push(url)
    setAnchorEl(null)
  }

  const handleLogout = () => {
    signOut({ callbackUrl: '/', redirect: false }).then(() => {
      router.asPath = '/'
    })
    handleDropdownClose()
  }

  const { data: session } = useSession()

  const openSettings = () => setSettingsOpen(true)

  const closeSettings = () => {
    setSettingsOpen(false)
    setApiError(null)
    setFieldErrors({})

    // clear password fields
    setForm(f => ({ ...f, currentPassword: '', newPassword: '', confirmPassword: '' }))
  }

  useEffect(() => {
    let mounted = true
    async function fetchUser() {
      setApiError(null)
      setFieldErrors({})
      setLoadingUser(true)
      try {
        const res = await fetch('/api/users/me')
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.message || `Error ${res.status}`)
        }
        const data = await res.json()
        if (!mounted) return
        setForm(f => ({
          ...f,
          username: data.user.username || '',
          email: data.user.email || '',
          full_name: data.user.full_name || ''
        }))
      } catch (err) {
        console.error(err)
        setApiError(err.message || 'Failed to load user')
      } finally {
        setLoadingUser(false)
      }
    }

    if (settingsOpen) fetchUser()

    return () => {
      mounted = false
    }
  }, [settingsOpen])

  const onChange = e => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))

    // clear any field-specific error when user edits it
    setFieldErrors(fe => {
      if (!fe[name]) return fe
      const copy = { ...fe }
      delete copy[name]

      return copy
    })
    setApiError(null)
  }

  function validateClient() {
    const errs = {}
    if (!form.username || form.username.trim() === '') errs.username = 'Username is required'
    if (!form.email || form.email.trim() === '') errs.email = 'Email is required'
    else if (!emailRegex.test(form.email)) errs.email = 'Invalid email format'
    if (form.newPassword && form.newPassword !== form.confirmPassword) errs.confirmPassword = "Passwords don't match"

    return errs
  }

  const handleSave = async () => {
    setApiError(null)
    setFieldErrors({})

    const clientErrs = validateClient()
    if (Object.keys(clientErrs).length) {
      setFieldErrors(clientErrs)

      return
    }

    setSaving(true)
    try {
      const payload = {
        username: form.username,
        email: form.email,
        full_name: form.full_name
      }
      if (form.newPassword && form.newPassword.length > 0) {
        payload.newPassword = form.newPassword
        payload.currentPassword = form.currentPassword
      }

      const res = await fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (body && body.errors && typeof body.errors === 'object') {
          setFieldErrors(body.errors)

          // show a soft toast for field errors as well:
          setSnackbarMessage('Please check the form for errors.')
          setSnackbarSeverity('error')
          setSnackbarOpen(true)
        } else {
          setApiError(body?.message || `Error ${res.status}`)
          setSnackbarMessage(body?.message || 'Failed to update settings')
          setSnackbarSeverity('error')
          setSnackbarOpen(true)
        }

        return
      }

      // Success: close dialog and show toast
      closeSettings()
      setSnackbarMessage('Settings updated successfully.')
      setSnackbarSeverity('success')
      setSnackbarOpen(true)

      // OPTION: refresh page/session to reflect new username/email in UI.
      // Uncomment one of these if you want automatic refresh:
      //
      // 1) Soft refresh the route (no full reload):
      // setTimeout(() => router.replace(router.asPath), 900)
      //
      // 2) Full reload (forces next-auth to re-read session):
      // setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      console.error(err)
      setApiError(err.message || 'Failed to update settings')
      setSnackbarMessage(err.message || 'Failed to update settings')
      setSnackbarSeverity('error')
      setSnackbarOpen(true)
    } finally {
      setSaving(false)
    }
  }

  const handleSnackbarClose = (_, reason) => {
    if (reason === 'clickaway') return
    setSnackbarOpen(false)
  }

  return (
    <Fragment>
      <Badge
        overlap='circular'
        onClick={handleDropdownOpen}
        sx={{ ml: 2, cursor: 'pointer' }}
        badgeContent={<BadgeContentSpan />}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Avatar
          alt='Profile Image'
          onClick={handleDropdownOpen}
          sx={{ width: 40, height: 40 }}
          src={`/api/image/${session?.user.image}`}
        />
      </Badge>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => handleDropdownClose()}
        sx={{ '& .MuiMenu-paper': { width: 230, mt: 4 } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: direction === 'ltr' ? 'right' : 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: direction === 'ltr' ? 'right' : 'left' }}
      >
        <Box sx={{ pt: 2, pb: 3, px: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Badge
              overlap='circular'
              badgeContent={<BadgeContentSpan />}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
              <Avatar
                alt='Profile Image'
                src={`/api/image/${session?.user.image}`}
                sx={{ width: '2.5rem', height: '2.5rem' }}
              />
            </Badge>
            <Box sx={{ display: 'flex', ml: 3, alignItems: 'flex-start', flexDirection: 'column' }}>
              <Typography sx={{ fontWeight: 600 }}>{session?.user.full_name}</Typography>
              <Typography variant='body2' sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
                {session?.user.role === 'admin'
                  ? 'Admin'
                  : session?.user.role === 'teacher'
                  ? 'Teacher'
                  : session?.user.role}
              </Typography>
            </Box>
          </Box>
        </Box>

        <Divider />

        <MenuItem
          sx={{ p: 0 }}
          onClick={() => {
            openSettings()
            handleDropdownClose()
          }}
        >
          <Box sx={styles}>
            <Icon icon='mdi:cog-outline' />
            Settings
          </Box>
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={handleLogout}
          sx={{ py: 2, '& svg': { mr: 2, fontSize: '1.375rem', color: 'text.primary' } }}
        >
          <Icon icon='mdi:logout-variant' />
          Logout
        </MenuItem>
      </Menu>

      <Dialog open={settingsOpen} onClose={closeSettings} fullWidth maxWidth='sm'>
        <DialogTitle>Settings</DialogTitle>
        <DialogContent dividers>
          {loadingUser ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              {apiError && (
                <Alert severity='error' sx={{ mb: 2 }}>
                  {apiError}
                </Alert>
              )}

              <Box sx={{ display: 'grid', gap: 2 }}>
                <TextField
                  label='Username'
                  name='username'
                  value={form.username}
                  onChange={onChange}
                  fullWidth
                  variant='outlined'
                  error={Boolean(fieldErrors.username)}
                  helperText={fieldErrors.username || ''}
                />
                <TextField
                  label='Full name'
                  name='full_name'
                  value={form.full_name}
                  onChange={onChange}
                  fullWidth
                  variant='outlined'
                  error={Boolean(fieldErrors.full_name)}
                  helperText={fieldErrors.full_name || ''}
                />
                <TextField
                  label='Email'
                  name='email'
                  value={form.email}
                  onChange={onChange}
                  fullWidth
                  variant='outlined'
                  error={Boolean(fieldErrors.email)}
                  helperText={
                    fieldErrors.email || (form.email && !emailRegex.test(form.email) ? 'Invalid email format' : '')
                  }
                />

                <Divider />

                <Typography variant='subtitle2'>Change password</Typography>
                <TextField
                  label='Current password'
                  name='currentPassword'
                  value={form.currentPassword}
                  onChange={onChange}
                  type='password'
                  helperText={fieldErrors.currentPassword || 'Required only when changing password'}
                  error={Boolean(fieldErrors.currentPassword)}
                />
                <TextField
                  label='New password'
                  name='newPassword'
                  value={form.newPassword}
                  onChange={onChange}
                  type='password'
                  error={Boolean(fieldErrors.newPassword)}
                  helperText={fieldErrors.newPassword || ''}
                />
                <TextField
                  label='Confirm new password'
                  name='confirmPassword'
                  value={form.confirmPassword}
                  onChange={onChange}
                  type='password'
                  error={Boolean(fieldErrors.confirmPassword)}
                  helperText={fieldErrors.confirmPassword || ''}
                />
              </Box>
            </>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeSettings} disabled={saving}>
            Cancel
          </Button>
          <Button variant='contained' onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'Save changes'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4500}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} sx={{ width: '100%' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Fragment>
  )
}

export default UserDropdown
