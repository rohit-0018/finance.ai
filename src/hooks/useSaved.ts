import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  dbGetSavedPapers,
  dbSavePaper,
  dbUnsavePaper,
  dbUpdateReadStatus,
  dbGetStats,
} from '../lib/supabase'
import type { ReadStatus } from '../types'
import { useAppStore } from '../store'
import toast from 'react-hot-toast'

export function useSavedPapers() {
  const userId = useAppStore((s) => s.currentUser?.id)

  return useQuery({
    queryKey: ['saved', userId],
    queryFn: () => dbGetSavedPapers(userId!),
    enabled: !!userId,
  })
}

export function useStats() {
  const userId = useAppStore((s) => s.currentUser?.id)

  return useQuery({
    queryKey: ['stats', userId],
    queryFn: () => dbGetStats(userId!),
    staleTime: 60 * 1000,
    enabled: !!userId,
  })
}

export function useToggleSave() {
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.currentUser?.id)
  const toggleSavedId = useAppStore((s) => s.toggleSavedId)

  return useMutation({
    mutationFn: async ({ paperId, saved }: { paperId: string; saved: boolean }) => {
      if (!userId) throw new Error('Not logged in')
      if (saved) {
        await dbUnsavePaper(userId, paperId)
      } else {
        await dbSavePaper(userId, paperId)
      }
      return { paperId, wasSaved: saved }
    },
    onSuccess: ({ paperId, wasSaved }) => {
      toggleSavedId(paperId)
      queryClient.invalidateQueries({ queryKey: ['saved'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      toast.success(wasSaved ? 'Removed from reading list' : 'Added to reading list')
    },
    onError: (err: Error) => {
      toast.error(`Failed to update save: ${err.message}`)
    },
  })
}

export function useUpdateReadStatus() {
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.currentUser?.id)

  return useMutation({
    mutationFn: ({ paperId, status }: { paperId: string; status: ReadStatus }) => {
      if (!userId) throw new Error('Not logged in')
      return dbUpdateReadStatus(userId, paperId, status)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved'] })
    },
    onError: (err: Error) => {
      toast.error(`Failed to update status: ${err.message}`)
    },
  })
}
