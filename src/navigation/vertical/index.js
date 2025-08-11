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
    },
    {
      title: 'User',
      icon: 'mdi:account-outline',
      children: [
        {
          title: 'List',
          path: '/apps/user/list'
        },
        {
          title: 'View',
          children: [
            {
              title: 'Overview',
              path: '/apps/user/view/overview'
            },
            {
              title: 'Security',
              path: '/apps/user/view/security'
            },
            {
              title: 'Billing & Plans',
              path: '/apps/user/view/billing-plan'
            },
            {
              title: 'Notifications',
              path: '/apps/user/view/notification'
            },
            {
              title: 'Connection',
              path: '/apps/user/view/connection'
            }
          ]
        }
      ]
    }
  ]
}

export default navigation
