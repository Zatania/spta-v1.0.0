import { useState, forwardRef } from 'react'
import {
  Box,
  Grid,
  Dialog,
  Button,
  TextField,
  IconButton,
  Typography,
  FormControl,
  Fade,
  DialogContent,
  DialogActions,
  OutlinedInput,
  InputLabel,
  InputAdornment,
  Input
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import Icon from 'src/@core/components/icon'
import { useForm, Controller } from 'react-hook-form'
import toast from 'react-hot-toast'
import * as bcrypt from 'bcryptjs'
import axios from 'axios'

const Transition = forwardRef(function Transition(props, ref) {
  return <Fade ref={ref} {...props} />
})

export default function AddTeacherDialog({ refreshData }) {
  const [show, setShow] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [imageUploaded, setImageUploaded] = useState(false)
  const [imagePath, setImagePath] = useState('')

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm({ mode: 'onBlur' })

  const handleClose = () => {
    setShow(false)
    reset()
    refreshData()
    setImageUploaded(false)
    setImagePath('')
  }

  const handleImageUpload = async file => {
    if (!file) return ''
    const formData = new FormData()
    formData.append('myImage', file)
    try {
      const { data } = await axios.post('/api/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success('Image uploaded successfully')

      return data.imagePath
    } catch (err) {
      toast.error(err?.message || 'Failed to upload image')

      return ''
    }
  }

  const onSubmit = async data => {
    const hashedPassword = await bcrypt.hash(data.password, 10)
    const finalImagePath = imagePath || 'default.png'
    try {
      await axios.post('/api/teachers', {
        ...data,
        password: hashedPassword,
        image: finalImagePath
      })
      toast.success('Teacher added successfully')
      handleClose()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add teacher')
    }
  }

  return (
    <>
      <Button size='small' onClick={() => setShow(true)} startIcon={<AddIcon />} variant='outlined' sx={{ m: 1 }}>
        Add Teacher
      </Button>
      <Dialog fullWidth open={show} maxWidth='md' scroll='body' onClose={handleClose} TransitionComponent={Transition}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent sx={{ position: 'relative', pb: 8, px: 5, pt: 8 }}>
            <IconButton size='small' onClick={handleClose} sx={{ position: 'absolute', right: '1rem', top: '1rem' }}>
              <Icon icon='mdi:close' />
            </IconButton>
            <Box sx={{ mb: 8, textAlign: 'center' }}>
              <Typography variant='h5'>Add Teacher</Typography>
              <Typography variant='body2'>Fill Teacher Information</Typography>
            </Box>
            <Grid container spacing={6}>
              <Grid item sm={6} xs={12}>
                <Controller
                  name='username'
                  control={control}
                  rules={{ required: 'Required' }}
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
              <Grid item sm={6} xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Password</InputLabel>
                  <Controller
                    name='password'
                    control={control}
                    rules={{ required: 'Required' }}
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
              <Grid item sm={4} xs={12}>
                <Controller
                  name='last_name'
                  control={control}
                  rules={{ required: 'Required' }}
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
              <Grid item sm={4} xs={12}>
                <Controller
                  name='first_name'
                  control={control}
                  rules={{ required: 'Required' }}
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
              <Grid item sm={4} xs={12}>
                <Controller
                  name='middle_name'
                  control={control}
                  render={({ field }) => <TextField {...field} fullWidth label='Middle Name' />}
                />
              </Grid>
              <Grid item sm={12} xs={12} textAlign='center'>
                <Typography variant='body1'>Upload Teacher Profile Image</Typography>
                <FormControl>
                  <Input
                    type='file'
                    sx={{ display: 'none' }}
                    id='teacher-image-upload'
                    onChange={async e => {
                      if (e.target.files?.length > 0) {
                        const file = e.target.files[0]
                        const path = await handleImageUpload(file)
                        if (path) {
                          setImageUploaded(true)
                          setImagePath(path)
                        }
                      }
                    }}
                  />
                  {imageUploaded ? (
                    <Typography>Image Uploaded</Typography>
                  ) : (
                    <Button variant='outlined' component='label' htmlFor='teacher-image-upload'>
                      Select Image
                    </Button>
                  )}
                </FormControl>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'center', pb: 8 }}>
            <Button variant='contained' type='submit'>
              Submit
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
