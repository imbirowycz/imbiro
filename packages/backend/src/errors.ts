import type { ApiErrorDetail } from '@myorg/shared'

// Błędy domenowe; mapowanie na kody HTTP robi warstwa API.

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: ApiErrorDetail[]
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: ApiErrorDetail[]) {
    super(message, 400, details)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403)
  }
}

export class TooManyRequestsError extends AppError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number
  ) {
    super(message, 429)
  }
}
