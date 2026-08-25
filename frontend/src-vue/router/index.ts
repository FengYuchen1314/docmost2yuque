import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useSessionStore } from '../stores/session'

const routes: RouteRecordRaw[] = [
  { path: '/', component: () => import('../views/RootView.vue') },
  { path: '/setup', component: () => import('../views/auth/SetupView.vue'), meta: { public: true } },
  { path: '/login', component: () => import('../views/auth/LoginView.vue'), meta: { public: true } },
  { path: '/forgot-password', component: () => import('../views/auth/ForgotPasswordView.vue'), meta: { public: true } },
  { path: '/register', component: () => import('../views/auth/RegisterView.vue'), meta: { public: true } },
  { path: '/invitations/accept', component: () => import('../views/auth/InvitationView.vue'), meta: { public: true } },
  { path: '/explore', component: () => import('../views/public/ExploreView.vue'), meta: { public: true, title: '发现' } },
  { path: '/u/:slug', component: () => import('../views/public/ProfileView.vue'), meta: { public: true, title: '个人主页' } },
  { path: '/garden/:slug', component: () => import('../views/public/GardenView.vue'), meta: { public: true, title: '知识花园' } },
  { path: '/p/:publicationId', component: () => import('../views/public/ReaderView.vue'), meta: { public: true, title: '公开内容' } },
  { path: '/s/:token', component: () => import('../views/public/ShareView.vue'), meta: { public: true, title: '分享内容' } },
  { path: '/oauth/consent', component: () => import('../views/public/OAuthConsentView.vue'), meta: { public: true, title: '应用授权' } },
  {
    path: '/app', component: () => import('../layouts/AppLayout.vue'),
    children: [
      { path: '', component: () => import('../views/app/DashboardView.vue') },
      { path: 'notes', component: () => import('../views/app/QuickNotesView.vue'), meta: { title: '小记' } },
      { path: 'capture', component: () => import('../views/app/CaptureView.vue'), meta: { title: '收集内容' } },
      { path: 'notifications', component: () => import('../views/app/NotificationsView.vue'), meta: { title: '消息中心' } },
      { path: 'trash', component: () => import('../views/app/TrashView.vue'), meta: { title: '回收站' } },
      { path: 'templates', component: () => import('../views/app/TemplatesView.vue'), meta: { title: '模板中心' } },
      { path: 'transfers', component: () => import('../views/app/TransfersView.vue'), meta: { title: '导入与导出' } },
      { path: 'feed', component: () => import('../views/app/FeedView.vue'), meta: { title: '动态' } },
      { path: 'profile', component: () => import('../views/app/ProfileSettingsView.vue'), meta: { title: '公开主页设置' } },
      { path: 'account', component: () => import('../views/app/AccountView.vue'), meta: { title: '账号设置' } },
      { path: 'open-platform', component: () => import('../views/app/OpenPlatformView.vue'), meta: { title: '开放平台' } },
      { path: 'admin', component: () => import('../views/app/AdminView.vue'), meta: { title: '管理后台', admin: true } },
      { path: 'w/:workspaceId', component: () => import('../views/app/WorkspaceView.vue'), meta: { title: '工作区' } },
      { path: 'w/:workspaceId/teams/:teamId', component: () => import('../views/app/TeamView.vue'), meta: { title: '团队' } },
      { path: 'w/:workspaceId/settings', component: () => import('../views/app/WorkspaceSettingsView.vue'), meta: { title: '工作区设置' } },
      { path: 'pages/:pageId', component: () => import('../views/app/PageRedirectView.vue'), meta: { title: '文档' } },
      { path: 'kb/:knowledgeBaseId', component: () => import('../views/app/KnowledgeBaseView.vue'), meta: { title: '知识库' } },
      { path: 'kb/:knowledgeBaseId/settings', component: () => import('../views/app/KnowledgeBaseSettingsView.vue'), meta: { title: '知识库设置' } },
      { path: 'kb/:knowledgeBaseId/pages/:pageId', component: () => import('../views/app/PageEditorView.vue'), meta: { title: '编辑器' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({ history: createWebHistory(), routes, scrollBehavior: () => ({ top: 0 }) })
router.beforeEach(async (to) => {
  if (to.meta.public || to.path === '/') return true
  const session = useSessionStore()
  if (!session.ready) await session.loadUser()
  if (!session.user) return { path: '/login', query: { returnTo: to.fullPath } }
  if (to.meta.admin && !session.user.instanceAdmin) return '/app'
  return true
})
router.afterEach((to) => {
  document.title = typeof to.meta.title === 'string' ? `${to.meta.title} · 知序` : '知序 · 知识协作空间'
})
