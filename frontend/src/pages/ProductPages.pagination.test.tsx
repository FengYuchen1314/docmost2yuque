// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../lib/api'
import type { Page, QuickNote, QuickNoteRevision, Template, Workspace } from '../types'
import { HistoryPanel } from './PageManagement'
import { ProductWorkbench, QuickNoteEditor, QuickNotesPage } from './ProductPages'
import { TemplateCenter } from './TemplateCenter'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('offers a real undo action after a successful workbench quick capture',async()=>{
  const workspace:Workspace={id:'workspace-1',workspaceType:'PERSONAL',name:'我的空间',defaultVisibility:'PRIVATE',defaultPublishMode:'MANUAL',membershipRole:'OWNER'}
  const created:QuickNote={id:'note-created',workspaceId:workspace.id,userId:'user-1',content:{},plainText:'稍后整理发布计划',status:'ACTIVE',source:'HOME',revision:1,tags:[],createdAt:'2026-08-25T08:00:00Z',updatedAt:'2026-08-25T08:00:00Z',archivedAt:null,deletedAt:null}
  const post=vi.spyOn(api,'post').mockImplementation(async(path)=>{
    if(path==='/api/v1/workbench/page')return {items:[{resourceId:'page-1',resourceType:'PAGE',workspaceId:workspace.id,knowledgeBaseId:'kb-1',knowledgeBaseName:'我的知识库',title:'发布计划',path:'launch-plan',contentType:'DOCUMENT',publicationStatus:'CHANGED',reason:'EDITED',activityAt:'2026-08-25T08:00:00Z',favorite:false,collaborators:[{userId:'user-2',displayName:'林静',email:'lin@example.com'}]}],nextOffset:1,hasMore:false}
    if(path==='/api/v1/notifications/list'||path==='/api/v1/knowledge-base-groups/list'||path==='/api/v1/knowledge-bases/list')return []
    if(path==='/api/v1/quick-notes/create')return created
    if(path==='/api/v1/quick-notes/delete')return undefined
    return undefined
  })
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<MemoryRouter><QueryClientProvider client={client}><ProductWorkbench workspaces={[workspace]}/></QueryClientProvider></MemoryRouter>)

  expect(await screen.findByText('我的知识库 / launch-plan')).toBeTruthy()
  expect(screen.getByText('草稿有更新')).toBeTruthy()
  expect(screen.getByLabelText('协作者：林静')).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox',{name:'快速记录'}),{target:{value:'稍后整理发布计划'}})
  fireEvent.click(screen.getByRole('button',{name:'记一笔'}))
  expect(await screen.findByText('已记下，可在小记中继续整理')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'撤销刚创建的小记'}))
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/quick-notes/delete',{quickNoteId:'note-created'}))
  await waitFor(()=>expect(screen.queryByText('已记下，可在小记中继续整理')).toBeNull())
})

it('expands workbench capture into structured rich text, tasks, links and images',async()=>{
  const workspace:Workspace={id:'workspace-1',workspaceType:'PERSONAL',name:'我的空间',defaultVisibility:'PRIVATE',defaultPublishMode:'MANUAL',membershipRole:'OWNER'}
  const created:QuickNote={id:'note-rich',workspaceId:workspace.id,userId:'user-1',content:{},plainText:'rich',status:'ACTIVE',source:'HOME',revision:1,tags:[],createdAt:'2026-08-25T08:00:00Z',updatedAt:'2026-08-25T08:00:00Z',archivedAt:null,deletedAt:null}
  const post=vi.spyOn(api,'post').mockImplementation(async(path)=>{
    if(path==='/api/v1/workbench/page')return {items:[],nextOffset:0,hasMore:false}
    if(path==='/api/v1/notifications/list'||path==='/api/v1/knowledge-base-groups/list'||path==='/api/v1/knowledge-bases/list')return []
    if(path==='/api/v1/quick-notes/create')return created
    return undefined
  })
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<MemoryRouter><QueryClientProvider client={client}><ProductWorkbench workspaces={[workspace]}/></QueryClientProvider></MemoryRouter>)

  fireEvent.click(screen.getByRole('button',{name:'展开快速记录'}))
  const editor=screen.getByRole('textbox',{name:'快速记录'}) as HTMLTextAreaElement
  fireEvent.click(screen.getByRole('button',{name:'插入任务'}))
  expect(editor.value).toBe('- [ ] 待办事项')
  fireEvent.change(editor,{target:{value:''}})
  fireEvent.click(screen.getByRole('button',{name:'插入链接'}))
  expect(editor.value).toBe('[链接标题](https://example.com)')
  fireEvent.change(editor,{target:{value:''}})
  fireEvent.click(screen.getByRole('button',{name:'插入图片'}))
  expect(editor.value).toBe('![图片说明](https://example.com/image.jpg)')

  const rich='- [x] 已完成\n- [ ] 待处理\n![封面](https://cdn.example.com/cover.png)\n**发布说明** [详情](https://example.com/release)'
  fireEvent.change(editor,{target:{value:rich}})
  fireEvent.click(screen.getByRole('button',{name:'记一笔'}))
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/quick-notes/create',expect.objectContaining({
    workspaceId:workspace.id,plainText:rich,source:'HOME',content:{type:'doc',content:[
      {type:'taskList',content:[
        {type:'taskItem',attrs:{checked:true},content:[{type:'paragraph',content:[{type:'text',text:'已完成'}]}]},
        {type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'待处理'}]}]},
      ]},
      {type:'image',attrs:{src:'https://cdn.example.com/cover.png',alt:'封面',title:null}},
      {type:'paragraph',content:[{type:'text',text:'发布说明',marks:[{type:'bold'}]},{type:'text',text:' '},{type:'text',text:'详情',marks:[{type:'link',attrs:{href:'https://example.com/release',target:'_blank',rel:'noopener noreferrer nofollow'}}]}]},
    ]},
  })))
})

