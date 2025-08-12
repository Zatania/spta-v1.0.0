const navigation = () => {
  return [
    {
      title: 'Dashboard',
      icon: 'mdi:home-outline',
      path: '/dashboard'
    },
    {
      title: 'Manage',
      icon: 'mdi:file-document-outline',
      children: [
        {
          title: 'Teachers',
          path: '/teachers'
        },
        {
          title: 'Sections',
          path: '/sections'
        },
        {
          title: 'Students',
          path: '/students',
          action: 'read',
          subject: 'students-page'
        },
        {
          title: 'Activities',
          path: '/activities',
          action: 'read',
          subject: 'activities-page'
        },
        {
          title: 'Attendance',
          path: '/attendance',
          action: 'read',
          subject: 'attendance-page'
        }
      ]
    }
  ]
}

export default navigation
