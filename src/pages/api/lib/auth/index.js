import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'

export async function requireSession(req, res) {
  const session = await getServerSession(req, res, authOptions)
  if (!session?.user) {
    res.status(401).json({ message: 'Not authenticated' })

    return null
  }

  return session
}

export function requireAdmin(session, res) {
  if (session?.user?.role !== 'admin') {
    res.status(403).json({ message: 'Admins only' })

    return false
  }

  return true
}
