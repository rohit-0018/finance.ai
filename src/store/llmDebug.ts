import { create } from 'zustand'

export interface LLMDebugEntry {
  id: string
  label: string
  model: string
  startedAt: number
  durationMs: number
  system?: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  response: string
  inputChars: number
  outputChars: number
  maxTokens?: number
  error?: string
}

interface LLMDebugState {
  enabled: boolean
  open: boolean
  entries: LLMDebugEntry[]
  setEnabled: (v: boolean) => void
  setOpen: (v: boolean) => void
  push: (entry: LLMDebugEntry) => void
  clear: () => void
}

const KEY = 'papermind_llm_debug_enabled'

export const useLLMDebug = create<LLMDebugState>((set) => ({
  enabled: (() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })(),
  open: false,
  entries: [],
  setEnabled: (v) => {
    try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* ignore */ }
    set({ enabled: v })
  },
  setOpen: (v) => set({ open: v }),
  push: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, 200),
    })),
  clear: () => set({ entries: [] }),
}))

export function recordLLMCall(partial: Omit<LLMDebugEntry, 'id'>): void {
  const state = useLLMDebug.getState()
  if (!state.enabled) return
  state.push({
    ...partial,
    id: `${partial.startedAt}-${Math.random().toString(36).slice(2, 8)}`,
  })
}
