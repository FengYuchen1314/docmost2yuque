// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { WebhookDelivery, WebhookSubscription } from '../types'
import { WebhooksPanel } from './OpenPlatformCenter'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('loads older webhook deliveries without truncating operational history', async () => {
  const hook:WebhookSubscription={id:'hook-1',workspaceId:'workspace-1',name:'文稿事件',endpointUrl:'https://example.com/hook',events:['document.*'],active:true,consecutiveFailures:0,suspendedAt:null,createdAt:'2026-08-25T10:00:00Z',updatedAt:'2026-08-25T10:00:00Z',signingSecret:null}
  const delivery=(id:string,eventType:string):WebhookDelivery=>({id,webhookId:hook.id,eventId:`event-${id}`,eventType,status:'DELIVERED',attempts:1,nextAttemptAt:'2026-08-25T10:00:00Z',responseStatus:200,lastError:null,deliveredAt:'2026-08-25T10:00:01Z',createdAt:'2026-08-25T10:00:00Z',updatedAt:'2026-08-25T10:00:01Z'})
  const post=vi.spyOn(api,'post').mockImplementation(async(path,body)=>{
    if(path==='/api/v1/open-platform/webhooks/list')return [hook]
    if(path==='/api/v1/open-platform/webhooks/deliveries/page')return (body as {offset:number}).offset===0
      ?{items:[delivery('delivery-1','document.updated')],nextOffset:1,hasMore:true}
      :{items:[delivery('delivery-2','document.created')],nextOffset:2,hasMore:false}
    return undefined
  })
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><WebhooksPanel workspaceId="workspace-1"/></QueryClientProvider>)

  expect(await screen.findByText('document.updated')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'加载更多投递记录'}))
  expect(await screen.findByText('document.created')).toBeTruthy()
  await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/v1/open-platform/webhooks/deliveries/page',{webhookId:hook.id,limit:30,offset:1}))
  expect(screen.queryByRole('button',{name:'加载更多投递记录'})).toBeNull()
})
