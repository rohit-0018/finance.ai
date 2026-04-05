import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  dbGetNotes,
  dbGetAllNotes,
  dbSaveNote,
  dbUpdateNote,
  dbDeleteNote,
} from '../lib/supabase'
import type { NoteType } from '../types'
import { useAppStore } from '../store'
import toast from 'react-hot-toast'

export function useNotes(paperId: string) {
  const userId = useAppStore((s) => s.currentUser?.id)

  return useQuery({
    queryKey: ['notes', userId, paperId],
    queryFn: () => dbGetNotes(userId!, paperId),
    enabled: !!paperId && !!userId,
  })
}

export function useAllNotes() {
  const userId = useAppStore((s) => s.currentUser?.id)

  return useQuery({
    queryKey: ['notes', 'all', userId],
    queryFn: () => dbGetAllNotes(userId!),
    enabled: !!userId,
  })
}

export function useSaveNote() {
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.currentUser?.id)

  return useMutation({
    mutationFn: (vars: {
      paperId: string
      content: string
      highlight?: string
      noteType: NoteType
    }) => dbSaveNote({ userId: userId!, ...vars }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['notes', userId, vars.paperId] })
      queryClient.invalidateQueries({ queryKey: ['notes', 'all'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      toast.success('Note saved')
    },
    onError: (err: Error) => {
      toast.error(`Failed to save note: ${err.message}`)
    },
  })
}

export function useUpdateNote() {
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.currentUser?.id)

  return useMutation({
    mutationFn: (vars: { id: string; content: string }) =>
      dbUpdateNote(userId!, vars.id, vars.content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      toast.success('Note updated')
    },
    onError: (err: Error) => {
      toast.error(`Failed to update note: ${err.message}`)
    },
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.currentUser?.id)

  return useMutation({
    mutationFn: (id: string) => dbDeleteNote(userId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      toast.success('Note deleted')
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete note: ${err.message}`)
    },
  })
}
