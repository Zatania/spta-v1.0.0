// ** React Imports
import { useState, forwardRef } from 'react'

// ** MUI Imports
import Dialog from '@mui/material/Dialog'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Fade from '@mui/material/Fade'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'

// ** Icon Imports
import Icon from 'src/@core/components/icon'

// ** Third Party Imports
import toast from 'react-hot-toast'
import axios from 'axios'

const Transition = forwardRef(function Transition(props, ref) {
  return <Fade ref={ref} {...props} />
})

const DialogDeleteTeacher = ({ teacher_id, refreshData }) => {
  const [show, setShow] = useState(false)

  const handleDelete = async () => {
    try {
      await axios.delete(`/api/teachers/${teacher_id}`)
      toast.success('Teacher deleted successfully')
      setShow(false)
      refreshData()
    } catch (error) {
      toast.error(error?.message || 'Failed to delete teacher')
    }
  }

  return (
    <>
      <Button
        size='small'
        color='error'
        variant='outlined'
        onClick={() => setShow(true)}
        startIcon={<Icon icon='mdi:delete' />}
      >
        Delete
      </Button>
      <Dialog open={show} maxWidth='xs' scroll='body' onClose={() => setShow(false)} TransitionComponent={Transition}>
        <DialogContent>
          <Typography variant='h6' align='center'>
            Are you sure you want to delete this teacher?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 3 }}>
          <Button onClick={handleDelete} variant='contained' color='error'>
            Yes, Delete
          </Button>
          <Button variant='outlined' onClick={() => setShow(false)}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default DialogDeleteTeacher
