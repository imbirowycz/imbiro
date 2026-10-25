import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import type { ApiError } from '@myorg/shared'
import { AppError } from './errors'

/** Przekazuje błędy z async handlerów do middleware błędów. */
export function asyncHandler<P extends Record<string, string> = Record<string, string>>(
  fn: (req: Request<P>, res: Response) => Promise<void>
): RequestHandler<P> {
  return (req, res, next) => {
    fn(req, res).catch(next)
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiError = { error: `Route ${req.method} ${req.path} not found` }
  res.status(404).json(body)
}

/** Jeden format błędów API: { error, details? }. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next: NextFunction) => {
  if (err instanceof AppError) {
    const body: ApiError = { error: err.message, ...(err.details ? { details: err.details } : {}) }
    res.status(err.status).json(body)
    return
  }
  // Błędy express.json(): niepoprawny JSON, za duże body.
  const type = (err as { type?: string }).type
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' } satisfies ApiError)
    return
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' } satisfies ApiError)
    return
  }

  console.error(err)
  res.status(500).json({ error: 'Internal server error' } satisfies ApiError)
}
