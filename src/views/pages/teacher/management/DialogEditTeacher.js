// ** React Imports
import { useState, forwardRef, useEffect } from 'react'

// ** MUI Imports
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Dialog from '@mui/material/Dialog'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import FormControl from '@mui/material/FormControl'
import Fade from '@mui/material/Fade'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import OutlinedInput from '@mui/material/OutlinedInput'
import Input from '@mui/material/Input'
import InputLabel from '@mui/material/InputLabel'
import InputAdornment from '@mui/material/InputAdornment'

// ** Icon Imports
import Icon from 'src/@core/components/icon'

// ** Third Party Imports
import { useForm, Controller } from 'react-hook-form'
import toast from 'react-hot-toast'
import * as bcrypt from 'bcryptjs'
import axios from 'axios'

const Transition = forwardRef(function Transition(props, ref) {
  return <Fade ref={ref} {...props} />
})

const DialogEditTeacher = ({ teacher, refreshData }) => {
  const [show, setShow] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [imageUploaded, setImageUploaded] = useState(false)
  const [imagePath, setImagePath] = useState(teacher.image || '')

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm({
    mode: 'onBlur',
    defaultValues: {
      username: teacher.username,
      last_name: teacher.last_name,
      first_name: teacher.first_name,
      middle_name: teacher.middle_name || '',
      password: ''
    }
  })

  const handleClose = () => {
    setShow(false)
    reset()
    setImageUploaded(false)
    setImagePath(teacher.image || '')
  }

  const handleImageUpload = async file => {
    if (!file) return ''
    const formData = new FormData()
    formData.append('myImage', file)

    try {
      const response = await axios.post('/api/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success('Image uploaded successfully')

      return response.data.imagePath
    } catch (error) {
      toast.error(error?.message || 'Failed to upload image')

      return ''
    }
  }

  const onSubmit = async data => {
    try {
      const updatePayload = {
        ...data,
        image: imagePath
      }

      if (data.password) {
        updatePayload.password = await bcrypt.hash(data.password, 10)
      } else {
        delete updatePayload.password
      }

      await axios.put(`/api/teachers/${teacher.teacher_id}`, updatePayload)
      toast.success('Teacher updated successfully')
      handleClose()
      refreshData()
    } catch (error) {
      toast.error(error?.message || 'Failed to update teacher')
    }
  }

  return (
    <>
      <Button
        size='small'
        variant='outlined'
        onClick={() => setShow(true)}
        startIcon={<Icon icon='mdi:account-edit' />}
      >
        Edit
      </Button>
      <Dialog fullWidth open={show} maxWidth='md' scroll='body' onClose={handleClose} TransitionComponent={Transition}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <IconButton size='small' onClick={handleClose} sx={{ position: 'absolute', right: '1rem', top: '1rem' }}>
              <Icon icon='mdi:close' />
            </IconButton>
            <Box sx={{ mb: 8, textAlign: 'center' }}>
              <Typography variant='h5'>Edit Teacher</Typography>
              <Typography variant='body2'>Update teacher details</Typography>
            </Box>
            <Grid container spacing={6}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name='username'
                  control={control}
                  rules={{ required: 'Username is required' }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label='Username'
                      error={!!errors.username}
                      helperText={errors.username?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>New Password (optional)</InputLabel>
                  <Controller
                    name='password'
                    control={control}
                    render={({ field }) => (
                      <OutlinedInput
                        {...field}
                        type={showPassword ? 'text' : 'password'}
                        endAdornment={
                          <InputAdornment position='end'>
                            <IconButton onClick={() => setShowPassword(!showPassword)}>
                              <Icon icon={showPassword ? 'mdi:eye-outline' : 'mdi:eye-off-outline'} />
                            </IconButton>
                          </InputAdornment>
                        }
                      />
                    )}
                  />
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Controller
                  name='last_name'
                  control={control}
                  rules={{ required: 'Last name is required' }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label='Last Name'
                      error={!!errors.last_name}
                      helperText={errors.last_name?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <Controller
                  name='first_name'
                  control={control}
                  rules={{ required: 'First name is required' }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label='First Name'
                      error={!!errors.first_name}
                      helperText={errors.first_name?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <Controller
                  name='middle_name'
                  control={control}
                  render={({ field }) => <TextField {...field} fullWidth label='Middle Name' />}
                />
              </Grid>
              <Grid item xs={12}>
                <Typography variant='body1'>Upload New Profile Image (optional)</Typography>
                <Input
                  type='file'
                  id='teacher-image-edit'
                  style={{ display: 'none' }}
                  onChange={async ({ target }) => {
                    if (target.files?.length > 0) {
                      const file = target.files[0]
                      const uploadedPath = await handleImageUpload(file)
                      if (uploadedPath) {
                        setImageUploaded(true)
                        setImagePath(uploadedPath)
                      }
                    }
                  }}
                />
                {imageUploaded ? (
                  <Typography>Image Uploaded Successfully</Typography>
                ) : (
                  <Button variant='outlined' component='label' htmlFor='teacher-image-edit'>
                    Select Image
                  </Button>
                )}
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button variant='contained' type='submit'>
              Save Changes
            </Button>
            <Button variant='outlined' color='secondary' onClick={handleClose}>
              Cancel
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}

export default DialogEditTeacher
