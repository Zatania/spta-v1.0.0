/**
 *  Set Home URL based on User Roles
 */
const getHomeRoute = role => {
  if (role === 'admin') return '/dashboard'
  else return '/students'
}

export default getHomeRoute
