import type { CreateScheduledTaskDTO, ScheduledTask, TaskExecution, UpdateScheduledTaskDTO } from '@myorg/shared'
import { request } from './client'

export { ApiRequestError } from './client'

export interface ActionInfo {
  type: string
  description: string
}

export const schedulerApi = {
  listActions: () => request<ActionInfo[]>('GET', '/scheduler/actions'),
  listTasks: () => request<ScheduledTask[]>('GET', '/scheduler/tasks'),
  getTask: (id: string) => request<ScheduledTask>('GET', `/scheduler/tasks/${id}`),
  createTask: (dto: CreateScheduledTaskDTO) => request<ScheduledTask>('POST', '/scheduler/tasks', dto),
  updateTask: (id: string, dto: UpdateScheduledTaskDTO) => request<ScheduledTask>('PATCH', `/scheduler/tasks/${id}`, dto),
  enableTask: (id: string) => request<ScheduledTask>('POST', `/scheduler/tasks/${id}/enable`),
  disableTask: (id: string) => request<ScheduledTask>('POST', `/scheduler/tasks/${id}/disable`),
  runTask: (id: string) => request<TaskExecution>('POST', `/scheduler/tasks/${id}/run`),
  listExecutions: (id: string, limit = 50) =>
    request<TaskExecution[]>('GET', `/scheduler/tasks/${id}/executions?limit=${limit}`),
}
