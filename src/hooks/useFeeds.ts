import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  dbGetFeeds,
  dbAddFeed,
  dbDeleteFeed,
  dbToggleFeed,
  dbApproveFeed,
} from '../lib/supabase'
import { fetchAllActiveFeeds } from '../lib/rss'
import type { RSSFeed } from '../types'
import { useAppStore } from '../store'
import toast from 'react-hot-toast'

export function useFeeds(onlyApproved = false) {
  return useQuery({
    queryKey: ['feeds', onlyApproved ? 'approved' : 'all'],
    queryFn: () => dbGetFeeds(onlyApproved),
  })
}

export function useAddFeed() {
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.currentUser?.id)

  return useMutation({
    mutationFn: (feed: Omit<RSSFeed, 'id' | 'created_at' | 'last_fetched_at' | 'approved'>) =>
      dbAddFeed(feed, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] })
      toast.success('Feed submitted for approval')
    },
    onError: (err: Error) => {
      toast.error(`Failed to add feed: ${err.message}`)
    },
  })
}

export function useDeleteFeed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: dbDeleteFeed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] })
      toast.success('Feed deleted')
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete feed: ${err.message}`)
    },
  })
}

export function useToggleFeed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      dbToggleFeed(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] })
    },
    onError: (err: Error) => {
      toast.error(`Failed to toggle feed: ${err.message}`)
    },
  })
}

export function useApproveFeed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      dbApproveFeed(id, approved),
    onSuccess: (_, { approved }) => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] })
      toast.success(approved ? 'Feed approved' : 'Feed rejected')
    },
    onError: (err: Error) => {
      toast.error(`Failed to update feed: ${err.message}`)
    },
  })
}

export function useFetchRSSFeeds() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (feeds: RSSFeed[]) => fetchAllActiveFeeds(feeds),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['papers'] })
      queryClient.invalidateQueries({ queryKey: ['feeds'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      if (result.errors.length > 0) {
        toast.error(`Fetched ${result.total} papers with ${result.errors.length} errors`)
      } else {
        toast.success(`Fetched ${result.total} papers from RSS feeds`)
      }
    },
    onError: (err: Error) => {
      toast.error(`RSS fetch failed: ${err.message}`)
    },
  })
}
