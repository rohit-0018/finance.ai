import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Layout from './components/Layout'
import { useAppStore } from './store'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const FeedPage = lazy(() => import('./pages/FeedPage'))
const ReaderPage = lazy(() => import('./pages/ReaderPage'))
const SavedPage = lazy(() => import('./pages/SavedPage'))
const NotesPage = lazy(() => import('./pages/NotesPage'))
const FeedsPage = lazy(() => import('./pages/FeedsPage'))
const AdminPage = lazy(() => import('./pages/SettingsPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

const PageLoader: React.FC = () => (
  <div className="loading-center">Loading...</div>
)

const AuthenticatedApp: React.FC = () => (
  <Layout>
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<FeedPage />} />
        <Route path="/reader/:id" element={<ReaderPage />} />
        <Route path="/saved" element={<SavedPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/feeds" element={<FeedsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </Suspense>
  </Layout>
)

const UnauthenticatedApp: React.FC = () => (
  <Suspense fallback={<PageLoader />}>
    <LoginPage />
  </Suspense>
)

const AppContent: React.FC = () => {
  const currentUser = useAppStore((s) => s.currentUser)
  return currentUser ? <AuthenticatedApp /> : <UnauthenticatedApp />
}

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#fff',
            color: '#1a1a2e',
            border: '1px solid #e5e7eb',
            fontFamily: "'Inter', sans-serif",
            fontSize: '0.85rem',
            boxShadow: '0 4px 6px rgba(0,0,0,0.06)',
          },
        }}
      />
    </QueryClientProvider>
  )
}

export default App
