// Shared navigation visibility — admin preference, persisted on the user
// record as `users.preferences.nav_hidden` (jsonb). Both Layout.tsx (main
// papermind sidebar) and LifeLayout.tsx (Life sidebar) read via this hook
// so hiding a section in one place hides it everywhere.
//
// The `users.preferences` jsonb column is the single source of truth.
// The store's currentUser mirrors it in memory (and localStorage via
// setCurrentUser), so the UI updates instantly while the DB write goes out.
import { useCallback } from 'react'
import { useAppStore } from '../store'
import { dbUpdateUserPreferences } from './supabase'

export function useHiddenNav(): [string[], (next: string[]) => Promise<void>] {
  const currentUser = useAppStore((s) => s.currentUser)
  const setCurrentUser = useAppStore((s) => s.setCurrentUser)
  const hidden = currentUser?.preferences?.nav_hidden ?? []

  const update = useCallback(
    async (next: string[]) => {
      if (!currentUser) return
      // Optimistic: update the store immediately so every subscribing
      // component (both sidebars) reflects the change without waiting for
      // the DB round-trip.
      setCurrentUser({
        ...currentUser,
        preferences: { ...(currentUser.preferences ?? {}), nav_hidden: next },
      })
      try {
        await dbUpdateUserPreferences(currentUser.id, { nav_hidden: next })
      } catch (err) {
        // Roll back on failure so the UI doesn't lie about saved state.
        setCurrentUser(currentUser)
        throw err
      }
    },
    [currentUser, setCurrentUser]
  )

  return [hidden, update]
}
