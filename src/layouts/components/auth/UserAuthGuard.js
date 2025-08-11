// ** React Imports
import { useEffect } from 'react'

// ** Next Import
import { useRouter } from 'next/router'

// ** Hooks Import
import { useSession } from 'next-auth/react'

const AuthGuard = props => {
  const { children, fallback } = props
  const session = useSession()
  const router = useRouter()
  useEffect(
    () => {
      if (!router.isReady) {
        return
      }
      if (session.status === 'unauthenticated') {
        if (router.asPath !== '/') {
          router.replace({
            pathname: '/login',
            query: { returnUrl: router.asPath }
          })
        } else {
          router.replace('/login')
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router.route, session.status]
  )
  if (session.status !== 'authenticated') {
    return fallback
  }

  return <>{children}</>
}

export default AuthGuard
