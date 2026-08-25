// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import * as api from '../lib/api'
import type { CatalogTree, Page } from '../types'
import { CatalogList, catalogBreadcrumb, pageDraftMatches } from './WorkspaceApp'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const page:Page={id:'page-1',workspaceId:'workspace-1',knowledgeBaseId:'kb-1',title:'需求文档',icon:null,cover:null,contentType:'DOCUMENT',path:'requirements',publishMode:'MANUAL',publishedRevisionId:'publication-1',publishedAt:'2026-08-25T08:00:00Z',visibilityOverride:'INHERIT',documentSettings:{pageWidth:'STANDARD',fontFamily:'SANS',fontSize:'MEDIUM',paragraphSpacing:'NORMAL',showOutline:false},schemaVersion:1,draftRevision:2,content:{type:'doc'},plainText:'正文',createdBy:'user-1',updatedBy:'user-1',createdAt:'2026-08-25T07:00:00Z',updatedAt:'2026-08-25T09:00:00Z',deletedAt:null}
const tree:CatalogTree={knowledgeBaseId:'kb-1',revision:7,nodes:[
  {id:'group-1',knowledgeBaseId:'kb-1',nodeType:'GROUP',pageId:null,parentId:null,position:'1',titleOverride:'产品',url:null},
  {id:'node-1',knowledgeBaseId:'kb-1',nodeType:'DOCUMENT',pageId:page.id,parentId:'group-1',position:'1',titleOverride:null,url:null},
]}

it('builds the editor breadcrumb from the independent catalog hierarchy',()=>{
  const nested:CatalogTree={knowledgeBaseId:'kb-1',revision:1,nodes:[
    {id:'root',knowledgeBaseId:'kb-1',nodeType:'GROUP',pageId:null,parentId:null,position:'1',titleOverride:'产品',url:null},
    {id:'child',knowledgeBaseId:'kb-1',nodeType:'GROUP',pageId:null,parentId:'root',position:'1',titleOverride:'发布',url:null},
    {id:'document',knowledgeBaseId:'kb-1',nodeType:'DOCUMENT',pageId:page.id,parentId:'child',position:'1',titleOverride:'上线说明',url:null},
  ]}
  expect(catalogBreadcrumb(nested.nodes,page)).toEqual(['产品','发布','上线说明'])
  expect(catalogBreadcrumb([],page)).toEqual(['需求文档'])
})

it('treats an identical collaboration-persisted draft as a reconciled save',()=>{
  expect(pageDraftMatches(page,{title:page.title,body:page.plainText})).toBe(true)
  expect(pageDraftMatches(page,{title:page.title,body:`${page.plainText} /`})).toBe(false)
  expect(pageDraftMatches(page,{title:'另一个标题',body:page.plainText})).toBe(false)
})

it('exposes the catalog as a roving keyboard tree',async()=>{
  renderCatalog()
  expect(screen.getByRole('tree',{name:'知识库目录'})).toBeTruthy()
  const group=await screen.findByRole('treeitem',{name:'产品'})
  const documentItem=await screen.findByRole('treeitem',{name:/需求文档/})
  expect(group.getAttribute('aria-level')).toBe('1')
  expect(group.getAttribute('aria-expanded')).toBe('true')
  expect(documentItem.getAttribute('aria-level')).toBe('2')
  expect(group.getAttribute('tabindex')).toBe('0')
  expect(documentItem.getAttribute('tabindex')).toBe('-1')

  group.focus()
  fireEvent.keyDown(group,{key:'ArrowRight'})
  await waitFor(()=>expect(window.document.activeElement).toBe(documentItem))
  fireEvent.keyDown(documentItem,{key:'ArrowLeft'})
  await waitFor(()=>expect(window.document.activeElement).toBe(group))
  fireEvent.keyDown(group,{key:'ArrowLeft'})
  await waitFor(()=>expect(group.getAttribute('aria-expanded')).toBe('false'))
})

