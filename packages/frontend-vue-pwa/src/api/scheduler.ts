import type {
  ApiError,
  ApiErrorDetail,
  CreateScheduledTaskDTO,
  ScheduledTask,
  TaskExecution,
  UpdateScheduledTaskDTO,
} from '@myorg/shared'

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
const base = `${apiBase}/api/scheduler`

export interface ActionInfo {
  type: string
  description: string
}

/** Błąd z API z listą błędów pól (path → message). */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: ApiErrorDetail[] = []
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError('Brak połączenia z serwerem. Sprawdź, czy backend działa.', 0)
  }
  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const error = data as ApiError | null
    throw new ApiRequestError(error?.error ?? `Błąd serwera (${res.status})`, res.status, error?.details)
  }
  return data as T
}

export const schedulerApi = {
  listActions: () => request<ActionInfo[]>('GET', '/actions'),
  listTasks: () => request<ScheduledTask[]>('GET', '/tasks'),
  getTask: (id: string) => request<ScheduledTask>('GET', `/tasks/${id}`),
  createTask: (dto: CreateScheduledTaskDTO) => request<ScheduledTask>('POST', '/tasks', dto),
  updateTask: (id: string, dto: UpdateScheduledTaskDTO) => request<ScheduledTask>('PATCH', `/tasks/${id}`, dto),
  enableTask: (id: string) => request<ScheduledTask>('POST', `/tasks/${id}/enable`),
  disableTask: (id: string) => request<ScheduledTask>('POST', `/tasks/${id}/disable`),
  runTask: (id: string) => request<TaskExecution>('POST', `/tasks/${id}/run`),
  listExecutions: (id: string, limit = 50) => request<TaskExecution[]>('GET', `/tasks/${id}/executions?limit=${limit}`),
}
