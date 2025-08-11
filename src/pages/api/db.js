import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 20,
  idleTimeout: 60000,
  queueLimit: 0
})

export default pool
