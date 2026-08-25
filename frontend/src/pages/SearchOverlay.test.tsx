// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import * as api from '../lib/api'
import type { SearchResponse, Workspace } from '../types'
import { SearchOverlay } from './SearchOverlay'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('pages through mixed resource results and includes workspace members', async () => {
  const first: SearchResponse = { results: [{ documentId: 'doc-page', resourceId: 'page-1', resourceType: 'PAGE', sourceScope: 'DRAFT', title: '发布手册', snippet: '第一页结果', path: 'release', contentType: 'DOCUMENT', publicationId: null, knowledgeBaseId: 'kb-1', publicationStatus: 'CHANGED', score: 90, updatedAt: '2026-08-25T08:00:00Z' }], nextOffset: 7, hasMore: true }
  const second: SearchResponse = { results: [{ documentId: 'user-1', resourceId: 'user-1', resourceType: 'USER', sourceScope: 'CANONICAL', title: '林静', snippet: 'lin@example.com · member', path: null, contentType: null, publicationId: null, knowledgeBaseId: null, score: 80, updatedAt: '2026-08-24T08:00:00Z' }], nextOffset: 8, hasMore: false }
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, body) => {
    if(path==='/api/v1/knowledge-bases/list')return [{id:'kb-1',name:'产品手册'}]
    if(path==='/api/v1/workspaces/members')return [{userId:'user-1',email:'lin@example.com',displayName:'林静',role:'MEMBER'}]
    return (body as { offset: number }).offset === 0 ? first : second
  })
  const workspace: Workspace = { id: 'workspace-1', workspaceType: 'ORGANIZATION', name: '产品空间', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'ADMIN' }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<MemoryRouter><QueryClientProvider client={client}><SearchOverlay workspaces={[workspace]} open onClose={() => undefined} /></QueryClientProvider></MemoryRouter>)

  fireEvent.change(screen.getByRole('textbox', { name: '搜索关键词' }), { target: { value: '发布' } })
  expect(await screen.findByText('第一页结果')).toBeTruthy()
  expect(screen.getByRole('region', { name: '文稿结果' })).toBeTruthy()
  expect(screen.getByText(/产品手册 · \/release · 草稿有更新/)).toBeTruthy()
  expect(post).toHaveBeenCalledWith('/api/v1/search', expect.objectContaining({
    workspaceId: workspace.id, query: '发布', resourceTypes: expect.arrayContaining(['PAGE', 'USER', 'ATTACHMENT']), knowledgeBaseId:null, creatorId:null, updatedFrom:null, updatedTo:null, offset: 0, limit: 25,
  }))
  fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }))
  expect(await screen.findByText('lin@example.com · member')).toBeTruthy()
  expect(screen.getByRole('region', { name: '成员结果' })).toBeTruthy()
  await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/search', expect.objectContaining({ offset: 7, limit: 25 })))
  expect(screen.queryByRole('button', { name: '加载更多结果' })).toBeNull()
})

it('applies knowledge-base, creator and update-time filters before permission paging', async () => {
  const response:SearchResponse={results:[],nextOffset:0,hasMore:false}
  const post=vi.spyOn(api,'post').mockImplementation(async(path)=>{
    if(path==='/api/v1/knowledge-bases/list')return [{id:'kb-1',name:'产品手册'}]
    if(path==='/api/v1/workspaces/members')return [{userId:'user-1',email:'lin@example.com',displayName:'林静',role:'MEMBER'}]
    return response
  })
  const workspace:Workspace={id:'workspace-1',workspaceType:'ORGANIZATION',name:'产品空间',defaultVisibility:'PRIVATE',defaultPublishMode:'MANUAL',membershipRole:'MEMBER'}
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<MemoryRouter><QueryClientProvider client={client}><SearchOverlay workspaces={[workspace]} open onClose={()=>undefined}/></QueryClientProvider></MemoryRouter>)

  await screen.findByRole('option',{name:'产品手册'})
  await screen.findByRole('option',{name:'林静'})
  fireEvent.change(screen.getByRole('combobox',{name:'筛选知识库'}),{target:{value:'kb-1'}})
  fireEvent.change(screen.getByRole('combobox',{name:'筛选创建者'}),{target:{value:'user-1'}})
  fireEvent.change(screen.getByRole('combobox',{name:'筛选更新时间'}),{target:{value:'MONTH'}})
  fireEvent.change(screen.getByRole('textbox',{name:'搜索关键词'}),{target:{value:'发布'}})
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/search',expect.objectContaining({knowledgeBaseId:'kb-1',creatorId:'user-1',updatedFrom:expect.any(String),updatedTo:null})))
  expect(screen.getByRole('button',{name:'清除筛选'})).toBeTruthy()
})

it('opens an attachment result on its owning page and highlights attachment management', async () => {
  const response: SearchResponse = { results: [{ documentId: 'attachment-1', resourceId: 'attachment-1', resourceType: 'ATTACHMENT', sourceScope: 'CANONICAL', title: '发布检查表.pdf', snippet: '青鸟项目上线核对', path: 'page-1', contentType: 'PDF', publicationId: null, knowledgeBaseId: 'kb-1', score: 95, updatedAt: '2026-08-25T08:00:00Z' }], nextOffset: 1, hasMore: false }
  vi.spyOn(api, 'post').mockImplementation(async(path)=>path==='/api/v1/knowledge-bases/list'||path==='/api/v1/workspaces/members'?[]:response)
  const workspace: Workspace = { id: 'workspace-1', workspaceType: 'ORGANIZATION', name: '产品空间', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'MEMBER' }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<MemoryRouter><QueryClientProvider client={client}><SearchOverlay workspaces={[workspace]} open onClose={() => undefined} /><LocationProbe /></QueryClientProvider></MemoryRouter>)

  fireEvent.change(screen.getByRole('textbox', { name: '搜索关键词' }), { target: { value: '青鸟' } })
  fireEvent.click(await screen.findByRole('option', { name: /发布检查表.pdf/ }))
  expect(screen.getByTestId('location').textContent).toBe('/app/kb/kb-1/pages/page-1?manage=ATTACHMENTS&attachment=attachment-1')
})

function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }
