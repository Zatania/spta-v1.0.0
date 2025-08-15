/**
 *  Set Home URL based on User Roles
 */
const getHomeRoute = role => {
  if (role === 'admin') return '/dashboard'
  else return '/teacher/dashboard'
}

export default getHomeRoute
