import type { CreateUserDTO, User } from '@myorg/shared'
import { pool } from '../../db'

export class UserRepository {
  async create(dto: CreateUserDTO): Promise<User> {
    const result = await pool.query<{
      id: string
      email: string
      name: string
    }>(
      `INSERT INTO users (email, name) VALUES ($1, $2)
       RETURNING id, email, name`,
      [dto.email, dto.name]
    )
    const row = result.rows[0]
    return { id: row.id, email: row.email, name: row.name }
  }

  async findAll(): Promise<User[]> {
    const result = await pool.query<{
      id: string
      email: string
      name: string
    }>(`SELECT id, email, name FROM users ORDER BY created_at DESC`)
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
    }))
  }
}
