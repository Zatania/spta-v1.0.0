// pages/api/auth/[...nextauth].js
import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text', placeholder: 'your.username' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        const { username, password } = credentials ?? {}

        if (!username || !password) {
          throw new Error('Username and password are required')
        }

        const apiUrl = process.env.API_URL
        if (!apiUrl) {
          throw new Error('API_URL env variable is not set')
        }

        try {
          const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          })

          if (res.status !== 200) {
            let errMsg = 'Invalid credentials'
            try {
              const errJson = await res.json()
              if (errJson?.message) errMsg = errJson.message
            } catch {}

            return null
          }

          const payload = await res.json()
          const userObj = payload?.user ?? payload

          if (!userObj || !userObj.id) {
            return null
          }

          return {
            id: userObj.id,
            username: userObj.username ?? null,
            full_name: userObj.full_name ?? userObj.fullName ?? null,
            email: userObj.email ?? null,
            role: userObj.role ?? null, // Single role string
            sections: Array.isArray(userObj.sections) ? userObj.sections : []
          }
        } catch (err) {
          console.error('Authorize error:', err)
          throw new Error('Unable to sign in. Please try again.')
        }
      }
    })
  ],

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60
  },

  pages: {
    signIn: '/login',
    signOut: '/login',
    error: '/login'
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.username = user.username
        token.full_name = user.full_name
        token.email = user.email
        token.role = user.role ?? null
        token.sections = user.sections ?? []
      }

      return token
    },

    async session({ session, token }) {
      if (!session.user) session.user = {}

      session.user.id = token.id ?? null
      session.user.username = token.username ?? null
      session.user.full_name = token.full_name ?? null
      session.user.email = token.email ?? null
      session.user.role = token.role ?? null
      session.user.sections = Array.isArray(token.sections) ? token.sections : []

      return session
    }
  },

  secret: process.env.NEXTAUTH_SECRET ?? process.env.SECRET
}

export default NextAuth(authOptions)
