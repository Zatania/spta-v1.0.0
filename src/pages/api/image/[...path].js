import fs from 'fs'
import path from 'path'

const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })

  const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path]
  const safeParts = parts.filter(Boolean).map(p => path.basename(p))
  const filePath = path.join(process.cwd(), 'public/uploads', ...safeParts)
  const normalized = path.normalize(filePath)
  const root = path.join(process.cwd(), 'public/uploads')

  if (!normalized.startsWith(root)) return res.status(400).json({ message: 'Invalid image path' })

  const ext = path.extname(normalized).toLowerCase()
  if (!allowed.has(ext) || !fs.existsSync(normalized)) return res.status(404).end()

  const contentType =
    ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'

  res.setHeader('Content-Type', contentType)
  fs.createReadStream(normalized).pipe(res)
}
