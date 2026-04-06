// Zustand store for the Life app. Held separately from the main papermind store
// because (a) different DB, (b) lazy-loaded — main store stays light.
import { create } from 'zustand'
import type { LifeUser, LifeProject } from './types'

interface LifeState {
  // Resolved life_users row for the current papermind admin
  lifeUser: LifeUser | null
  setLifeUser: (u: LifeUser | null) => void

  // Agent dock UI
  agentOpen: boolean
  setAgentOpen: (open: boolean) => void
  toggleAgent: () => void

  // Currently scoped project for the agent (null = global Life thread)
  agentProject: LifeProject | null
  setAgentProject: (p: LifeProject | null) => void

  // Notification bell badge
  unreadCount: number
  setUnreadCount: (n: number) => void
}

export const useLifeStore = create<LifeState>((set, get) => ({
  lifeUser: null,
  setLifeUser: (u) => set({ lifeUser: u }),

  agentOpen: false,
  setAgentOpen: (open) => set({ agentOpen: open }),
  toggleAgent: () => set({ agentOpen: !get().agentOpen }),

  agentProject: null,
  setAgentProject: (p) => set({ agentProject: p }),

  unreadCount: 0,
  setUnreadCount: (n) => set({ unreadCount: n }),
}))
