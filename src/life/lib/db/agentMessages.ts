import { lifeDb } from './_client'
import { resolveDefaultWorkspaceId } from './_defaults'
import type { LifeAgentMessage } from '../../types'

/**
 * List agent messages. Supports the legacy positional form
 * `listAgentMessages(userId, projectId, limit)` as well as the new
 * options form `listAgentMessages(userId, { workspaceId, projectId, ... })`.
 */
export async function listAgentMessages(
  userId: string,
  arg2:
    | {
        workspaceId?: string
        projectId?: string | null
        brainstormId?: string | null
        limit?: number
      }
    | string
    | null
    | undefined = {},
  arg3?: number
): Promise<LifeAgentMessage[]> {
  const opts: {
    workspaceId?: string
    projectId?: string | null
    brainstormId?: string | null
    limit?: number
  } =
    typeof arg2 === 'string' || arg2 === null
      ? { projectId: arg2 as string | null, limit: arg3 }
      : arg2 ?? {}

  let q = lifeDb()
    .from('life_agent_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 50)

  if (opts.workspaceId) q = q.eq('workspace_id', opts.workspaceId)
  if (opts.projectId !== undefined)
    q = opts.projectId ? q.eq('project_id', opts.projectId) : q.is('project_id', null)
  if (opts.brainstormId !== undefined)
    q = opts.brainstormId ? q.eq('brainstorm_id', opts.brainstormId) : q.is('brainstorm_id', null)

  const { data, error } = await q
  if (error) throw new Error(`listAgentMessages: ${error.message}`)
  return (data ?? []) as LifeAgentMessage[]
}

export async function saveAgentMessage(input: {
  userId: string
  workspaceId?: string
  projectId?: string | null
  brainstormId?: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  meta?: Record<string, unknown>
}): Promise<LifeAgentMessage> {
  const workspaceId = input.workspaceId ?? (await resolveDefaultWorkspaceId(input.userId))
  const { data, error } = await lifeDb()
    .from('life_agent_messages')
    .insert({
      user_id: input.userId,
      workspace_id: workspaceId,
      project_id: input.projectId ?? null,
      brainstorm_id: input.brainstormId ?? null,
      role: input.role,
      content: input.content,
      meta: input.meta ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`saveAgentMessage: ${error.message}`)
  return data as LifeAgentMessage
}
