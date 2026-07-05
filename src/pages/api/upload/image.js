import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user) return res.status(401).json({ message: 'Not authenticated' })

  const uploadDir = path.join(process.cwd(), 'public/uploads')
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

  const form = formidable({
    uploadDir,
    keepExtensions: true,
    maxFileSize: 5 * 1024 * 1024,
    multiples: false
  })

  try {
    const [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, parsedFiles) => (err ? reject(err) : resolve([fields, parsedFiles])))
    })

    const file = Array.isArray(files.image) ? files.image[0] : files.image
    if (!file || !file.size) return res.status(400).json({ message: 'No image uploaded' })
    if (!file.mimetype?.startsWith('image/')) return res.status(400).json({ message: 'Invalid image file' })

    const ext = path.extname(file.originalFilename || file.newFilename || '') || '.jpg'
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
    const finalPath = path.join(uploadDir, filename)
    fs.renameSync(file.filepath, finalPath)

    return res.status(200).json({ imagePath: `/uploads/${filename}` })
  } catch (err) {
    console.error('POST /api/upload/image error:', err)

    return res.status(500).json({ message: 'Image upload failed' })
  }
}
