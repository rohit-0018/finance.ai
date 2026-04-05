import { create } from 'zustand'
import type { Paper, QAMessage, NavigationPage, User } from '../types'

export type ThemeId = 'light' | 'dark' | 'sepia' | 'midnight' | 'forest'

interface AppState {
  // Auth
  currentUser: User | null
  setCurrentUser: (user: User | null) => void
  isAdmin: () => boolean
  logout: () => void

  // Theme
  theme: ThemeId
  setTheme: (theme: ThemeId) => void

  // UI
  activePage: NavigationPage
  activePaper: Paper | null
  activeTopic: string
  savedIds: Set<string>
  qaMessages: QAMessage[]
  qaLoading: boolean
  sidebarCollapsed: boolean

  setPage: (page: NavigationPage) => void
  setActivePaper: (paper: Paper | null) => void
  setActiveTopic: (topic: string) => void
  toggleSavedId: (id: string) => void
  setSavedIds: (ids: string[]) => void
  addQAMessage: (msg: QAMessage) => void
  setQAMessages: (msgs: QAMessage[]) => void
  setQALoading: (loading: boolean) => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

// Restore user from localStorage on load
function loadUser(): User | null {
  try {
    const raw = localStorage.getItem('papermind_user')
    if (raw) return JSON.parse(raw) as User
  } catch { /* ignore */ }
  return null
}

export const useAppStore = create<AppState>((set, get) => ({
  // Auth
  currentUser: loadUser(),

  setCurrentUser: (user) => {
    if (user) {
      localStorage.setItem('papermind_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('papermind_user')
    }
    set({ currentUser: user })
  },

  isAdmin: () => get().currentUser?.is_admin === true,

  logout: () => {
    localStorage.removeItem('papermind_user')
    set({ currentUser: null, savedIds: new Set(), qaMessages: [] })
  },

  // Theme
  theme: (localStorage.getItem('paperai_theme') as ThemeId) || 'light',

  setTheme: (theme) => {
    localStorage.setItem('paperai_theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  // UI
  activePage: 'feed',
  activePaper: null,
  activeTopic: 'All',
  savedIds: new Set<string>(),
  qaMessages: [],
  qaLoading: false,
  sidebarCollapsed: false,

  setPage: (page) => set({ activePage: page }),
  setActivePaper: (paper) => set({ activePaper: paper }),
  setActiveTopic: (topic) => set({ activeTopic: topic }),

  toggleSavedId: (id) =>
    set((state) => {
      const next = new Set(state.savedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { savedIds: next }
    }),

  setSavedIds: (ids) => set({ savedIds: new Set(ids) }),

  addQAMessage: (msg) =>
    set((state) => ({ qaMessages: [...state.qaMessages, msg] })),

  setQAMessages: (msgs) => set({ qaMessages: msgs }),
  setQALoading: (loading) => set({ qaLoading: loading }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}))
