// Barrel file — existing callers import from '../lib/db'. The actual query
// helpers now live under ./db/ and are grouped by concern. Adding a new domain
// (stakes, drops, brainstorms, etc) means creating a new file there and
// re-exporting it from here.

export * from './db/users'
export * from './db/workspaces'
export * from './db/goals'
export * from './db/projects'
export * from './db/tasks'
export * from './db/journal'
export * from './db/pulses'
export * from './db/agentMessages'
export * from './db/notifications'
export * from './db/timeBlocks'
export * from './db/learn'
export * from './db/review'

// Phase 0 additions
export * from './db/brainstorms'
export * from './db/plans'
export * from './db/values'
export * from './db/horizons'
export * from './db/waitingOn'
export * from './db/learnings'
export * from './db/stakes'
export * from './db/drops'
export * from './db/estimates'
export * from './db/capacity'
export * from './db/memory'
export * from './db/integrations'
export * from './db/finance'
