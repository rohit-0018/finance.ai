import { format, formatDistanceToNow, parseISO } from 'date-fns'
import type { PaperSource, NoteType } from '../types'

export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy')
  } catch {
    return dateStr
  }
}

export function formatRelative(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true })
  } catch {
    return dateStr
  }
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trimEnd() + '...'
}

export function sourceToColor(source: PaperSource): string {
  const map: Record<string, string> = {
    arXiv: '#6366f1',
    SSRN: '#f59e0b',
    HuggingFace: '#10b981',
    NeurIPS: '#ef4444',
    ICML: '#14b8a6',
    ICLR: '#8b5cf6',
    RSS: '#6b7280',
  }
  return map[source] ?? '#6b7280'
}

export function noteTypeToColor(type: NoteType): string {
  const map: Record<NoteType, string> = {
    note: '#6366f1',
    insight: '#10b981',
    question: '#f59e0b',
    highlight: '#ef4444',
  }
  return map[type]
}

export function noteTypeToLabel(type: NoteType): string {
  const map: Record<NoteType, string> = {
    note: 'Note',
    insight: 'Insight',
    question: 'Question',
    highlight: 'Highlight',
  }
  return map[type]
}

export const TOPICS = [
  'All',
  'AI',
  'Machine Learning',
  'NLP',
  'Computer Vision',
  'Reinforcement Learning',
  'Robotics',
  'Statistics',
  'Neuroscience',
  'Economics',
  'Physics',
] as const

export const ARXIV_PRESETS = [
  { name: 'cs.AI', url: 'https://rss.arxiv.org/rss/cs.AI', topic: 'AI' },
  { name: 'cs.LG', url: 'https://rss.arxiv.org/rss/cs.LG', topic: 'Machine Learning' },
  { name: 'cs.CL', url: 'https://rss.arxiv.org/rss/cs.CL', topic: 'NLP' },
  { name: 'cs.CV', url: 'https://rss.arxiv.org/rss/cs.CV', topic: 'Computer Vision' },
  { name: 'cs.RO', url: 'https://rss.arxiv.org/rss/cs.RO', topic: 'Robotics' },
  { name: 'stat.ML', url: 'https://rss.arxiv.org/rss/stat.ML', topic: 'Statistics' },
  { name: 'cs.NE', url: 'https://rss.arxiv.org/rss/cs.NE', topic: 'AI' },
  { name: 'q-bio.NC', url: 'https://rss.arxiv.org/rss/q-bio.NC', topic: 'Neuroscience' },
] as const

export function generateColor(): string {
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6']
  return colors[Math.floor(Math.random() * colors.length)]
}
