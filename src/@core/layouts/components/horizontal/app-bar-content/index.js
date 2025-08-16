// ** Next Import
import Link from 'next/link'

// ** MUI Imports
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { styled, useTheme } from '@mui/material/styles'

// ** Theme Config Import
import themeConfig from 'src/configs/themeConfig'

const LinkStyled = styled(Link)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  textDecoration: 'none',
  marginRight: theme.spacing(8)
}))

const AppBarContent = props => {
  // ** Props
  const { appBarContent: userAppBarContent, appBarBranding: userAppBarBranding } = props

  // ** Hooks
  const theme = useTheme()

  return (
    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      {userAppBarBranding ? (
        userAppBarBranding(props)
      ) : (
        <LinkStyled href='/'>
          <svg
            width={35}
            height={29}
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
          <Typography
            variant='h6'
            sx={{
              ml: 3,
              fontWeight: 600,
              lineHeight: 'normal',
              textTransform: 'uppercase'
            }}
          >
            {themeConfig.templateName}
          </Typography>
        </LinkStyled>
      )}
      {userAppBarContent ? userAppBarContent(props) : null}
    </Box>
  )
}

export default AppBarContent
