import { lifeDb } from './_client'
import { resolveDefaultWorkspaceId } from './_defaults'
import type { LifeProject, LifeCategory, LifeHealth } from '../../types'

export async function listProjects(userId: string, workspaceId?: string): Promise<LifeProject[]> {
  let q = lifeDb()
    .from('life_projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listProjects: ${error.message}`)
  return (data ?? []) as LifeProject[]
}

export async function getProject(userId: string, id: string): Promise<LifeProject | null> {
  const { data, error } = await lifeDb()
    .from('life_projects')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getProject: ${error.message}`)
  return (data as LifeProject) ?? null
}

export async function createProject(input: {
  userId: string
  workspaceId?: string
  name: string
  description?: string
  category?: LifeCategory
  goal_id?: string | null
  definition_of_done?: string | null
  contract_mode?: boolean
  brainstorm_id?: string | null
}): Promise<LifeProject> {
  const workspaceId = input.workspaceId ?? (await resolveDefaultWorkspaceId(input.userId))
  const { data, error } = await lifeDb()
    .from('life_projects')
    .insert({
      user_id: input.userId,
      workspace_id: workspaceId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? 'personal',
      goal_id: input.goal_id ?? null,
      definition_of_done: input.definition_of_done ?? null,
      contract_mode: input.contract_mode ?? false,
      brainstorm_id: input.brainstorm_id ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createProject: ${error.message}`)
  return data as LifeProject
}

export async function updateProject(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeProject, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_projects')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateProject: ${error.message}`)
}

export async function deleteProject(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_projects')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteProject: ${error.message}`)
}

export async function setProjectHealth(
  userId: string,
  id: string,
  health: LifeHealth
): Promise<void> {
  await updateProject(userId, id, { health })
}

/** Count of projects in active status — used by the "no new projects" gate. */
export async function countStalledProjects(
  userId: string,
  workspaceId: string,
  staleDays = 7
): Promise<number> {
  const since = new Date()
  since.setDate(since.getDate() - staleDays)
  const { count, error } = await lifeDb()
    .from('life_projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .lt('updated_at', since.toISOString())
  if (error) throw new Error(`countStalledProjects: ${error.message}`)
  return count ?? 0
}