it('shows quick-note image, task progress and link count on cards',async()=>{
  const note:QuickNote={id:'note-rich',workspaceId:'workspace-1',userId:'user-1',content:{type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:true}},{type:'taskItem',attrs:{checked:false}}]},{type:'image',attrs:{src:'https://cdn.example.com/cover.png',alt:'发布封面'}},{type:'paragraph',content:[{type:'text',text:'详情',marks:[{type:'link'}]}]}]},plainText:'- [x] 已完成\n- [ ] 待处理\n![发布封面](https://cdn.example.com/cover.png)\n[详情](https://example.com)',status:'ACTIVE',source:'QUICK_NOTE_PAGE',revision:1,tags:[],createdAt:'2026-08-25T08:00:00Z',updatedAt:'2026-08-25T08:00:00Z',archivedAt:null,deletedAt:null}
  vi.spyOn(api,'post').mockImplementation(async(path)=>{
    if(path==='/api/v1/quick-notes/page')return {items:[note],nextOffset:1,hasMore:false}
    if(path==='/api/v1/quick-notes/tags/list'||path==='/api/v1/knowledge-bases/list')return []
    return undefined
  })
  const workspace:Workspace={id:'workspace-1',workspaceType:'PERSONAL',name:'我的空间',defaultVisibility:'PRIVATE',defaultPublishMode:'MANUAL',membershipRole:'OWNER'}
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<MemoryRouter><QueryClientProvider client={client}><QuickNotesPage workspaces={[workspace]}/></QueryClientProvider></MemoryRouter>)

  expect(await screen.findByRole('img',{name:'发布封面'})).toBeTruthy()
  expect(screen.getByText('1/2 项已完成')).toBeTruthy()
  expect(screen.getByText('1 个链接')).toBeTruthy()
})

it('loads every quick-note page instead of truncating the collection', async () => {
  const note=(id:string,text:string):QuickNote=>({id,workspaceId:'workspace-1',userId:'user-1',content:{},plainText:text,status:'ACTIVE',source:'QUICK_NOTE_PAGE',revision:1,tags:[],createdAt:'2026-08-25T08:00:00Z',updatedAt:'2026-08-25T08:00:00Z',archivedAt:null,deletedAt:null})
  const post=vi.spyOn(api,'post').mockImplementation(async(path,body)=>{
    if(path==='/api/v1/quick-notes/tags/list'||path==='/api/v1/knowledge-bases/list')return []
    if(path==='/api/v1/quick-notes/page')return (body as {offset:number}).offset===0
      ?{items:[note('note-1','第一页灵感')],nextOffset:1,hasMore:true}
      :{items:[note('note-2','第二页灵感')],nextOffset:2,hasMore:false}
    return undefined
  })
  const workspace:Workspace={id:'workspace-1',workspaceType:'PERSONAL',name:'我的空间',defaultVisibility:'PRIVATE',defaultPublishMode:'MANUAL',membershipRole:'OWNER'}
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<MemoryRouter><QueryClientProvider client={client}><QuickNotesPage workspaces={[workspace]}/></QueryClientProvider></MemoryRouter>)

  expect(await screen.findByText('第一页灵感')).toBeTruthy()
  expect(post).toHaveBeenCalledWith('/api/v1/quick-notes/page',{status:'ACTIVE',tagId:null,query:'',limit:30,offset:0})
  fireEvent.click(screen.getByRole('button',{name:'加载更多小记'}))
  expect(await screen.findByText('第二页灵感')).toBeTruthy()
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/quick-notes/page',{status:'ACTIVE',tagId:null,query:'',limit:30,offset:1}))
  expect(screen.queryByRole('button',{name:'加载更多小记'})).toBeNull()
})

