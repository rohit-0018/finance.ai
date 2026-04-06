import { lifeDb } from './_client'
import type { LifeIntegration, IntegrationProvider } from '../../types'

export async function listIntegrations(userId: string): Promise<LifeIntegration[]> {
  const { data, error } = await lifeDb()
    .from('life_integrations')
    .select('*')
    .eq('user_id', userId)
  if (error) throw new Error(`listIntegrations: ${error.message}`)
  return (data ?? []) as LifeIntegration[]
}

export async function getIntegration(
  userId: string,
  provider: IntegrationProvider
): Promise<LifeIntegration | null> {
  const { data, error } = await lifeDb()
    .from('life_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  if (error) throw new Error(`getIntegration: ${error.message}`)
  return (data as LifeIntegration) ?? null
}

export async function upsertIntegration(input: {
  userId: string
  provider: IntegrationProvider
  accessToken: string
  refreshToken?: string | null
  scope?: string | null
  expiresAt?: string | null
  meta?: Record<string, unknown>
}): Promise<LifeIntegration> {
  const { data, error } = await lifeDb()
    .from('life_integrations')
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        access_token: input.accessToken,
        refresh_token: input.refreshToken ?? null,
        scope: input.scope ?? null,
        expires_at: input.expiresAt ?? null,
        meta: input.meta ?? {},
      },
      { onConflict: 'user_id,provider' }
    )
    .select()
    .single()
  if (error) throw new Error(`upsertIntegration: ${error.message}`)
  return data as LifeIntegration
}

export async function deleteIntegration(
  userId: string,
  provider: IntegrationProvider
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_integrations')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
  if (error) throw new Error(`deleteIntegration: ${error.message}`)
}
