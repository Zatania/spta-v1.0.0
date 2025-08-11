// ** React Imports
import { useState, Fragment } from 'react'

// ** Next Import
import { useRouter } from 'next/router'

// ** MUI Imports
import Box from '@mui/material/Box'
import Menu from '@mui/material/Menu'
import Badge from '@mui/material/Badge'
import Avatar from '@mui/material/Avatar'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import { styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'

// ** Icon Imports
import Icon from 'src/@core/components/icon'

// ** Context
import { signOut } from 'next-auth/react'

// ** Hooks
import { useSession } from 'next-auth/react'

// ** Styled Components
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

const UserDropdown = props => {
  // ** Props
  const { settings } = props

  // ** States
  const [anchorEl, setAnchorEl] = useState(null)

  // ** Hooks
  const router = useRouter()

  // ** Vars
  const { direction } = settings

  const handleDropdownOpen = event => {
    setAnchorEl(event.currentTarget)
  }

  const handleDropdownClose = url => {
    if (url) {
      router.push(url)
    }
    setAnchorEl(null)
  }

  const handleLogout = () => {
    signOut({ callbackUrl: '/', redirect: false }).then(() => {
      router.asPath = '/'
    })
    handleDropdownClose()
  }

  const { data: session } = useSession()

  return (
    <Fragment>
      <Badge
        overlap='circular'
        onClick={handleDropdownOpen}
        sx={{ ml: 2, cursor: 'pointer' }}
        badgeContent={<BadgeContentSpan />}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right'
        }}
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
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right'
              }}
            >
              <Avatar
                alt='Profile Image'
                src={`/api/image/${session?.user.image}`}
                sx={{ width: '2.5rem', height: '2.5rem' }}
              />
            </Badge>
            <Box sx={{ display: 'flex', ml: 3, alignItems: 'flex-start', flexDirection: 'column' }}>
              <Typography sx={{ fontWeight: 600 }}>{session?.user.fullname}</Typography>
              <Typography variant='body2' sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
                {session?.user.role === 'super_admin'
                  ? 'Super Admin'
                  : session?.user.role === 'admin'
                  ? 'Admin'
                  : session?.user.role === 'bao'
                  ? 'BAO'
                  : session?.user.role === 'security_guard'
                  ? 'Security Guard'
                  : session?.user.role === 'user'
                  ? 'User'
                  : session?.user.role === 'premium'
                  ? 'Premium'
                  : session?.user.role}
              </Typography>
            </Box>
          </Box>
        </Box>
        <Divider />
        {session?.user.role === 'admin' ? (
          <MenuItem sx={{ p: 0 }} onClick={() => handleDropdownClose('/bao/settings/account')}>
            <Box sx={styles}>
              <Icon icon='mdi:cog-outline' />
              Settings
            </Box>
          </MenuItem>
        ) : session?.user.role === 'teacher' ? (
          <MenuItem sx={{ p: 0 }} onClick={() => handleDropdownClose('/admin/settings/account')}>
            <Box sx={styles}>
              <Icon icon='mdi:cog-outline' />
              Settings
            </Box>
          </MenuItem>
        ) : null}
        <Divider />
        <MenuItem
          onClick={handleLogout}
          sx={{ py: 2, '& svg': { mr: 2, fontSize: '1.375rem', color: 'text.primary' } }}
        >
          <Icon icon='mdi:logout-variant' />
          Logout
        </MenuItem>
      </Menu>
    </Fragment>
  )
}

export default UserDropdown
