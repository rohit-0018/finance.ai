// Zustand store for the Life app.
import { create } from 'zustand'
import type {
  LifeUser,
  LifeProject,
  LifeWorkspace,
  LifeValue,
  LifeHorizon,
} from './types'
import type { ModePreset } from './lib/modes'

interface LifeState {
  // Resolved life_users row for the current papermind admin
  lifeUser: LifeUser | null
  setLifeUser: (u: LifeUser | null) => void

  // Workspaces
  workspaces: LifeWorkspace[]
  activeWorkspace: LifeWorkspace | null
  setWorkspaces: (ws: LifeWorkspace[]) => void
  setActiveWorkspace: (w: LifeWorkspace | null) => void

  // Long-horizon context (loaded once on boot)
  values: LifeValue[]
  horizons: LifeHorizon[]
  setValues: (v: LifeValue[]) => void
  setHorizons: (h: LifeHorizon[]) => void

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

  // Phase 10 — active life mode
  mode: ModePreset | null
  setMode: (m: ModePreset | null) => void
}

export const useLifeStore = create<LifeState>((set, get) => ({
  lifeUser: null,
  setLifeUser: (u) => set({ lifeUser: u }),

  workspaces: [],
  activeWorkspace: null,
  setWorkspaces: (ws) => set({ workspaces: ws }),
  setActiveWorkspace: (w) => set({ activeWorkspace: w }),

  values: [],
  horizons: [],
  setValues: (v) => set({ values: v }),
  setHorizons: (h) => set({ horizons: h }),

  agentOpen: false,
  setAgentOpen: (open) => set({ agentOpen: open }),
  toggleAgent: () => set({ agentOpen: !get().agentOpen }),

  agentProject: null,
  setAgentProject: (p) => set({ agentProject: p }),

  unreadCount: 0,
  setUnreadCount: (n) => set({ unreadCount: n }),

  mode: null,
  setMode: (m) => set({ mode: m }),
}))
