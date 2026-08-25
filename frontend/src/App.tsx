import { lazy, Suspense, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { request } from './lib/api'
import type { CurrentUser, SetupStatus } from './types'
import { ForgotPasswordPage, InvitationAcceptPage, LoginPage, RegisterPage, SetupPage } from './pages/AuthPages'
import { DialogA11y } from './components/DialogA11y'

const WorkspaceApp = lazy(() => import('./pages/WorkspaceApp').then((module) => ({ default: module.WorkspaceApp })))
const ExplorePage = lazy(() => import('./pages/SocialPages').then((module) => ({ default: module.ExplorePage })))
const PublicGardenPage = lazy(() => import('./pages/SocialPages').then((module) => ({ default: module.PublicGardenPage })))
const PublicProfilePage = lazy(() => import('./pages/SocialPages').then((module) => ({ default: module.PublicProfilePage })))
const PublicReaderPage = lazy(() => import('./pages/SocialPages').then((module) => ({ default: module.PublicReaderPage })))
const OAuthConsentPage = lazy(() => import('./pages/OpenPlatformCenter').then((module) => ({ default: module.OAuthConsentPage })))
const ShareReaderPage = lazy(() => import('./pages/ShareReaderPage').then((module) => ({ default: module.ShareReaderPage })))

function DeferredRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingScreen label="正在加载页面" />}>{children}</Suspense>
}

function BootRoute() {
  const setup = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => request<SetupStatus>('/api/v1/setup/status'),
  })
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => request<CurrentUser>('/api/v1/auth/me'),
    enabled: setup.data?.initialized === true,
    retry: false,
  })

  if (setup.isPending || (setup.data?.initialized && me.isPending)) {
    return <LoadingScreen label="正在打开你的知识空间" />
  }
  if (!setup.data?.initialized) return <Navigate to="/setup" replace />
  if (me.data) return <Navigate to="/app" replace />
  return <Navigate to="/login" replace />
}

function ProtectedRoute() {
  const location = useLocation()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => request<CurrentUser>('/api/v1/auth/me'),
    retry: false,
  })
  if (me.isPending) return <LoadingScreen label="正在同步工作区" />
  if (!me.data) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  return <DeferredRoute><WorkspaceApp currentUser={me.data} /></DeferredRoute>
}

export function App() {
  return (
    <>
      <DialogA11y />
      <Routes>
        <Route path="/" element={<BootRoute />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invitations/accept" element={<InvitationAcceptPage />} />
        <Route path="/oauth/consent" element={<DeferredRoute><OAuthConsentPage /></DeferredRoute>} />
        <Route path="/explore" element={<DeferredRoute><ExplorePage /></DeferredRoute>} />
        <Route path="/u/:slug" element={<DeferredRoute><PublicProfilePage /></DeferredRoute>} />
        <Route path="/garden/:slug" element={<DeferredRoute><PublicGardenPage /></DeferredRoute>} />
        <Route path="/p/:publicationId" element={<DeferredRoute><PublicReaderPage /></DeferredRoute>} />
        <Route path="/s/:token" element={<DeferredRoute><ShareReaderPage /></DeferredRoute>} />
        <Route path="/app/*" element={<ProtectedRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="loading-screen" aria-live="polite">
      <span className="brand-mark" aria-hidden="true">序</span>
      <span className="loading-pulse" />
      <p>{label}</p>
    </main>
  )
}