it('loads older templates through the paged template center',async()=>{
  const template=(id:string,name:string):Template=>({id,workspaceId:'workspace-1',templateType:'DOCUMENT',name,description:null,category:'研发',thumbnail:null,sourceResourceId:'page-1',snapshot:{},visibility:'WORKSPACE',useCount:0,createdBy:'user-1',createdAt:'2026-08-25T08:00:00Z',updatedAt:'2026-08-25T08:00:00Z'})
  const post=vi.spyOn(api,'post').mockImplementation(async(path,body)=>path==='/api/v1/templates/page'&&((body as {offset:number}).offset===0
    ?{items:[template('template-1','最新模板')],nextOffset:1,hasMore:true}
    :{items:[template('template-2','更早模板')],nextOffset:2,hasMore:false}))
  const workspace:Workspace={id:'workspace-1',workspaceType:'ORGANIZATION',name:'产品空间',defaultVisibility:'PRIVATE',defaultPublishMode:'MANUAL',membershipRole:'ADMIN'}
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><TemplateCenter workspaces={[workspace]}/></QueryClientProvider>)

  expect(await screen.findByText('最新模板')).toBeTruthy()
  expect(post).toHaveBeenCalledWith('/api/v1/templates/page',{workspaceId:'workspace-1',templateType:null,query:'',limit:24,offset:0})
  fireEvent.click(screen.getByRole('button',{name:'加载更多模板'}))
  expect(await screen.findByText('更早模板')).toBeTruthy()
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/templates/page',{workspaceId:'workspace-1',templateType:null,query:'',limit:24,offset:1}))
  expect(screen.queryByRole('button',{name:'加载更多模板'})).toBeNull()
})

it('loads older page draft revisions without truncating restorable history',async()=>{
  const revision=(id:string,revisionNo:number,title:string)=>({id,pageId:'page-1',revisionNo,revisionKind:'MANUAL',description:null,title,content:{type:'doc'},plainText:title,schemaVersion:1,createdBy:'user-1',createdAt:'2026-08-25T08:00:00Z'})
  const post=vi.spyOn(api,'post').mockImplementation(async(path,body)=>path==='/api/v1/pages/history/page'&&((body as {offset:number}).offset===0
    ?{items:[revision('revision-2',2,'当前草稿')],nextOffset:1,hasMore:true}
    :{items:[revision('revision-1',1,'最早草稿')],nextOffset:2,hasMore:false}))
  const page={id:'page-1',draftRevision:2,title:'当前草稿'} as Page
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><HistoryPanel page={page} onUpdated={()=>undefined}/></QueryClientProvider>)

  expect(await screen.findByText('当前草稿',{selector:'strong'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'加载更多历史版本'}))
  expect(await screen.findByText('最早草稿',{selector:'strong'})).toBeTruthy()
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/pages/history/page',{pageId:'page-1',limit:30,offset:1}))
  expect(screen.queryByRole('button',{name:'加载更多历史版本'})).toBeNull()
})

it('saves the current draft as a named manual version',async()=>{
  const page={id:'page-1',workspaceId:'workspace-1',knowledgeBaseId:'kb-1',title:'评审稿',icon:null,cover:null,contentType:'DOCUMENT',path:'review',publishMode:'MANUAL',publishedRevisionId:null,publishedAt:null,visibilityOverride:'INHERIT',documentSettings:{pageWidth:'STANDARD',fontFamily:'SANS',fontSize:'MEDIUM',paragraphSpacing:'NORMAL',showOutline:false},schemaVersion:1,draftRevision:2,content:{type:'doc'},plainText:'当前内容',createdBy:'user-1',updatedBy:'user-1',createdAt:'2026-08-25T08:00:00Z',updatedAt:'2026-08-25T09:00:00Z',deletedAt:null} satisfies Page
  const saved={...page,draftRevision:3}
  const updated=vi.fn()
  const post=vi.spyOn(api,'post').mockImplementation(async(path)=>path==='/api/v1/pages/history/page'
    ?{items:[],nextOffset:0,hasMore:false}
    :path==='/api/v1/pages/update'?saved:undefined)
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><HistoryPanel page={page} onUpdated={updated}/></QueryClientProvider>)

  fireEvent.change(screen.getByRole('textbox',{name:'版本说明'}),{target:{value:'产品评审通过'}})
  fireEvent.click(screen.getByRole('button',{name:'保存版本'}))
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/pages/update',{
    pageId:'page-1',expectedRevision:2,title:'评审稿',content:{type:'doc'},schemaVersion:1,revisionKind:'MANUAL',revisionDescription:'产品评审通过',
  }))
  expect(await screen.findByText('已保存为手工版本 v3')).toBeTruthy()
  expect(updated).toHaveBeenCalledWith(saved,false)
})

