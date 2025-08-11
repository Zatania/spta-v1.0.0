// ** MUI Imports
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Typography from '@mui/material/Typography'
import CardContent from '@mui/material/CardContent'

// ** Icon Imports
import Icon from 'src/@core/components/icon'

// ** Custom Components Imports
import CustomAvatar from 'src/@core/components/mui/avatar'

const UserDetails = ({ color, icon, title, count }) => {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <CustomAvatar variant='rounded' color={color} sx={{ mr: 3, boxShadow: 3, width: 44, height: 44 }}>
            <Icon icon={icon} fontSize='1.75rem' />
          </CustomAvatar>
          <Box>
            <Typography variant='caption'>{title}</Typography>
            <Typography variant='h6'>{count}</Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

export default UserDetails
