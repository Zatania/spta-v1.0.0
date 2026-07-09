import { Button, Stack } from '@mui/material'
import GetAppIcon from '@mui/icons-material/GetApp'

function buildUrl(endpoint, params) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  })
  return `${endpoint}?${query.toString()}`
}

export default function ExportButtons({ endpoint, schoolYearId, filters = {}, formats = ['csv', 'xlsx'], label = 'Export' }) {
  const openExport = format => {
    window.open(buildUrl(endpoint, { ...filters, school_year_id: schoolYearId, format }), '_blank')
  }

  return (
    <Stack direction='row' spacing={1} flexWrap='wrap'>
      {formats.map(format => (
        <Button key={format} size='small' variant='outlined' startIcon={<GetAppIcon />} onClick={() => openExport(format)} disabled={!schoolYearId}>
          {label} {format.toUpperCase()}
        </Button>
      ))}
    </Stack>
  )
}