it('previews, compares and creates a server-backed copy from page history',async()=>{
  const historical={id:'revision-1',pageId:'page-1',revisionNo:1,revisionKind:'MANUAL',description:'第一版',title:'历史标题',content:{type:'doc',content:[{type:'paragraph',text:'历史正文'}]},plainText:'历史正文',schemaVersion:1,createdBy:'user-1',createdAt:'2026-08-25T08:00:00Z'}
  const page={id:'page-1',workspaceId:'workspace-1',knowledgeBaseId:'kb-1',title:'当前标题',icon:'🧭',cover:null,contentType:'DOCUMENT',path:'current-page',publishMode:'MANUAL',publishedRevisionId:null,publishedAt:null,visibilityOverride:'INHERIT',documentSettings:{pageWidth:'STANDARD',fontFamily:'SANS',fontSize:'MEDIUM',paragraphSpacing:'NORMAL',showOutline:false},schemaVersion:1,draftRevision:2,content:{type:'doc'},plainText:'当前正文',createdBy:'user-1',updatedBy:'user-1',createdAt:'2026-08-25T08:00:00Z',updatedAt:'2026-08-25T09:00:00Z',deletedAt:null} satisfies Page
  const copied={...page,id:'page-copy',title:'历史标题副本',path:'historical-copy',draftRevision:1,plainText:'历史正文'}
  const post=vi.spyOn(api,'post').mockImplementation(async(path)=>path==='/api/v1/pages/history/page'
    ?{items:[historical],nextOffset:1,hasMore:false}
    :path==='/api/v1/pages/history/copy'?copied:undefined)
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><HistoryPanel page={page} onUpdated={()=>undefined}/></QueryClientProvider>)

  fireEvent.click(await screen.findByRole('button',{name:'预览版本 1'}))
  expect(await screen.findByRole('dialog',{name:'预览历史版本 1'})).toBeTruthy()
  expect(screen.getAllByText('历史正文').length).toBeGreaterThan(1)
  fireEvent.click(screen.getByRole('button',{name:'关闭历史预览'}))

  fireEvent.click(screen.getByRole('button',{name:'与当前稿对比版本 1'}))
  expect(await screen.findByRole('dialog',{name:'对比历史版本 1 与当前稿'})).toBeTruthy()
  expect(screen.getByText('当前正文')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'关闭版本对比'}))

  fireEvent.click(screen.getByRole('button',{name:'基于版本 1 创建副本'}))
  fireEvent.change(screen.getByRole('textbox',{name:'副本标题'}),{target:{value:'历史标题副本'}})
  fireEvent.change(screen.getByRole('textbox',{name:'副本访问路径'}),{target:{value:'historical-copy'}})
  fireEvent.click(screen.getByRole('button',{name:'创建副本'}))
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/pages/history/copy',{pageId:'page-1',revisionNo:1,title:'历史标题副本',path:'historical-copy'}))
  expect(await screen.findByText('副本已经创建')).toBeTruthy()
  expect(screen.getByRole('link',{name:/打开副本/}).getAttribute('href')).toBe('/app/kb/kb-1/pages/page-copy')
})

it('loads older quick-note revisions inside the editor',async()=>{
  const note:QuickNote={id:'note-1',workspaceId:'workspace-1',userId:'user-1',content:{},plainText:'当前小记',status:'ACTIVE',source:'QUICK_NOTE_PAGE',revision:2,tags:[],createdAt:'2026-08-25T08:00:00Z',updatedAt:'2026-08-25T08:00:00Z',archivedAt:null,deletedAt:null}
  const revision=(id:string,number:number,text:string):QuickNoteRevision=>({id,quickNoteId:note.id,revision:number,kind:number===1?'CREATE':'AUTO_SAVE',content:{},plainText:text,createdAt:'2026-08-25T08:00:00Z'})
  const post=vi.spyOn(api,'post').mockImplementation(async(path,body)=>path==='/api/v1/quick-notes/history/page'&&((body as {offset:number}).offset===0
    ?{items:[revision('revision-2',2,'当前小记')],nextOffset:1,hasMore:true}
    :{items:[revision('revision-1',1,'最早小记')],nextOffset:2,hasMore:false}))
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><QuickNoteEditor note={note} tags={[]} onClose={()=>undefined} onUpdated={async()=>undefined}/></QueryClientProvider>)

  expect(screen.getByRole('dialog',{name:'编辑小记'})).toBeTruthy()
  expect(screen.getByRole('textbox',{name:'小记正文'})).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('已保存')
  expect(await screen.findByText('当前小记',{selector:'.note-history p'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'加载更多历史版本'}))
  expect(await screen.findByText('最早小记')).toBeTruthy()
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/quick-notes/history/page',{quickNoteId:note.id,limit:30,offset:1}))
  expect(screen.queryByRole('button',{name:'加载更多历史版本'})).toBeNull()
})
