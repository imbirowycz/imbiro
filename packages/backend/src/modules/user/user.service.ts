import type { CreateUserDTO, User } from '@myorg/shared'
import { UserRepository } from './user.repository'

export class UserService {
  constructor(private readonly repository = new UserRepository()) {}

  async createUser(dto: CreateUserDTO): Promise<User> {
    return this.repository.create(dto)
  }

  async listUsers(): Promise<User[]> {
    return this.repository.findAll()
  }
}
