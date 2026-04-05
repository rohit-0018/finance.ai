import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { dbGetPapers, dbGetPaper, dbSavePapers, dbDeletePaper } from '../lib/supabase'
import { fetchPapersForTopic } from '../lib/anthropic'
import { dbLogFetch } from '../lib/supabase'
import { useAppStore } from '../store'
import toast from 'react-hot-toast'

export function usePapersFeed(topic: string) {
  return useInfiniteQuery({
    queryKey: ['papers', 'feed', topic],
    queryFn: ({ pageParam = 0 }) =>
      dbGetPapers({ topic: topic === 'All' ? undefined : topic, limit: 12, offset: pageParam }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < 12 ? undefined : pages.length * 12,
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
  })
}

export function usePaper(id: string) {
  return useQuery({
    queryKey: ['papers', id],
    queryFn: () => dbGetPaper(id),
    staleTime: 5 * 60 * 1000,
    enabled: !!id,
  })
}

export function useFetchPapersAI() {
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.currentUser?.id)

  return useMutation({
    mutationFn: async (topic: string) => {
      const papers = await fetchPapersForTopic(topic)
      const saved = await dbSavePapers(papers, userId)
      await dbLogFetch('AI', topic, saved.length, null, userId)
      return saved
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['papers'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      toast.success(`Fetched ${data.length} papers via AI`)
    },
    onError: (err: Error) => {
      toast.error(`AI fetch failed: ${err.message}`)
    },
  })
}

export function useDeletePaper() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: dbDeletePaper,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['papers'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      toast.success('Paper deleted')
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete paper: ${err.message}`)
    },
  })
}
