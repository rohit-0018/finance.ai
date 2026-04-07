// Lazy-loaded Life app — admin-only, mounted at /life/* by src/App.tsx.
// Loads its own CSS and routes; main papermind bundle stays untouched.
import React, { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import './life.css'

const TodayPage = lazy(() => import('./pages/TodayPage'))
const TodosPage = lazy(() => import('./pages/TodosPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const QuestionsPage = lazy(() => import('./pages/QuestionsPage'))
const FinancePage = lazy(() => import('./pages/FinancePage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'))
const GoalsPage = lazy(() => import('./pages/GoalsPage'))
const JournalPage = lazy(() => import('./pages/JournalPage'))
const LearnPage = lazy(() => import('./pages/LearnPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const BrainstormPage = lazy(() => import('./pages/BrainstormPage'))
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'))
const WorkPage = lazy(() => import('./pages/WorkPage'))
const PersonalPage = lazy(() => import('./pages/PersonalPage'))
const LearningsPage = lazy(() => import('./pages/LearningsPage'))
const MemoryPage = lazy(() => import('./pages/MemoryPage'))
const WeeklyOneOnePage = lazy(() => import('./pages/WeeklyOneOnePage'))
const EulogyPage = lazy(() => import('./pages/EulogyPage'))
const RitualPage = lazy(() => import('./pages/RitualPage'))

const Loading: React.FC = () => (
  <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted, #888)' }}>
    Loading Life…
  </div>
)

const LifeApp: React.FC = () => (
  <Suspense fallback={<Loading />}>
    <Routes>
      <Route index element={<TodayPage />} />
      <Route path="todos" element={<TodosPage />} />
      <Route path="questions" element={<QuestionsPage />} />
      <Route path="finance" element={<FinancePage />} />
      <Route path="schedule" element={<SchedulePage />} />
      <Route path="calendar" element={<SchedulePage />} />
      <Route path="projects" element={<ProjectsPage />} />
      <Route path="projects/:id" element={<ProjectDetailPage />} />
      <Route path="goals" element={<GoalsPage />} />
      <Route path="learn" element={<LearnPage />} />
      <Route path="journal" element={<JournalPage />} />
      <Route path="review" element={<ReviewPage />} />
      <Route path="brainstorm" element={<BrainstormPage />} />
      <Route path="brainstorm/:id" element={<BrainstormPage />} />
      <Route path="integrations" element={<IntegrationsPage />} />
      <Route path="work" element={<WorkPage />} />
      <Route path="personal" element={<PersonalPage />} />
      <Route path="learnings" element={<LearningsPage />} />
      <Route path="memory" element={<MemoryPage />} />
      <Route path="weekly-1-1" element={<WeeklyOneOnePage />} />
      <Route path="eulogy" element={<EulogyPage />} />
      <Route path="ritual" element={<RitualPage />} />
      <Route path="*" element={<Navigate to="/life" replace />} />
    </Routes>
  </Suspense>
)

export default LifeApp
