import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, Check, CheckCircle2, MessageSquare, Pencil, Send, Star, Trash2, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { messageOf, post } from '../lib/api'
import type { Comment, WorkspaceMember } from '../types'

interface CommentPage { items: Comment[]; nextOffset: number; hasMore: boolean }

export function FavoriteButton({ pageId }: { pageId: string }) {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ['favorite', pageId],
    queryFn: () => post<{ favorite: boolean }>('/api/v1/favorites/status', { pageId }),
  })
  const mutation = useMutation({
    mutationFn: (favorite: boolean) => post<{ favorite: boolean }>('/api/v1/favorites/set', { pageId, favorite }),
    onSuccess: async (data) => {
      queryClient.setQueryData(['favorite', pageId], data)
      await queryClient.invalidateQueries({ queryKey: ['workbench'] })
    },
  })
  const favorite = status.data?.favorite ?? false
  return (
    <button
      className={`icon-button favorite-button ${favorite ? 'selected' : ''}`}
      onClick={() => mutation.mutate(!favorite)}
      disabled={status.isPending || mutation.isPending}
      aria-label={favorite ? '取消收藏' : '收藏文稿'}
      title={favorite ? '取消收藏' : '收藏文稿'}
    >
      <Star size={18} fill={favorite ? 'currentColor' : 'none'} />
    </button>
  )
}

