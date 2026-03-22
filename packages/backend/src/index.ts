import cors from 'cors'
import express from 'express'
import { initDb } from './db'
import { userRouter } from './modules/user/user.controller'

const app = express()
const port = Number(process.env.PORT) || 3000

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/users', userRouter)

async function main(): Promise<void> {
  await initDb()
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend listening on http://0.0.0.0:${port}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
