// Lazy-loaded Life app — admin-only, mounted at /life/* by src/App.tsx.
// Loads its own CSS and routes; main papermind bundle stays untouched.
import React, { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import './life.css'

const TodayPage = lazy(() => import('./pages/TodayPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'))
const GoalsPage = lazy(() => import('./pages/GoalsPage'))
const JournalPage = lazy(() => import('./pages/JournalPage'))
const LearnPage = lazy(() => import('./pages/LearnPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))

const Loading: React.FC = () => (
  <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted, #888)' }}>
    Loading Life…
  </div>
)

const LifeApp: React.FC = () => (
  <Suspense fallback={<Loading />}>
    <Routes>
      <Route index element={<TodayPage />} />
      <Route path="schedule" element={<SchedulePage />} />
      <Route path="projects" element={<ProjectsPage />} />
      <Route path="projects/:id" element={<ProjectDetailPage />} />
      <Route path="goals" element={<GoalsPage />} />
      <Route path="learn" element={<LearnPage />} />
      <Route path="journal" element={<JournalPage />} />
      <Route path="review" element={<ReviewPage />} />
      <Route path="*" element={<Navigate to="/life" replace />} />
    </Routes>
  </Suspense>
)

export default LifeApp
