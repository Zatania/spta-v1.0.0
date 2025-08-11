// ** MUI Imports
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'

const UserSpinner = ({ sx }) => {
  // ** Hook
  const theme = useTheme()

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        flexDirection: 'column',
        justifyContent: 'center',
        ...sx
      }}
    >
      <svg
        width={150}
        height={100}
        version='1.1'
        viewBox='0 0 30 23'
        xmlns='http://www.w3.org/2000/svg'
        xmlnsXlink='http://www.w3.org/1999/xlink'
      >
        <g stroke='none' strokeWidth='1' fill='none' fillRule='evenodd'>
          <g id='Artboard' transform='translate(-95.000000, -51.000000)'>
            <g id='logo' transform='translate(95.000000, 50.000000)'>
              <image x='0' y='0' width='25' height='25' xlinkHref='/images/logo.png' />
            </g>
          </g>
        </g>
      </svg>
      <CircularProgress disableShrink sx={{ mt: 6 }} />
    </Box>
  )
}

export default UserSpinner