export function CommentDrawer({
  pageId,
  workspaceId,
  currentUserId,
  onClose,
}: {
  pageId: string
  workspaceId: string
  currentUserId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [plainText, setPlainText] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [mentioned, setMentioned] = useState<string[]>([])
  const [showMentions, setShowMentions] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const comments = useInfiniteQuery({
    queryKey: ['comments', pageId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => post<CommentPage>('/api/v1/comments/page', { pageId, limit: 30, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined,
  })
  const members = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId }),
  })
  const values = useMemo(() => comments.data?.pages.flatMap((page) => page.items) ?? [], [comments.data])
  const roots = useMemo(() => values.filter((comment) => !comment.parentId), [values])
  const replies = useMemo(() => {
    const grouped = new Map<string, Comment[]>()
    for (const comment of values) {
      if (comment.parentId) grouped.set(comment.parentId, [...(grouped.get(comment.parentId) ?? []), comment])
    }
    return grouped
  }, [values])
  const create = useMutation({
    mutationFn: () => post<Comment>('/api/v1/comments/create', {
      pageId,
      parentId,
      anchor: { kind: 'PAGE' },
      body: { type: 'doc', content: [{ type: 'paragraph', text: plainText }] },
      plainText,
      mentionedUserIds: mentioned,
    }),
    onSuccess: async () => {
      setPlainText('')
      setParentId(null)
      setMentioned([])
      await queryClient.invalidateQueries({ queryKey: ['comments', pageId] })
    },
  })
  const resolve = useMutation({
    mutationFn: ({ commentId, resolved }: { commentId: string; resolved: boolean }) =>
      post<Comment>('/api/v1/comments/resolve', { commentId, resolved }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', pageId] }),
  })
  const update = useMutation({
    mutationFn: ({ commentId, text }: { commentId: string; text: string }) =>
      post<Comment>('/api/v1/comments/update', { commentId, body: commentBody(text), plainText: text }),
    onSuccess: async () => {
      setEditingId(null)
      setEditingText('')
      await queryClient.invalidateQueries({ queryKey: ['comments', pageId] })
    },
  })
  const remove = useMutation({
    mutationFn: (commentId: string) => post<void>('/api/v1/comments/delete', { commentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', pageId] }),
  })
  const toggleMention = (userId: string) => {
    setMentioned((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId])
  }
  const drawerError = comments.error ?? members.error ?? create.error ?? update.error ?? resolve.error ?? remove.error
  const renderComment = (comment: Comment, reply = false) => (
    <article className={`comment-card ${reply ? 'reply' : ''}`} key={comment.id}>
      <div className="comment-author">
        <span className="comment-avatar">{comment.creatorEmail.slice(0, 1).toUpperCase()}</span>
        <div><strong>{comment.creatorEmail}</strong><time>{relativeTime(comment.createdAt)}</time></div>
        <span className={`comment-status ${comment.status.toLowerCase()}`}>{comment.status === 'OPEN' ? '待处理' : '已解决'}</span>
      </div>
      {editingId === comment.id ? <div className="comment-edit"><textarea autoFocus aria-label="编辑评论" value={editingText} onChange={(event) => setEditingText(event.target.value)} /><div><button onClick={() => { setEditingId(null); setEditingText('') }}><X size={13} />取消</button><button className="save" disabled={!editingText.trim() || update.isPending} onClick={() => update.mutate({ commentId: comment.id, text: editingText.trim() })}><Check size={13} />保存</button></div></div> : <p>{comment.plainText}</p>}
      <div className="comment-actions">
        {!reply && <button onClick={() => setParentId(comment.id)}>回复</button>}
        {comment.createdBy === currentUserId && editingId !== comment.id && <button onClick={() => { setEditingId(comment.id); setEditingText(comment.plainText) }}><Pencil size={13} />编辑</button>}
        <button onClick={() => resolve.mutate({ commentId: comment.id, resolved: comment.status !== 'RESOLVED' })}>
          {comment.status === 'RESOLVED' ? <><Undo2 size={13} />重新打开</> : <><CheckCircle2 size={13} />解决</>}
        </button>
        {comment.createdBy === currentUserId && <button className="danger-link" onClick={() => remove.mutate(comment.id)}><Trash2 size={13} />删除</button>}
      </div>
      {!reply && replies.get(comment.id)?.map((child) => renderComment(child, true))}
    </article>
  )
  return (
    <aside className="comment-drawer" aria-label="评论">
      <header><div><MessageSquare size={18} /><strong>评论</strong><span>{values.length}{comments.hasNextPage ? '+' : ''}</span></div><button className="icon-button" onClick={onClose} aria-label="关闭评论"><X size={18} /></button></header>
      <div className="comment-list">
        {comments.isPending && <div className="drawer-loading"><span className="loading-pulse" /></div>}
        {!comments.isPending && roots.length === 0 && <div className="drawer-empty"><MessageSquare size={24} /><strong>留下第一条评论</strong><p>可以选择成员发送提及通知。</p></div>}
        {roots.map((comment) => renderComment(comment))}
        {comments.hasNextPage && <button className="button secondary small comment-load-more" disabled={comments.isFetchingNextPage} onClick={() => comments.fetchNextPage()}>{comments.isFetchingNextPage ? '加载中…' : '加载更多评论'}</button>}
        {Boolean(drawerError) && <div className="inline-error">{messageOf(drawerError)}</div>}
      </div>
      <div className="comment-composer">
        {parentId && <div className="replying">正在回复一条评论 <button onClick={() => setParentId(null)}>取消</button></div>}
        {mentioned.length > 0 && <div className="mention-summary">已提及 {mentioned.length} 人</div>}
        <textarea value={plainText} onChange={(event) => setPlainText(event.target.value)} placeholder="写下评论…" />
        <div className="composer-actions">
          <div className="mention-picker-wrap">
            <button className="icon-button" onClick={() => setShowMentions((value) => !value)} aria-label="提及成员"><AtSign size={17} /></button>
            {showMentions && <div className="mention-menu">
              {(members.data ?? []).filter((member) => member.userId !== currentUserId).map((member) => (
                <label key={member.userId}><input type="checkbox" checked={mentioned.includes(member.userId)} onChange={() => toggleMention(member.userId)} /><span>{member.displayName || member.email}</span></label>
              ))}
              {!members.data?.some((member) => member.userId !== currentUserId) && <p>暂无其他成员</p>}
            </div>}
          </div>
          <button className="button primary small" disabled={!plainText.trim() || create.isPending} onClick={() => create.mutate()}><Send size={14} />发送</button>
        </div>
      </div>
    </aside>
  )
}

function commentBody(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', text }] }
}

function relativeTime(value: string) {
  const date = new Date(value)
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`
  return date.toLocaleDateString('zh-CN')
}
