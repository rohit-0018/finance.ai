import { lifeDb } from './_client'
import type { LifeProjectPulse, LifeHealth } from '../../types'

export async function listPulses(
  userId: string,
  projectId: string,
  limit = 10
): Promise<LifeProjectPulse[]> {
  const { data, error } = await lifeDb()
    .from('life_project_pulse')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listPulses: ${error.message}`)
  return (data ?? []) as LifeProjectPulse[]
}

export async function savePulse(input: {
  userId: string
  projectId: string
  last_progress?: string
  next_step?: string
  whats_missing?: string
  risk?: string
  suggested_tasks?: Array<{ title: string; estimate_min?: number; priority?: number }>
  health?: LifeHealth
  raw?: unknown
}): Promise<LifeProjectPulse> {
  const { data, error } = await lifeDb()
    .from('life_project_pulse')
    .insert({
      user_id: input.userId,
      project_id: input.projectId,
      last_progress: input.last_progress ?? null,
      next_step: input.next_step ?? null,
      whats_missing: input.whats_missing ?? null,
      risk: input.risk ?? null,
      suggested_tasks: input.suggested_tasks ?? [],
      health: input.health ?? 'green',
      raw: input.raw ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`savePulse: ${error.message}`)
  return data as LifeProjectPulse
}
