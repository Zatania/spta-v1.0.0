import { useEffect, useState } from 'react'
import { TextField, MenuItem, Chip, Box } from '@mui/material'
import axios from 'axios'

export default function SchoolYearSelect({ value, onChange, size = 'small', label = 'School Year', sx = {} }) {
  const [schoolYears, setSchoolYears] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      try {
        const { data } = await axios.get('/api/school-years')
        if (!mounted) return
        setSchoolYears(data || [])

        if (!value) {
          const current = (data || []).find(sy => Number(sy.is_current) === 1)
          if (current) onChange?.(String(current.id), current)
        }
      } catch (err) {
        console.error('Failed to load school years', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()

    return () => {
      mounted = false
    }
  }, [])

  return (
    <TextField
      select
      size={size}
      label={label}
      value={value || ''}
      disabled={loading}
      onChange={e => {
        const selected = schoolYears.find(sy => String(sy.id) === String(e.target.value))
        onChange?.(e.target.value, selected)
      }}
      sx={{ minWidth: 210, ...sx }}
    >
      {schoolYears.map(sy => (
        <MenuItem key={sy.id} value={String(sy.id)}>
          <Box display='flex' alignItems='center' gap={1}>
            {sy.name}
            {Number(sy.is_current) === 1 && <Chip size='small' color='success' label='Current' />}
          </Box>
        </MenuItem>
      ))}
    </TextField>
  )
}