it('creates a child document from the catalog row and inserts it with one revision',async()=>{
  const created={...page,id:'page-2',title:'发布计划',path:'launch-plan',publishedRevisionId:null,publishedAt:null,draftRevision:0}
  const next={...tree,revision:8,nodes:[...tree.nodes,{id:'node-2',knowledgeBaseId:'kb-1',nodeType:'DOCUMENT' as const,pageId:created.id,parentId:'group-1',position:'2',titleOverride:null,url:null}]}
  const post=vi.spyOn(api,'post').mockImplementation(async(path)=>path==='/api/v1/pages/create'?created:path==='/api/v1/catalog/create'?next:undefined)
  renderCatalog()

  fireEvent.click(screen.getByLabelText('产品 更多操作'))
  fireEvent.click(screen.getByRole('button',{name:'产品 新建下级文稿'}))
  fireEvent.change(screen.getByRole('textbox',{name:'名称'}),{target:{value:'发布计划'}})
  fireEvent.change(screen.getByRole('textbox',{name:'访问路径'}),{target:{value:'launch-plan'}})
  fireEvent.click(screen.getByRole('button',{name:'创建文稿'}))

  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/pages/create',{knowledgeBaseId:'kb-1',title:'发布计划',path:'launch-plan',contentType:'DOCUMENT'}))
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/catalog/create',{knowledgeBaseId:'kb-1',nodeType:'DOCUMENT',pageId:'page-2',parentId:'group-1',beforeNodeId:null,afterNodeId:null,titleOverride:null,url:null,metadata:{},expectedRevision:7}))
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/app/kb/kb-1/pages/page-2'))
})

it('renames only the catalog display item and exposes publication status',async()=>{
  const renamed={...tree,revision:8,nodes:tree.nodes.map((node)=>node.id==='node-1'?{...node,titleOverride:'上线说明'}:node)}
  const post=vi.spyOn(api,'post').mockResolvedValue(renamed)
  renderCatalog()

  expect(await screen.findByLabelText('草稿有更新')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('需求文档 更多操作'))
  fireEvent.click(screen.getByRole('button',{name:'需求文档 重命名展示项'}))
  fireEvent.change(screen.getByRole('textbox',{name:'名称'}),{target:{value:'上线说明'}})
  fireEvent.click(screen.getByRole('button',{name:'保存名称'}))

  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/catalog/rename',{nodeId:'node-1',title:'上线说明',expectedRevision:7}))
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
  expect(post.mock.calls.some(([path])=>path==='/api/v1/pages/update')).toBe(false)
})

it('keeps remove-from-catalog separate from deleting the document',async()=>{
  const removed={...tree,revision:8,nodes:tree.nodes.filter((node)=>node.id!=='node-1')}
  const post=vi.spyOn(api,'post').mockResolvedValue(removed)
  renderCatalog()

  fireEvent.click(screen.getByLabelText('需求文档 更多操作'))
  fireEvent.click(screen.getByRole('button',{name:'需求文档 从目录移除'}))
  expect(screen.getByRole('alertdialog', { name: '从目录移除“需求文档”' }).textContent).toContain('文稿仍会保留在全部文稿中')
  fireEvent.click(screen.getByRole('button', { name: '从目录移除' }))
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/catalog/remove',{nodeId:'node-1',expectedRevision:7}))
  expect(post.mock.calls.some(([path])=>path==='/api/v1/pages/trash')).toBe(false)
})

it('renders only credential-free HTTPS catalog links as navigation',()=>{
  const links:CatalogTree={knowledgeBaseId:'kb-1',revision:1,nodes:[
    {id:'safe',knowledgeBaseId:'kb-1',nodeType:'LINK',pageId:null,parentId:null,position:'1',titleOverride:'安全链接',url:'https://example.com/docs'},
    {id:'unsafe',knowledgeBaseId:'kb-1',nodeType:'LINK',pageId:null,parentId:null,position:'2',titleOverride:'危险链接',url:'https://user:secret@example.com/private'},
  ]}
  renderCatalog(links,[])

  const safe=screen.getByRole('treeitem',{name:'安全链接'})
  expect(safe.querySelector('a')?.getAttribute('href')).toBe('https://example.com/docs')
  expect(screen.getByRole('treeitem',{name:'危险链接'}).querySelector('a')).toBeNull()
  expect(screen.getByText('危险链接').closest('a')).toBeNull()
})

function renderCatalog(value:CatalogTree=tree,pageValues:Page[]=[page]){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  client.setQueryData(['catalog','kb-1'],value)
  return render(<MemoryRouter><QueryClientProvider client={client}><CatalogList tree={value} pages={pageValues} knowledgeBaseId="kb-1" display={{defaultExpandDepth:3,showPath:true,showUpdatedAt:true}} onManage={()=>undefined}/><LocationProbe/></QueryClientProvider></MemoryRouter>)
}

function LocationProbe(){const location=useLocation();return <output data-testid="location">{location.pathname}</output>}
