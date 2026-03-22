import { Router, type Request, type Response } from 'express'
import type { CreateUserDTO } from '@myorg/shared'
import { UserService } from './user.service'

const service = new UserService()

export const userRouter = Router()

userRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const users = await service.listUsers()
    res.json(users)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list users' })
  }
})

userRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateUserDTO
    if (!body?.email || !body?.password || !body?.name) {
      res.status(400).json({ error: 'email, password, and name are required' })
      return
    }
    const user = await service.createUser(body)
    res.status(201).json(user)
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Email already exists' })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to create user' })
  }
})

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  )
}
