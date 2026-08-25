import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AtSign, CalendarCheck, Check, ChevronRight, CircleDot, Code2, Columns3, ExternalLink, FileQuestion,
  Download, FileText, Image, LayoutGrid, LoaderCircle, LockKeyhole, Music, Palette,
  Minus, Paperclip, Plus, Search, Trash2, UploadCloud, Video, Vote, X,
} from 'lucide-react'
import { messageOf, post, upload } from '../lib/api'
import { SensitiveTextCard } from '../components/SensitiveTextCard'
import { DatabaseCardView } from '../components/DatabaseCardView'
import { DrawingCardEditor, DrawingCardView } from '../components/DrawingCard'
import { DiagramSourceEditor, FormulaCardView, MindMapCardView, MindMapEditor, TechnicalDiagramCard } from '../components/DiagramCards'
import {
  allowedProviderUrl,
  encodeContentCardToken,
  imageWidthClassName,
  normalizeImageWidth,
  parseContentCardTokens,
  safeMediaUrl,
  type ImageWidth,
  type ParsedContentCard,
} from '../lib/contentCards'
import { encryptSensitiveText, isSensitiveTextEnvelope } from '../lib/sensitiveText'
import { EmbeddedDatabaseEditor } from './FirstClassEditors'
import type { CheckinState, ContentCardDefinition, PollState, WorkspaceMember } from '../types'

const providerCards = new Set(['youtube', 'bilibili', 'music', 'map', 'figma'])
const mediaCards = new Set(['image', 'attachment', 'audio', 'video', 'file-preview', 'pdf', 'office'])
const simpleConfigCards = new Set(['quote', 'callout', 'toggle', 'code', 'formula', 'flowchart', 'mermaid', 'uml', 'text-diagram', 'mind-map', 'table', 'kanban', 'database', 'whiteboard', 'drawio', 'excalidraw'])

interface AttachmentView {
  id: string
  workspaceId: string
  pageId: string | null
  originalName: string
  mediaType: string
  sizeBytes: number
  checksumSha256: string
  contentUrl: string
}

interface CalendarDraftEvent { id: string; title: string; start: string; end: string }
interface GalleryDraftItem { id: string; attachmentId?: string; url: string; alt: string; mediaType?: string; sizeBytes?: number }
interface KanbanDraftCard { id: string; title: string; description: string }
interface KanbanDraftColumn { id: string; title: string; color: string; cards: KanbanDraftCard[] }

export function ContentCardMenu({
  pageId,
  workspaceId,
  initialCard,
  onInsert,
  onClose,
}: {
  pageId: string
  workspaceId?: string
  initialCard?: ParsedContentCard | null
  onInsert: (token: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [selected, setSelected] = useState<ContentCardDefinition | null>(null)
  const [providerUrl, setProviderUrl] = useState('')
  const [mediaAttachment, setMediaAttachment] = useState<AttachmentView | null>(null)
  const [pollQuestion, setPollQuestion] = useState('你怎么看？')
  const [pollOptions, setPollOptions] = useState<Array<{ id: string; label: string }>>([
    { id: 'option-a', label: '选项 A' },
    { id: 'option-b', label: '选项 B' },
  ])
  const [pollMultiple, setPollMultiple] = useState(false)
  const [pollAnonymous, setPollAnonymous] = useState(false)
  const [pollClosesAt, setPollClosesAt] = useState('')
  const [checkinTitle, setCheckinTitle] = useState('每日打卡')
  const [checkinStartDate, setCheckinStartDate] = useState('')
  const [checkinEndDate, setCheckinEndDate] = useState('')
  const [checkinTimezone, setCheckinTimezone] = useState('Asia/Shanghai')
  const [calendarTimezone, setCalendarTimezone] = useState('Asia/Shanghai')
  const [calendarEvents, setCalendarEvents] = useState<CalendarDraftEvent[]>([])
  const [draftData, setDraftData] = useState<Record<string, unknown>>({})
  const [galleryItems, setGalleryItems] = useState<GalleryDraftItem[]>([])
  const [sensitivePlaintext, setSensitivePlaintext] = useState('')
  const [sensitiveHint, setSensitiveHint] = useState('')
  const [sensitivePassword, setSensitivePassword] = useState('')
  const [sensitiveConfirmation, setSensitiveConfirmation] = useState('')
  const [mentionUserId, setMentionUserId] = useState('')
  const [cardSave, setCardSave] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null })
  const [statusValue, setStatusValue] = useState('TODO')
  const [imageAlt, setImageAlt] = useState('')
  const [columnContents, setColumnContents] = useState(['左栏内容', '右栏内容'])
  const [columnRatios, setColumnRatios] = useState([1, 1])
  const [imageWidth, setImageWidth] = useState<ImageWidth>('LARGE')
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const commandListId = useId()
  const definitions = useQuery({
    queryKey: ['content-cards', 'definitions', pageId],
    queryFn: () => post<ContentCardDefinition[]>('/api/v1/content-cards/definitions', { pageId }),
  })
  const recent = useQuery({
    queryKey: ['content-cards', 'recent', pageId],
    queryFn: () => post<ContentCardDefinition[]>('/api/v1/content-cards/recent', { pageId }),
  })
  const mentionMembers = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId }),
    enabled: selected?.id === 'mention' && Boolean(workspaceId),
  })
  const mediaUpload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size <= 0) throw new Error('不能上传空文件')
      if (file.size > 50 * 1024 * 1024) throw new Error('单个附件不能超过 50 MB')
      const form = new FormData()
      form.append('pageId', pageId)
      form.append('file', file)
      return upload<AttachmentView>('/api/v1/attachments/upload', form)
    },
    onSuccess: (value) => {
      setMediaAttachment(value)
      setProviderUrl(value.contentUrl)
      if (selected?.id === 'image') setImageAlt(value.originalName)
    },
  })
  const galleryUpload = useMutation({
    mutationFn: async (files: File[]) => {
      const uploaded: GalleryDraftItem[] = []
      for (const file of files.slice(0, Math.max(0, 100 - galleryItems.length))) {
        if (!file.type.startsWith('image/')) throw new Error(`${file.name || '所选文件'} 不是图片`)
        if (file.size <= 0) throw new Error('不能上传空图片')
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name || '图片'} 超过 50 MB`)
        const form = new FormData()
        form.append('pageId', pageId)
        form.append('file', file)
        const attachment = await upload<AttachmentView>('/api/v1/attachments/upload', form)
        uploaded.push({ id: attachment.id, attachmentId: attachment.id, url: attachment.contentUrl, alt: attachment.originalName, mediaType: attachment.mediaType, sizeBytes: attachment.sizeBytes })
      }
      return uploaded
    },
    onSuccess: (items) => setGalleryItems((current) => [...current, ...items].slice(0, 100)),
  })
  const normalized = query.trim().toLowerCase()
  const filtered = (definitions.data ?? []).filter((definition) => {
    if (!normalized) return true
    return [definition.title, definition.id, ...definition.aliases]
      .some((value) => value.toLowerCase().includes(normalized))
  })
  const ordered = useMemo(() => {
    if (normalized || !recent.data?.length) return filtered
    const recentIds = new Set(recent.data.map((definition) => definition.id))
    return [...recent.data, ...filtered.filter((definition) => !recentIds.has(definition.id))]
  }, [filtered, normalized, recent.data])
  const groups = useMemo(() => {
    const values = new Map<string, ContentCardDefinition[]>()
    for (const definition of ordered) {
      const category = !normalized && recent.data?.some((item) => item.id === definition.id) ? '最近使用' : definition.category
      values.set(category, [...(values.get(category) ?? []), definition])
    }
    return [...values.entries()]
  }, [ordered, normalized, recent.data])
  const activeCommandId = ordered[activeIndex] ? `${commandListId}-option-${ordered[activeIndex]!.id}` : undefined
  useEffect(() => {
    const firstEnabled = ordered.findIndex((definition) => definition.enabled)
    setActiveIndex(firstEnabled >= 0 ? firstEnabled : 0)
  }, [query, definitions.data, recent.data])
  useEffect(() => {
    if (selected || !activeCommandId) return
    const activeOption = document.getElementById(activeCommandId)
    if (activeOption && 'scrollIntoView' in activeOption) activeOption.scrollIntoView({ block: 'nearest' })
  }, [activeCommandId, selected])
  useEffect(() => {
    if (!selected) return
    window.requestAnimationFrame(() => {
      const configuration = dialogRef.current?.querySelector<HTMLElement>('.card-configuration')
      const target = configuration?.querySelector<HTMLElement>('input:not([disabled]):not([type="file"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      const focusTarget = target ?? configuration ?? dialogRef.current
      focusTarget?.focus()
    })
  }, [selected?.id])
  const returnToCommands = () => {
    setSelected(null)
    window.requestAnimationFrame(() => searchRef.current?.focus())
  }
  const choose = (definition: ContentCardDefinition, initialData = definition.initialData) => {
    if (!definition.enabled) return
    setSelected(definition)
    setDraftData(structuredClone(initialData))
    setMediaAttachment(null)
    mediaUpload.reset()
    setProviderUrl(typeof initialData.url === 'string' ? initialData.url : '')
    setPollQuestion(typeof initialData.question === 'string' ? initialData.question : '你怎么看？')
    const initialOptions = Array.isArray(initialData.options)
      ? initialData.options.map(asObject).filter(Boolean).map((option, index) => ({ id: text(option?.id, `option-${index + 1}`), label: text(option?.label, '') })).slice(0, 20)
      : []
    setPollOptions(initialOptions.length >= 2 ? initialOptions : [{ id: 'option-a', label: '选项 A' }, { id: 'option-b', label: '选项 B' }])
    setPollMultiple(initialData.multiple === true)
    setPollAnonymous(initialData.anonymous === true)
    setPollClosesAt(toLocalDateTime(initialData.closesAt))
    setCheckinTitle(text(initialData.title, '每日打卡'))
    setCheckinStartDate(text(initialData.startDate, ''))
    setCheckinEndDate(text(initialData.endDate, ''))
    setCheckinTimezone(text(initialData.timezone, 'Asia/Shanghai'))
    setCalendarTimezone(text(initialData.timezone, 'Asia/Shanghai'))
    setCalendarEvents(Array.isArray(initialData.events) ? initialData.events.map(asObject).filter(Boolean).map((event) => ({
      id: text(event?.id, crypto.randomUUID()),
      title: text(event?.title, ''),
      start: toLocalDateTime(event?.start),
      end: toLocalDateTime(event?.end),
    })).slice(0, 500) : [])
    setGalleryItems(Array.isArray(initialData.items) ? initialData.items.map(asObject).filter(Boolean).map((item) => ({
      id: text(item?.id ?? item?.attachmentId, crypto.randomUUID()),
      ...(typeof item?.attachmentId === 'string' ? { attachmentId: item.attachmentId } : {}),
      url: text(item?.url, ''),
      alt: text(item?.alt, ''),
      ...(typeof item?.mediaType === 'string' ? { mediaType: item.mediaType } : {}),
      ...(typeof item?.sizeBytes === 'number' ? { sizeBytes: item.sizeBytes } : {}),
    })).slice(0, 100) : [])
    setSensitivePlaintext('')
    setSensitiveHint(text(initialData.hint, ''))
    setSensitivePassword('')
    setSensitiveConfirmation('')
    setMentionUserId(text(initialData.userId, ''))
    setCardSave({ pending: false, error: null })
    setStatusValue(typeof initialData.value === 'string' ? initialData.value : 'TODO')
    setImageAlt(typeof initialData.alt === 'string' ? initialData.alt : '')
    setImageWidth(normalizeImageWidth(initialData.width))
    if (definition.id === 'columns') {
      const initialColumns = Array.isArray(initialData.columns)
        ? initialData.columns.map((column) => text(asObject(column)?.content, '')).slice(0, 4)
        : []
      const contents = initialColumns.length >= 2 ? initialColumns : ['左栏内容', '右栏内容']
      setColumnContents(contents)
      const ratios = Array.isArray(initialData.ratios)
        ? initialData.ratios.map((ratio) => typeof ratio === 'number' && ratio > 0 ? ratio : 1).slice(0, contents.length)
        : []
      setColumnRatios(ratios.length === contents.length ? ratios : contents.map(() => 1))
    }
  }
  const initializedCard = useRef<string | null>(null)
  useEffect(() => {
    if (!initialCard || initializedCard.current === initialCard.instanceId || !definitions.data) return
    const definition = definitions.data.find((item) => item.id === initialCard.cardId)
    if (!definition || !initialCard.data) return
    initializedCard.current = initialCard.instanceId
    choose(definition, initialCard.data)
  }, [definitions.data, initialCard])
  const insert = async () => {
    if (!selected) return
    const data = structuredClone(draftData)
    if (providerCards.has(selected.id)) data.url = providerUrl.trim()
    if (mediaCards.has(selected.id)) {
      data.url = mediaAttachment?.contentUrl ?? providerUrl.trim()
      if (selected.id === 'image') data.width = imageWidth
      if (mediaAttachment) {
        data.attachmentId = mediaAttachment.id
        data.mediaType = mediaAttachment.mediaType
        data.sizeBytes = mediaAttachment.sizeBytes
        if (selected.id === 'image') data.alt = mediaAttachment.originalName
        else if (['attachment', 'file-preview', 'pdf', 'office'].includes(selected.id)) data.name = mediaAttachment.originalName
        else data.title = mediaAttachment.originalName
      } else if (initialCard && providerUrl.trim() !== initialCard.data?.url) {
        delete data.attachmentId
        delete data.mediaType
        delete data.sizeBytes
      }
      if (selected.id === 'image') data.alt = imageAlt.trim()
    }
    if (selected.id === 'poll') {
      data.question = pollQuestion.trim()
      data.options = pollOptions.map((option) => ({ id: option.id, label: option.label.trim() }))
      data.multiple = pollMultiple
      data.anonymous = pollAnonymous
      if (pollClosesAt) data.closesAt = new Date(pollClosesAt).toISOString()
      else delete data.closesAt
    }
    if (selected.id === 'status') {
      data.value = statusValue
      data.label = statusLabel(statusValue)
    }
    if (selected.id === 'checkin') {
      data.title = checkinTitle.trim()
      data.startDate = checkinStartDate
      data.endDate = checkinEndDate
      data.timezone = checkinTimezone
    }
    if (selected.id === 'calendar') {
      data.timezone = calendarTimezone
      data.events = calendarEvents.map((event) => ({
        id: event.id,
        title: event.title.trim(),
        start: new Date(event.start).toISOString(),
        ...(event.end ? { end: new Date(event.end).toISOString() } : {}),
      }))
    }
    if (selected.id === 'gallery') data.items = galleryItems.map((item) => ({ ...item }))
    if (selected.id === 'sensitive-text') {
      setCardSave({ pending: true, error: null })
      try {
        data.hint = sensitiveHint.trim()
        if (sensitivePlaintext || sensitivePassword || sensitiveConfirmation) {
          if (sensitivePassword !== sensitiveConfirmation) throw new Error('两次输入的查看密码不一致')
          Object.assign(data, await encryptSensitiveText(sensitivePlaintext, sensitivePassword))
        } else if (!isSensitiveTextEnvelope(data)) {
          throw new Error('请输入要保护的文字和至少 8 位查看密码')
        }
      } catch (reason) {
        setCardSave({ pending: false, error: reason instanceof Error ? reason.message : '敏感文字加密失败' })
        return
      }
      setCardSave({ pending: false, error: null })
    }
    if (selected.id === 'mention') {
      const member = mentionMembers.data?.find((value) => value.userId === mentionUserId)
      data.userId = mentionUserId
      data.label = member?.displayName || member?.email || text(data.label, '')
    }
    if (selected.id === 'kanban') data.columns = normalizeKanbanColumns(data.columns)
    if (selected.id === 'database') {
      data.type = 'database'
      if (typeof data.filter !== 'string') data.filter = ''
      if (data.sortFieldId === undefined) data.sortFieldId = null
    }
    if (selected.id === 'columns') {
      data.count = columnContents.length
      data.columns = columnContents.map((content) => ({ content }))
      data.ratios = columnRatios
    }
    const token = encodeContentCardToken(selected.id, selected.version, data, initialCard?.instanceId)
    onInsert(token)
    void post<void>('/api/v1/content-cards/use', { pageId, cardId: selected.id })
    onClose()
  }
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (selected) {
      if (event.key === 'Escape') { event.preventDefault(); if (initialCard) onClose(); else returnToCommands() }
      return
    }
    const enabledIndices = ordered.flatMap((definition, index) => definition.enabled ? [index] : [])
    const moveActive = (direction: -1 | 1) => setActiveIndex((current) => {
      if (!enabledIndices.length) return 0
      const position = enabledIndices.indexOf(current)
      if (position < 0) return direction > 0 ? enabledIndices[0]! : enabledIndices.at(-1)!
      return enabledIndices[Math.max(0, Math.min(enabledIndices.length - 1, position + direction))]!
    })
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
    if (event.key === 'Home' && enabledIndices.length) { event.preventDefault(); setActiveIndex(enabledIndices[0]!) }
    if (event.key === 'End' && enabledIndices.length) { event.preventDefault(); setActiveIndex(enabledIndices.at(-1)!) }
    if (event.key === 'Enter' && ordered[activeIndex]) { event.preventDefault(); choose(ordered[activeIndex]) }
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }
  const invalidPoll = selected?.id === 'poll' && (
    !pollQuestion.trim()
    || pollOptions.length < 2
    || pollOptions.some((option) => !option.label.trim())
    || Boolean(pollClosesAt && Number.isNaN(new Date(pollClosesAt).getTime()))
  )
  const invalidCheckin = selected?.id === 'checkin' && (
    !checkinTitle.trim() || !checkinStartDate || !checkinEndDate || checkinEndDate < checkinStartDate || !checkinTimezone
  )
  const invalidCalendar = selected?.id === 'calendar' && (
    !calendarTimezone || calendarEvents.some((event) => !event.title.trim() || !event.start || Number.isNaN(new Date(event.start).getTime()) || Boolean(event.end && (Number.isNaN(new Date(event.end).getTime()) || new Date(event.end) < new Date(event.start))))
  )
  const invalidSimple = selected ? !validSimpleCard(selected.id, draftData) : false
  const invalidGallery = selected?.id === 'gallery' && (galleryItems.length < 1 || galleryItems.some((item) => !safeMediaUrl(item.url)))
  const preservingSensitive = selected?.id === 'sensitive-text' && Boolean(initialCard?.data && isSensitiveTextEnvelope(initialCard.data)) && !sensitivePlaintext && !sensitivePassword && !sensitiveConfirmation
  const invalidSensitive = selected?.id === 'sensitive-text' && !preservingSensitive && (!sensitivePlaintext || sensitivePlaintext.length > 20_000 || sensitivePassword.length < 8 || sensitivePassword.length > 200 || sensitivePassword !== sensitiveConfirmation)
  const invalidMention = selected?.id === 'mention' && (!mentionUserId || !mentionMembers.data?.some((member) => member.userId === mentionUserId))
  return (
    <div className="dialog-backdrop card-menu-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onKeyDown={handleKeyDown}>
      <div ref={dialogRef} className="content-card-menu" role="dialog" aria-modal="true" aria-labelledby="card-menu-title" data-dialog-escape="managed">
        <header><div><p className="eyebrow">{initialCard ? '编辑' : '插入'}</p><h2 id="card-menu-title">{selected ? selected.title : initialCard ? '正在加载卡片…' : '内容卡片'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭内容卡片编辑器"><X size={18} /></button></header>
        {!selected ? <>
          <label className="card-menu-search"><Search size={16} /><input ref={searchRef} autoFocus role="combobox" aria-label="搜索内容卡片" aria-autocomplete="list" aria-expanded="true" aria-controls={commandListId} aria-activedescendant={activeCommandId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索卡片、中文名或英文别名" /><kbd>↑↓ Enter</kbd></label>
          <div className="card-menu-list" id={commandListId} role="listbox" aria-label="内容卡片命令">
            {groups.map(([category, values], groupIndex) => <section key={category} role="group" aria-labelledby={`${commandListId}-group-${groupIndex}`}><h3 id={`${commandListId}-group-${groupIndex}`}>{category}</h3><div>{values.map((definition) => {
              const index = ordered.findIndex((item) => item.id === definition.id)
              return <button key={`${category}-${definition.id}`} id={`${commandListId}-option-${definition.id}`} role="option" aria-selected={index === activeIndex} tabIndex={-1} className={index === activeIndex ? 'active' : ''} disabled={!definition.enabled} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(definition)}><span className={`card-icon category-${definition.category}`}>{cardGlyph(definition.category)}</span><div><strong>{definition.title}</strong><small>/{definition.aliases[0] ?? definition.id}</small></div>{definition.fullScreen && <i>全屏</i>}<ChevronRight size={14} /></button>
            })}</div></section>)}
            {!ordered.length && <div className="card-menu-empty"><FileQuestion size={24} /><strong>没有匹配的卡片</strong><p>试试中文名、英文名或快捷别名。</p></div>}
          </div>
        </> : <CardConfiguration definition={selected} data={draftData} onData={setDraftData} providerUrl={providerUrl} onProviderUrl={(value) => { setProviderUrl(value); if (value !== mediaAttachment?.contentUrl) setMediaAttachment(null) }} pollQuestion={pollQuestion} onPollQuestion={setPollQuestion} pollOptions={pollOptions} onPollOptions={setPollOptions} pollMultiple={pollMultiple} onPollMultiple={setPollMultiple} pollAnonymous={pollAnonymous} onPollAnonymous={setPollAnonymous} pollClosesAt={pollClosesAt} onPollClosesAt={setPollClosesAt} checkinTitle={checkinTitle} onCheckinTitle={setCheckinTitle} checkinStartDate={checkinStartDate} onCheckinStartDate={setCheckinStartDate} checkinEndDate={checkinEndDate} onCheckinEndDate={setCheckinEndDate} checkinTimezone={checkinTimezone} onCheckinTimezone={setCheckinTimezone} calendarTimezone={calendarTimezone} onCalendarTimezone={setCalendarTimezone} calendarEvents={calendarEvents} onCalendarEvents={setCalendarEvents} galleryItems={galleryItems} onGalleryItems={setGalleryItems} galleryUploadPending={galleryUpload.isPending} galleryUploadError={galleryUpload.error} onGalleryFiles={(files) => galleryUpload.mutate(files)} sensitivePlaintext={sensitivePlaintext} onSensitivePlaintext={setSensitivePlaintext} sensitiveHint={sensitiveHint} onSensitiveHint={setSensitiveHint} sensitivePassword={sensitivePassword} onSensitivePassword={setSensitivePassword} sensitiveConfirmation={sensitiveConfirmation} onSensitiveConfirmation={setSensitiveConfirmation} editingSensitive={Boolean(initialCard)} mentionUserId={mentionUserId} onMentionUserId={setMentionUserId} mentionMembers={mentionMembers.data ?? []} mentionMembersPending={mentionMembers.isPending} mentionMembersError={mentionMembers.error} statusValue={statusValue} onStatusValue={setStatusValue} columnContents={columnContents} onColumnContents={setColumnContents} columnRatios={columnRatios} onColumnRatios={setColumnRatios} imageAlt={imageAlt} onImageAlt={setImageAlt} imageWidth={imageWidth} onImageWidth={setImageWidth} attachment={mediaAttachment} uploadPending={mediaUpload.isPending} uploadError={mediaUpload.error} onMediaFile={(file) => mediaUpload.mutate(file)} />}
        {selected && <>{cardSave.error && <div className="inline-error card-save-error" role="alert">{cardSave.error}</div>}<footer>{!initialCard && <button className="button quiet" data-dialog-back onClick={returnToCommands}>返回</button>}<button className="button primary" onClick={() => void insert()} disabled={cardSave.pending || mediaUpload.isPending || galleryUpload.isPending || invalidPoll || invalidCheckin || invalidCalendar || invalidSimple || invalidGallery || invalidSensitive || invalidMention || providerCards.has(selected.id) && !allowedProviderUrl(selected.id, providerUrl) || mediaCards.has(selected.id) && !safeMediaUrl(providerUrl)}>{cardSave.pending ? <LoaderCircle className="spin" /> : <Palette size={16} />}{cardSave.pending ? '正在加密…' : initialCard ? '保存更改' : '插入卡片'}</button></footer></>}
      </div>
    </div>
  )
}

function CardConfiguration({ definition, data, onData, providerUrl, onProviderUrl, pollQuestion, onPollQuestion, pollOptions, onPollOptions, pollMultiple, onPollMultiple, pollAnonymous, onPollAnonymous, pollClosesAt, onPollClosesAt, checkinTitle, onCheckinTitle, checkinStartDate, onCheckinStartDate, checkinEndDate, onCheckinEndDate, checkinTimezone, onCheckinTimezone, calendarTimezone, onCalendarTimezone, calendarEvents, onCalendarEvents, galleryItems, onGalleryItems, galleryUploadPending, galleryUploadError, onGalleryFiles, sensitivePlaintext, onSensitivePlaintext, sensitiveHint, onSensitiveHint, sensitivePassword, onSensitivePassword, sensitiveConfirmation, onSensitiveConfirmation, editingSensitive, mentionUserId, onMentionUserId, mentionMembers, mentionMembersPending, mentionMembersError, statusValue, onStatusValue, columnContents, onColumnContents, columnRatios, onColumnRatios, imageAlt, onImageAlt, imageWidth, onImageWidth, attachment, uploadPending, uploadError, onMediaFile }: {
  definition: ContentCardDefinition
  data: Record<string, unknown>
  onData: (value: Record<string, unknown>) => void
  providerUrl: string
  onProviderUrl: (value: string) => void
  pollQuestion: string
  onPollQuestion: (value: string) => void
  pollOptions: Array<{ id: string; label: string }>
  onPollOptions: (value: Array<{ id: string; label: string }>) => void
  pollMultiple: boolean
  onPollMultiple: (value: boolean) => void
  pollAnonymous: boolean
  onPollAnonymous: (value: boolean) => void
  pollClosesAt: string
  onPollClosesAt: (value: string) => void
  checkinTitle: string
  onCheckinTitle: (value: string) => void
  checkinStartDate: string
  onCheckinStartDate: (value: string) => void
  checkinEndDate: string
  onCheckinEndDate: (value: string) => void
  checkinTimezone: string
  onCheckinTimezone: (value: string) => void
  calendarTimezone: string
  onCalendarTimezone: (value: string) => void
  calendarEvents: CalendarDraftEvent[]
  onCalendarEvents: (value: CalendarDraftEvent[]) => void
  galleryItems: GalleryDraftItem[]
  onGalleryItems: (value: GalleryDraftItem[]) => void
  galleryUploadPending: boolean
  galleryUploadError: unknown
  onGalleryFiles: (files: File[]) => void
  sensitivePlaintext: string
  onSensitivePlaintext: (value: string) => void
  sensitiveHint: string
  onSensitiveHint: (value: string) => void
  sensitivePassword: string
  onSensitivePassword: (value: string) => void
  sensitiveConfirmation: string
  onSensitiveConfirmation: (value: string) => void
  editingSensitive: boolean
  mentionUserId: string
  onMentionUserId: (value: string) => void
  mentionMembers: WorkspaceMember[]
  mentionMembersPending: boolean
  mentionMembersError: unknown
  statusValue: string
  onStatusValue: (value: string) => void
  columnContents: string[]
  onColumnContents: (value: string[]) => void
  columnRatios: number[]
  onColumnRatios: (value: number[]) => void
  imageAlt: string
  onImageAlt: (value: string) => void
  imageWidth: ImageWidth
  onImageWidth: (value: ImageWidth) => void
  attachment: AttachmentView | null
  uploadPending: boolean
  uploadError: unknown
  onMediaFile: (file: File) => void
}) {
  return <div className="card-configuration">
    <div className="selected-card-summary"><span className={`card-icon category-${definition.category}`}>{cardGlyph(definition.category)}</span><div><strong>{definition.title}</strong><p>{definition.category} · schema v{definition.version} · {definition.exportFormats.join(' / ')}</p></div></div>
    {providerCards.has(definition.id) && <label className="field"><span className="field-label">安全嵌入地址</span><input autoFocus value={providerUrl} onChange={(event) => onProviderUrl(event.target.value)} placeholder="https://…" /><small>仅支持该服务的 HTTPS 白名单域名，渲染时使用受限 sandbox。</small></label>}
    {mediaCards.has(definition.id) && <div className="media-upload-configuration">
      <label className={`media-upload-drop ${attachment ? 'uploaded' : ''}`}>
        {uploadPending ? <LoaderCircle className="spin" /> : mediaGlyph(definition.id)}
        <strong>{uploadPending ? '正在安全上传…' : attachment?.originalName ?? `选择${definition.title}文件`}</strong>
        <small>{attachment ? `${formatBytes(attachment.sizeBytes)} · SHA-256 ${attachment.checksumSha256.slice(0, 12)}…` : '文件将保存到实例附件卷；单个文件最大 50 MB'}</small>
        <input type="file" accept={mediaAccept(definition.id)} disabled={uploadPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) onMediaFile(file); event.currentTarget.value = '' }} />
      </label>
      {Boolean(uploadError) && <div className="inline-error">{messageOf(uploadError)}</div>}
      <div className="media-source-divider"><span>或者</span></div>
      <label className="field"><span className="field-label">HTTPS 媒体地址</span><input value={providerUrl} onChange={(event) => onProviderUrl(event.target.value)} placeholder="https://…" /><small>可使用外部 HTTPS 地址；推荐上传到本站，避免链接失效和跨域限制。</small></label>
      {definition.id === 'image' && <label className="field"><span className="field-label">替代文字</span><input aria-label="替代文字" value={imageAlt} maxLength={500} onChange={(event) => onImageAlt(event.target.value)} placeholder="简要描述图片内容" /><small>图片无法显示或使用读屏软件时会读取这段说明。</small></label>}
      {definition.id === 'image' && <label className="field"><span className="field-label">显示宽度</span><select aria-label="显示宽度" value={imageWidth} onChange={(event) => onImageWidth(event.target.value as ImageWidth)}><option value="SMALL">小 · 最大 320 px</option><option value="MEDIUM">中 · 最大 520 px</option><option value="LARGE">大 · 最大 760 px</option><option value="FULL">通栏 · 填满正文</option></select><small>只保存预设尺寸，不接受自定义 CSS；手机端始终自适应屏幕。</small></label>}
    </div>}
    {definition.id === 'poll' && <div className="poll-configuration">
      <label className="field"><span className="field-label">问题</span><input autoFocus aria-label="投票问题" value={pollQuestion} maxLength={300} onChange={(event) => onPollQuestion(event.target.value)} /></label>
      <div className="poll-option-editor"><header><strong>选项</strong><small>2–20 项；编辑已有投票时会保留选项身份和票数关联</small></header>{pollOptions.map((option, index) => <label key={option.id}><span>{index + 1}</span><input aria-label={`投票选项 ${index + 1}`} value={option.label} maxLength={200} onChange={(event) => onPollOptions(pollOptions.map((value, target) => target === index ? { ...value, label: event.target.value } : value))} /><button type="button" className="icon-button danger" title={`删除选项 ${index + 1}`} aria-label={`删除投票选项 ${index + 1}`} disabled={pollOptions.length <= 2} onClick={() => onPollOptions(pollOptions.filter((_, target) => target !== index))}><Trash2 /></button></label>)}<button type="button" className="button quiet small" disabled={pollOptions.length >= 20} onClick={() => onPollOptions([...pollOptions, { id: `option-${crypto.randomUUID()}`, label: `选项 ${pollOptions.length + 1}` }])}><Plus />添加选项</button></div>
      <div className="poll-settings-grid"><label className="check-field"><input aria-label="允许多选" type="checkbox" checked={pollMultiple} onChange={(event) => onPollMultiple(event.target.checked)} /><span>允许多选</span></label><label className="check-field"><input aria-label="匿名投票" type="checkbox" checked={pollAnonymous} onChange={(event) => onPollAnonymous(event.target.checked)} /><span>匿名投票</span></label></div>
      <label className="field"><span className="field-label">截止时间（可选）</span><input aria-label="投票截止时间" type="datetime-local" value={pollClosesAt} onChange={(event) => onPollClosesAt(event.target.value)} /><small>使用浏览器当前时区保存，留空表示长期有效。</small></label>
    </div>}
    {definition.id === 'checkin' && <div className="schedule-card-configuration">
      <label className="field"><span className="field-label">打卡名称</span><input aria-label="打卡名称" value={checkinTitle} maxLength={200} onChange={(event) => onCheckinTitle(event.target.value)} /></label>
      <div className="schedule-date-grid"><label className="field"><span className="field-label">开始日期</span><input aria-label="打卡开始日期" type="date" value={checkinStartDate} onChange={(event) => onCheckinStartDate(event.target.value)} /></label><label className="field"><span className="field-label">结束日期</span><input aria-label="打卡结束日期" type="date" min={checkinStartDate} value={checkinEndDate} onChange={(event) => onCheckinEndDate(event.target.value)} /></label></div>
      <TimezoneField label="打卡时区" value={checkinTimezone} onChange={onCheckinTimezone} />
    </div>}
    {definition.id === 'calendar' && <div className="schedule-card-configuration">
      <TimezoneField label="日历时区" value={calendarTimezone} onChange={onCalendarTimezone} />
      <div className="calendar-event-editor"><header><div><strong>日历事件</strong><small>最多 500 条；结束时间必须晚于开始时间</small></div><button type="button" className="button quiet small" disabled={calendarEvents.length >= 500} onClick={() => onCalendarEvents([...calendarEvents, { id: crypto.randomUUID(), title: `事件 ${calendarEvents.length + 1}`, start: nextLocalHour(), end: '' }])}><Plus />添加事件</button></header>{calendarEvents.map((calendarEvent, index) => <article key={calendarEvent.id}><input aria-label={`日历事件 ${index + 1} 标题`} value={calendarEvent.title} maxLength={300} onChange={(event) => onCalendarEvents(calendarEvents.map((value, target) => target === index ? { ...value, title: event.target.value } : value))} /><div><label><span>开始</span><input aria-label={`日历事件 ${index + 1} 开始`} type="datetime-local" value={calendarEvent.start} onChange={(event) => onCalendarEvents(calendarEvents.map((value, target) => target === index ? { ...value, start: event.target.value } : value))} /></label><label><span>结束（可选）</span><input aria-label={`日历事件 ${index + 1} 结束`} type="datetime-local" min={calendarEvent.start} value={calendarEvent.end} onChange={(event) => onCalendarEvents(calendarEvents.map((value, target) => target === index ? { ...value, end: event.target.value } : value))} /></label><button type="button" className="icon-button danger" title={`删除日历事件 ${index + 1}`} aria-label={`删除日历事件 ${index + 1}`} onClick={() => onCalendarEvents(calendarEvents.filter((_, target) => target !== index))}><Trash2 /></button></div></article>)}{!calendarEvents.length && <div className="calendar-event-empty">还没有事件；可以先插入空日历，稍后再编辑。</div>}</div>
    </div>}
    {definition.id === 'gallery' && <div className="gallery-configuration">
      <label className="media-upload-drop"><Image /><strong>{galleryUploadPending ? '正在上传图片…' : '选择一张或多张图片'}</strong><small>最多 100 张，每张最大 50 MB；上传后可排序、改说明或移除。</small><input type="file" accept="image/*" multiple disabled={galleryUploadPending || galleryItems.length >= 100} onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) onGalleryFiles(files); event.currentTarget.value = '' }} /></label>
      {Boolean(galleryUploadError) && <div className="inline-error">{messageOf(galleryUploadError)}</div>}
      <div className="gallery-configuration-grid">{galleryItems.map((item, index) => <article key={item.id}><div>{safeMediaUrl(item.url) ? <img src={safeMediaUrl(item.url)!} alt="" /> : <MediaPlaceholder title="图片地址无效" />}</div><label><span>替代文字</span><input aria-label={`画廊图片 ${index + 1} 替代文字`} value={item.alt} maxLength={500} onChange={(event) => onGalleryItems(galleryItems.map((value, target) => target === index ? { ...value, alt: event.target.value } : value))} /></label><footer><button type="button" className="icon-button" title={`画廊图片 ${index + 1} 左移`} aria-label={`画廊图片 ${index + 1} 左移`} disabled={index === 0} onClick={() => onGalleryItems(moveItem(galleryItems, index, index - 1))}><ArrowLeft /></button><button type="button" className="icon-button" title={`画廊图片 ${index + 1} 右移`} aria-label={`画廊图片 ${index + 1} 右移`} disabled={index === galleryItems.length - 1} onClick={() => onGalleryItems(moveItem(galleryItems, index, index + 1))}><ArrowRight /></button><button type="button" className="icon-button danger" title={`移除画廊图片 ${index + 1}`} aria-label={`移除画廊图片 ${index + 1}`} onClick={() => onGalleryItems(galleryItems.filter((_, target) => target !== index))}><Trash2 /></button></footer></article>)}</div>
    </div>}
    {definition.id === 'sensitive-text' && <div className="sensitive-text-configuration"><div className="security-note"><LockKeyhole /><div><strong>明文和密码只在当前浏览器内处理</strong><p>AES‑256‑GCM 加密；PBKDF2‑SHA256 迭代 210,000 次。服务端只保存密文、盐和随机 IV。</p></div></div>{editingSensitive && <p className="configuration-hint">只修改提示语时，将下面三项全部留空即可保留原密文。重新输入内容会生成新的盐和 IV。</p>}<TextAreaField label="要保护的文字" value={sensitivePlaintext} maxLength={20_000} onChange={onSensitivePlaintext} /><TextField label="密码提示（可选）" value={sensitiveHint} maxLength={300} onChange={onSensitiveHint} /><div className="sensitive-password-grid"><label className="field"><span className="field-label">查看密码</span><input aria-label="敏感文字查看密码" type="password" value={sensitivePassword} minLength={8} maxLength={200} autoComplete="new-password" onChange={(event) => onSensitivePassword(event.target.value)} /></label><label className="field"><span className="field-label">确认密码</span><input aria-label="确认敏感文字密码" type="password" value={sensitiveConfirmation} minLength={8} maxLength={200} autoComplete="new-password" onChange={(event) => onSensitiveConfirmation(event.target.value)} /></label></div></div>}
    {definition.id === 'mention' && <div className="mention-card-configuration"><div className="security-note mention-note"><AtSign /><div><strong>提及空间成员</strong><p>保存后会向对方发送一次站内通知；编辑同一张卡片不会重复提醒。</p></div></div><label className="field"><span className="field-label">选择成员</span><select aria-label="提及成员" autoFocus value={mentionUserId} disabled={mentionMembersPending} onChange={(event) => onMentionUserId(event.target.value)}><option value="">{mentionMembersPending ? '正在读取成员…' : '请选择空间成员'}</option>{mentionMembers.map((member) => <option key={member.userId} value={member.userId}>{member.displayName ? `${member.displayName} · ${member.email}` : member.email}</option>)}</select></label>{Boolean(mentionMembersError) && <div className="inline-error">{messageOf(mentionMembersError)}</div>}</div>}
    {definition.id === 'status' && <label className="field"><span className="field-label">状态</span><select value={statusValue} onChange={(event) => onStatusValue(event.target.value)}><option value="TODO">待处理</option><option value="IN_PROGRESS">进行中</option><option value="BLOCKED">受阻</option><option value="DONE">已完成</option><option value="CANCELLED">已取消</option></select></label>}
    {definition.id === 'columns' && <div className="columns-configuration"><header><div><Columns3 /><span><strong>分栏内容</strong><small>2–4 栏；窄屏会自动纵向排列</small></span></div><div><button type="button" className="icon-button" title="减少一栏" aria-label="减少一栏" disabled={columnContents.length <= 2} onClick={() => { onColumnContents(columnContents.slice(0, -1)); onColumnRatios(columnRatios.slice(0, -1)) }}><Minus /></button><button type="button" className="icon-button" title="增加一栏" aria-label="增加一栏" disabled={columnContents.length >= 4} onClick={() => { onColumnContents([...columnContents, `第 ${columnContents.length + 1} 栏内容`]); onColumnRatios([...columnRatios, 1]) }}><Plus /></button></div></header><div className="columns-configuration-grid" style={{ gridTemplateColumns: columnRatios.map((ratio) => `${ratio}fr`).join(' ') }}>{columnContents.map((content, index) => <label key={index}><span>第 {index + 1} 栏 · 宽度 {columnRatios[index]?.toFixed(2) ?? '1.00'}</span><textarea rows={5} value={content} maxLength={20_000} onChange={(event) => onColumnContents(columnContents.map((value, target) => target === index ? event.target.value : value))} /><input type="range" min="0.5" max="3" step="0.25" value={columnRatios[index] ?? 1} onChange={(event) => onColumnRatios(columnRatios.map((value, target) => target === index ? Number(event.target.value) : value))} aria-label={`第 ${index + 1} 栏宽度`} /></label>)}</div></div>}
    {simpleConfigCards.has(definition.id) && <SimpleCardConfiguration cardId={definition.id} data={data} onData={onData} />}
    {!providerCards.has(definition.id) && !mediaCards.has(definition.id) && !simpleConfigCards.has(definition.id) && !['poll', 'checkin', 'calendar', 'gallery', 'sensitive-text', 'mention', 'status', 'columns'].includes(definition.id) && <div className="card-default-preview"><strong>初始配置</strong><pre>{JSON.stringify(definition.initialData, null, 2)}</pre></div>}
  </div>
}

function SimpleCardConfiguration({ cardId, data, onData }: { cardId: string; data: Record<string, unknown>; onData: (value: Record<string, unknown>) => void }) {
  const update = (field: string, value: unknown) => onData({ ...data, [field]: value })
  if (cardId === 'quote') return <div className="simple-card-configuration"><TextAreaField label="引用内容" value={text(data.text, '')} maxLength={20_000} onChange={(value) => update('text', value)} /><TextField label="来源（可选）" value={text(data.source, '')} maxLength={300} onChange={(value) => update('source', value)} /></div>
  if (cardId === 'callout') return <div className="simple-card-configuration"><label className="field"><span className="field-label">提示类型</span><select aria-label="提示类型" value={text(data.tone, 'INFO')} onChange={(event) => update('tone', event.target.value)}><option value="INFO">信息</option><option value="SUCCESS">成功</option><option value="WARNING">警告</option><option value="DANGER">危险</option></select></label><TextAreaField label="提示内容" value={text(data.text, '')} maxLength={20_000} onChange={(value) => update('text', value)} /></div>
  if (cardId === 'toggle') return <div className="simple-card-configuration"><TextField label="折叠标题" value={text(data.title, '')} maxLength={300} onChange={(value) => update('title', value)} /><TextAreaField label="折叠内容" value={text(data.content, '')} maxLength={20_000} onChange={(value) => update('content', value)} /></div>
  if (cardId === 'code') return <div className="simple-card-configuration"><TextField label="代码语言" value={text(data.language, 'text')} maxLength={30} onChange={(value) => update('language', value)} /><TextAreaField label="代码内容" value={text(data.code, '')} maxLength={64_000} monospace onChange={(value) => update('code', value)} /></div>
  if (cardId === 'formula') return <div className="simple-card-configuration"><TextAreaField label="LaTeX 公式" value={text(data.latex, '')} maxLength={20_000} monospace onChange={(value) => update('latex', value)} /><FormulaCardView latex={text(data.latex, '')} compact /></div>
  if (cardId === 'flowchart' || cardId === 'mermaid' || cardId === 'uml') return <DiagramSourceEditor cardId={cardId} source={text(data.source, '')} onChange={(value) => update('source', value)} />
  if (cardId === 'text-diagram') return <div className="simple-card-configuration"><TextAreaField label="图表源码" value={text(data.source, '')} maxLength={64_000} monospace onChange={(value) => update('source', value)} /></div>
  if (cardId === 'mind-map') return <MindMapEditor data={data} onChange={onData} />
  if (cardId === 'table') return <TableConfiguration data={data} onData={onData} />
  if (cardId === 'kanban') return <KanbanConfiguration data={data} onData={onData} />
  if (cardId === 'database') return <EmbeddedDatabaseEditor data={data} onChange={onData} />
  if (cardId === 'whiteboard' || cardId === 'drawio' || cardId === 'excalidraw') return <DrawingCardEditor cardId={cardId} data={data} onChange={onData} />
  return null
}

function KanbanConfiguration({ data, onData }: { data: Record<string, unknown>; onData: (value: Record<string, unknown>) => void }) {
  const columns = normalizeKanbanColumns(data.columns)
  const update = (next: KanbanDraftColumn[]) => onData({ ...data, columns: next })
  const total = columns.reduce((count, column) => count + column.cards.length, 0)
  const moveCard = (columnIndex: number, cardIndex: number, targetColumnIndex: number, targetCardIndex?: number) => {
    const next = structuredClone(columns)
    const [card] = next[columnIndex]!.cards.splice(cardIndex, 1)
    if (!card) return
    const target = next[targetColumnIndex]!.cards
    target.splice(targetCardIndex == null ? target.length : targetCardIndex, 0, card)
    update(next)
  }
  return <div className="kanban-configuration"><header><div><strong>看板列与卡片</strong><small>{columns.length} 列 · {total} 张卡片；最多 20 列、500 张卡片</small></div><button type="button" className="button quiet small" disabled={columns.length >= 20} onClick={() => update([...columns, { id: crypto.randomUUID(), title: `新列 ${columns.length + 1}`, color: '#6f9c7e', cards: [] }])}><Plus />添加列</button></header><div className="kanban-configuration-board">{columns.map((column, columnIndex) => <section key={column.id} style={{ '--kanban-color': column.color } as React.CSSProperties}><header><input aria-label={`看板第 ${columnIndex + 1} 列标题`} value={column.title} maxLength={100} onChange={(event) => update(columns.map((value, target) => target === columnIndex ? { ...value, title: event.target.value } : value))} /><input aria-label={`看板第 ${columnIndex + 1} 列颜色`} type="color" value={column.color} onChange={(event) => update(columns.map((value, target) => target === columnIndex ? { ...value, color: event.target.value } : value))} /><button type="button" className="icon-button" title={`看板第 ${columnIndex + 1} 列左移`} aria-label={`看板第 ${columnIndex + 1} 列左移`} disabled={columnIndex === 0} onClick={() => update(moveItem(columns, columnIndex, columnIndex - 1))}><ArrowLeft /></button><button type="button" className="icon-button" title={`看板第 ${columnIndex + 1} 列右移`} aria-label={`看板第 ${columnIndex + 1} 列右移`} disabled={columnIndex === columns.length - 1} onClick={() => update(moveItem(columns, columnIndex, columnIndex + 1))}><ArrowRight /></button><button type="button" className="icon-button danger" title={`删除看板第 ${columnIndex + 1} 列`} aria-label={`删除看板第 ${columnIndex + 1} 列`} disabled={columns.length <= 1} onClick={() => update(columns.filter((_, target) => target !== columnIndex))}><Trash2 /></button></header>{column.cards.map((card, cardIndex) => <article key={card.id}><input aria-label={`看板第 ${columnIndex + 1} 列卡片 ${cardIndex + 1} 标题`} value={card.title} maxLength={300} onChange={(event) => update(columns.map((value, target) => target === columnIndex ? { ...value, cards: value.cards.map((item, cardTarget) => cardTarget === cardIndex ? { ...item, title: event.target.value } : item) } : value))} /><textarea aria-label={`看板第 ${columnIndex + 1} 列卡片 ${cardIndex + 1} 描述`} value={card.description} maxLength={2000} rows={2} onChange={(event) => update(columns.map((value, target) => target === columnIndex ? { ...value, cards: value.cards.map((item, cardTarget) => cardTarget === cardIndex ? { ...item, description: event.target.value } : item) } : value))} /><footer><button type="button" title="卡片上移" disabled={cardIndex === 0} onClick={() => moveCard(columnIndex, cardIndex, columnIndex, cardIndex - 1)}><ArrowUp /></button><button type="button" title="卡片下移" disabled={cardIndex === column.cards.length - 1} onClick={() => moveCard(columnIndex, cardIndex, columnIndex, cardIndex + 1)}><ArrowDown /></button><button type="button" title="卡片移到左列" disabled={columnIndex === 0} onClick={() => moveCard(columnIndex, cardIndex, columnIndex - 1)}><ArrowLeft /></button><button type="button" title="卡片移到右列" disabled={columnIndex === columns.length - 1} onClick={() => moveCard(columnIndex, cardIndex, columnIndex + 1)}><ArrowRight /></button><button type="button" className="danger" title="删除卡片" onClick={() => update(columns.map((value, target) => target === columnIndex ? { ...value, cards: value.cards.filter((_, cardTarget) => cardTarget !== cardIndex) } : value))}><Trash2 /></button></footer></article>)}<button type="button" className="kanban-add-card" disabled={total >= 500 || column.cards.length >= 200} onClick={() => update(columns.map((value, target) => target === columnIndex ? { ...value, cards: [...value.cards, { id: crypto.randomUUID(), title: `新卡片 ${value.cards.length + 1}`, description: '' }] } : value))}><Plus />添加卡片</button></section>)}</div></div>
}

function TableConfiguration({ data, onData }: { data: Record<string, unknown>; onData: (value: Record<string, unknown>) => void }) {
  const rows = normalizeTableRows(data.rows)
  const update = (next: string[][]) => onData({ ...data, rows: next })
  const width = rows[0]?.length ?? 1
  return <div className="table-configuration"><header><div><strong>表格内容</strong><small>{rows.length} 行 × {width} 列；首行导出为表头</small></div><div><button type="button" className="icon-button" title="添加一行" aria-label="添加表格行" disabled={rows.length >= 200} onClick={() => update([...rows, Array.from({ length: width }, () => '')])}><Plus /></button><button type="button" className="icon-button" title="删除末行" aria-label="删除表格末行" disabled={rows.length <= 1} onClick={() => update(rows.slice(0, -1))}><Minus /></button><button type="button" className="icon-button" title="添加一列" aria-label="添加表格列" disabled={width >= 20} onClick={() => update(rows.map((row) => [...row, '']))}><Columns3 /></button><button type="button" className="icon-button" title="删除末列" aria-label="删除表格末列" disabled={width <= 1} onClick={() => update(rows.map((row) => row.slice(0, -1)))}><Minus /></button></div></header><div className="table-configuration-grid" style={{ gridTemplateColumns: `repeat(${width}, minmax(110px, 1fr))` }}>{rows.flatMap((row, rowIndex) => row.map((cell, columnIndex) => <input key={`${rowIndex}-${columnIndex}`} aria-label={`表格第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`} value={cell} maxLength={2_000} onChange={(event) => update(rows.map((targetRow, targetRowIndex) => targetRow.map((value, targetColumnIndex) => targetRowIndex === rowIndex && targetColumnIndex === columnIndex ? event.target.value : value)))} />))}</div></div>
}

function TextField({ label, value, maxLength, onChange }: { label: string; value: string; maxLength: number; onChange: (value: string) => void }) {
  return <label className="field"><span className="field-label">{label}</span><input aria-label={label} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /></label>
}

function TextAreaField({ label, value, maxLength, monospace = false, onChange }: { label: string; value: string; maxLength: number; monospace?: boolean; onChange: (value: string) => void }) {
  return <label className="field"><span className="field-label">{label}</span><textarea className={monospace ? 'monospace-input' : ''} aria-label={label} rows={7} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /></label>
}

export function DocumentCardPreview({ pageId, body }: { pageId: string; body: string }) {
  const definitions = useQuery({
    queryKey: ['content-cards', 'definitions', pageId],
    queryFn: () => post<ContentCardDefinition[]>('/api/v1/content-cards/definitions', { pageId }),
  })
  const cards = useMemo(() => parseContentCardTokens(body), [body])
  const byId = useMemo(() => new Map((definitions.data ?? []).map((definition) => [definition.id, definition])), [definitions.data])
  if (!cards.length) return null
  return <section className="document-card-preview" aria-label="文稿卡片预览"><header><span>卡片预览</span><small>{cards.length} 个卡片 · 保存后可互动</small></header>{cards.map((card) => <ContentCardRenderer key={`${card.instanceId}-${card.start}`} pageId={pageId} card={card} definition={byId.get(card.cardId)} />)}</section>
}

function ContentCardRenderer({ pageId, card, definition }: { pageId: string; card: ParsedContentCard; definition?: ContentCardDefinition }) {
  if (!definition || card.version > definition.version || !card.supportedEncoding || !card.data) {
    return <article className="content-card unknown"><FileQuestion size={21} /><div><strong>无法显示的卡片</strong><p>{card.cardId} · schema v{card.version}。内容已原样保留，可在安装兼容版本后恢复。</p></div></article>
  }
  const data = card.data
  if (card.cardId === 'poll') return <PollCard instanceId={card.instanceId} question={text(data.question, '投票')} multiple={data.multiple === true} />
  if (card.cardId === 'checkin') return <CheckinCard instanceId={card.instanceId} title={text(data.title, '每日打卡')} />
  if (card.cardId === 'status') return <article className={`content-card status-card status-${text(data.value, 'TODO').toLowerCase()}`}><CircleDot size={20} /><div><small>状态</small><strong>{text(data.label, statusLabel(text(data.value, 'TODO')))}</strong></div></article>
  if (card.cardId === 'mention') return <span className="content-card mention-content-card"><AtSign /><strong>{text(data.label, '成员')}</strong></span>
  if (card.cardId === 'divider') return <div className="content-card-divider" role="separator" />
  if (card.cardId === 'quote') return <blockquote className="content-card quote-card"><p>{text(data.text, '引用内容')}</p><cite>{text(data.source, '')}</cite></blockquote>
  if (card.cardId === 'callout') return <aside className="content-card callout-card"><strong>{text(data.tone, 'INFO')}</strong><p>{text(data.text, '提示内容')}</p></aside>
  if (card.cardId === 'toggle') return <details className="content-card toggle-card"><summary>{text(data.title, '折叠标题')}</summary><p>{text(data.content, '')}</p></details>
  if (card.cardId === 'code' || card.cardId === 'text-diagram') return <article className="content-card code-card"><header><Code2 size={15} />{text(data.language, card.cardId)}</header><pre>{text(data.code ?? data.source, '')}</pre></article>
  if (card.cardId === 'flowchart' || card.cardId === 'mermaid' || card.cardId === 'uml') return <TechnicalDiagramCard cardId={card.cardId} source={text(data.source, '')} />
  if (card.cardId === 'formula') return <FormulaCardView latex={text(data.latex, '')} />
  if (card.cardId === 'mind-map') return <MindMapCardView data={data} />
  if (card.cardId === 'table') return <TableCard data={data} />
  if (card.cardId === 'gallery') return <GalleryCard data={data} />
  if (card.cardId === 'kanban') return <KanbanCard data={data} />
  if (card.cardId === 'database') return <DatabaseCardView data={data} />
  if (card.cardId === 'whiteboard' || card.cardId === 'drawio' || card.cardId === 'excalidraw') return <DrawingCardView cardId={card.cardId} data={data} />
  if (card.cardId === 'columns') return <ColumnsCard data={data} />
  if (card.cardId === 'image') { const url = safeMediaUrl(data.url); return <article className={`content-card media-card ${imageWidthClassName(data.width)}`}>{url ? <img src={url} alt={text(data.alt, '')} /> : <MediaPlaceholder title="图片待配置" />}</article> }
  if (card.cardId === 'audio') { const url = safeMediaUrl(data.url); return <article className="content-card media-card"><strong>{text(data.title, '音频')}</strong>{url ? <audio controls src={url} /> : <MediaPlaceholder title="音频待上传" />}</article> }
  if (card.cardId === 'video') { const url = safeMediaUrl(data.url); return <article className="content-card media-card"><strong>{text(data.title, '视频')}</strong>{url ? <video controls src={url} /> : <MediaPlaceholder title="视频待上传" />}</article> }
  if (['attachment', 'file-preview', 'office'].includes(card.cardId)) { const url = safeMediaUrl(data.url); return <article className="content-card file-content-card"><span><Paperclip /></span><div><small>{card.cardId === 'office' ? 'Office 文档' : card.cardId === 'file-preview' ? '文件预览' : '附件'}</small><strong>{text(data.name, '未命名文件')}</strong><p>{data.sizeBytes ? formatBytes(Number(data.sizeBytes)) : text(data.mediaType, '')}</p></div>{url ? <a className="button secondary small" href={downloadUrl(url)}><Download />下载</a> : <MediaPlaceholder title="文件待上传" />}</article> }
  if (card.cardId === 'pdf') { const url = safeMediaUrl(data.url); const previewUrl = url?.startsWith('/') ? url : null; return <article className="content-card pdf-content-card"><header><FileText /><strong>{text(data.name, 'PDF 文档')}</strong>{url && <a href={downloadUrl(url)}><Download />下载</a>}</header>{previewUrl ? <iframe src={previewUrl} title={text(data.name, 'PDF 文档')} sandbox="" referrerPolicy="no-referrer" loading="lazy" /> : <MediaPlaceholder title={url ? '外部 PDF 请通过下载链接查看' : 'PDF 待上传'} />}</article> }
  if (providerCards.has(card.cardId)) return <ProviderCard cardId={card.cardId} title={definition.title} url={data.url} />
  if (card.cardId === 'sensitive-text') return <SensitiveTextCard data={data} />
  if (card.cardId === 'calendar') return <CalendarCard data={data} />
  return <article className="content-card generic-card"><span className={`card-icon category-${definition.category}`}>{cardGlyph(definition.category)}</span><div><small>{definition.category}</small><strong>{definition.title}</strong><p>实例 {card.instanceId.slice(0, 8)} · schema v{card.version}</p></div>{definition.fullScreen && <LayoutGrid size={17} />}</article>
}

function PollCard({ instanceId, question, multiple }: { instanceId: string; question: string; multiple: boolean }) {
  const queryClient = useQueryClient()
  const state = useQuery({ queryKey: ['content-card', 'poll', instanceId], queryFn: () => post<PollState>('/api/v1/content-cards/poll/state', { instanceId }), retry: false })
  const vote = useMutation({ mutationFn: (optionId: string) => {
    const prior = state.data?.selectedOptionIds ?? []
    const optionIds = multiple ? (prior.includes(optionId) ? prior.filter((id) => id !== optionId) : [...prior, optionId]) : [optionId]
    return post<PollState>('/api/v1/content-cards/poll/vote', { instanceId, optionIds })
  }, onSuccess: (value) => queryClient.setQueryData(['content-card', 'poll', instanceId], value) })
  return <article className="content-card poll-card"><header><Vote size={19} /><div><small>投票 · {multiple ? '多选' : '单选'}</small><strong>{question}</strong></div></header>{state.data ? <div className="poll-options">{state.data.options.map((option) => { const selected = state.data?.selectedOptionIds.includes(option.id); const percent = state.data.totalVoters ? Math.round(option.votes / state.data.totalVoters * 100) : 0; return <button key={option.id} className={selected ? 'selected' : ''} disabled={state.data.closed || vote.isPending} onClick={() => vote.mutate(option.id)}><i style={{ width: `${percent}%` }} /><span>{selected && <Check size={13} />}{option.label}</span><small>{option.votes} · {percent}%</small></button>})}<footer>{state.data.totalVoters} 人参与{state.data.closed && ' · 已结束'}</footer></div> : <p className="card-pending">保存页面后即可参与投票。</p>}{vote.error && <div className="inline-error">{messageOf(vote.error)}</div>}</article>
}

function CheckinCard({ instanceId, title }: { instanceId: string; title: string }) {
  const queryClient = useQueryClient()
  const state = useQuery({ queryKey: ['content-card', 'checkin', instanceId], queryFn: () => post<CheckinState>('/api/v1/content-cards/checkin/state', { instanceId }), retry: false })
  const checkin = useMutation({ mutationFn: () => post<CheckinState>('/api/v1/content-cards/checkin', { instanceId }), onSuccess: (value) => queryClient.setQueryData(['content-card', 'checkin', instanceId], value) })
  return <article className="content-card checkin-card"><CalendarCheck size={22} /><div><small>打卡</small><strong>{title}</strong><p>{state.data ? `${state.data.todayCount} 人今天已打卡 · 共 ${state.data.totalParticipants} 人参与` : '保存页面后即可打卡'}</p></div><button className={`button small ${state.data?.checkedIn ? 'secondary' : 'primary'}`} disabled={!state.data || state.data.checkedIn || checkin.isPending} onClick={() => checkin.mutate()}>{state.data?.checkedIn ? '今日已打卡' : '立即打卡'}</button></article>
}

function TableCard({ data }: { data: Record<string, unknown> }) {
  const rows = Array.isArray(data.rows) ? data.rows.filter(Array.isArray).slice(0, 20) as unknown[][] : []
  return <div className="content-card table-card"><table><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.slice(0, 12).map((cell, cellIndex) => <td key={cellIndex}>{text(cell, '')}</td>)}</tr>)}</tbody></table></div>
}

function GalleryCard({ data }: { data: Record<string, unknown> }) {
  const items = Array.isArray(data.items) ? data.items.map(asObject).filter(Boolean).slice(0, 100) : []
  return <article className="content-card gallery-content-card">{items.map((item, index) => { const url = safeMediaUrl(item?.url); return <figure key={text(item?.id ?? item?.attachmentId, String(index))}>{url ? <img src={url} alt={text(item?.alt, '')} loading="lazy" /> : <MediaPlaceholder title="图片不可用" />}{text(item?.alt, '') && <figcaption>{text(item?.alt, '')}</figcaption>}</figure> })}</article>
}

function KanbanCard({ data }: { data: Record<string, unknown> }) {
  const columns = normalizeKanbanColumns(data.columns)
  return <article className="content-card kanban-content-card">{columns.map((column) => <section key={column.id} style={{ '--kanban-color': column.color } as React.CSSProperties}><header><i /><strong>{column.title}</strong><span>{column.cards.length}</span></header>{column.cards.map((card) => <div key={card.id}><strong>{card.title}</strong>{card.description && <p>{card.description}</p>}</div>)}{!column.cards.length && <small>暂无卡片</small>}</section>)}</article>
}

function ColumnsCard({ data }: { data: Record<string, unknown> }) {
  const columns = Array.isArray(data.columns) ? data.columns.map(asObject).filter(Boolean).slice(0, 4) : []
  const ratios = Array.isArray(data.ratios) && data.ratios.length === columns.length
    ? data.ratios.map((value) => typeof value === 'number' && value > 0 ? value : 1)
    : columns.map(() => 1)
  return <article className="content-card columns-content-card" style={{ gridTemplateColumns: ratios.map((ratio) => `${ratio}fr`).join(' ') }}>{columns.map((column, index) => <section key={index}><small>第 {index + 1} 栏</small><div>{text(column?.content, '').split(/\r?\n/).map((line, lineIndex) => line ? <p key={lineIndex}>{line}</p> : <br key={lineIndex} />)}</div></section>)}</article>
}

function ProviderCard({ cardId, title, url: rawUrl }: { cardId: string; title: string; url: unknown }) {
  const url = allowedProviderUrl(cardId, rawUrl)
  return <article className="content-card provider-card"><header><strong>{title}</strong>{url && <a href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开来源</a>}</header>{url ? <iframe src={url} title={title} sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="no-referrer" loading="lazy" /> : <MediaPlaceholder title="嵌入地址无效或不在白名单" />}</article>
}

function CalendarCard({ data }: { data: Record<string, unknown> }) {
  const events = Array.isArray(data.events) ? data.events.slice(0, 20) as Record<string, unknown>[] : []
  return <article className="content-card calendar-card"><header><CalendarCheck size={18} /><strong>日历</strong><small>{text(data.timezone, 'Asia/Shanghai')}</small></header>{events.length ? events.map((event, index) => <div key={text(event.id, String(index))}><time>{formatCalendarDate(event.start)}</time><span>{text(event.title, '未命名日程')}</span>{Boolean(event.end) && <small>至 {formatCalendarDate(event.end)}</small>}</div>) : <p>还没有日程</p>}</article>
}

function MediaPlaceholder({ title }: { title: string }) { return <div className="media-placeholder"><Palette size={22} /><span>{title}</span></div> }

function mediaGlyph(cardId: string) {
  if (cardId === 'image') return <Image />
  if (cardId === 'audio') return <Music />
  if (cardId === 'video') return <Video />
  if (cardId === 'pdf') return <FileText />
  if (['attachment', 'file-preview', 'office'].includes(cardId)) return <Paperclip />
  return <UploadCloud />
}

function mediaAccept(cardId: string) {
  if (cardId === 'image') return 'image/*'
  if (cardId === 'audio') return 'audio/*'
  if (cardId === 'video') return 'video/*'
  if (cardId === 'pdf') return 'application/pdf'
  if (cardId === 'office') return '.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp'
  return undefined
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
function formatCalendarDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function downloadUrl(url: string) { return url.startsWith('/api/v1/attachments/') ? `${url}?download=true` : url }

function cardGlyph(category: string) {
  if (category === '协作') return <Vote size={16} />
  if (category === '安全') return <LockKeyhole size={16} />
  if (category === '技术') return <Code2 size={16} />
  if (category === '基础') return <CircleDot size={16} />
  return <LayoutGrid size={16} />
}

function statusLabel(value: string) { return ({ TODO: '待处理', IN_PROGRESS: '进行中', BLOCKED: '受阻', DONE: '已完成', CANCELLED: '已取消' } as Record<string, string>)[value] ?? value }
function text(value: unknown, fallback: string) { return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback }
function asObject(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function moveItem<T>(items: T[], from: number, to: number) { const next = [...items]; const [item] = next.splice(from, 1); if (item !== undefined) next.splice(to, 0, item); return next }
function normalizeTableRows(value: unknown): string[][] {
  if (!Array.isArray(value) || !value.length) return [['']]
  const width = Array.isArray(value[0]) ? Math.max(1, Math.min(value[0].length, 20)) : 1
  return value.slice(0, 200).map((row) => Array.from({ length: width }, (_, index) => Array.isArray(row) ? text(row[index], '') : ''))
}
function normalizeKanbanColumns(value: unknown): KanbanDraftColumn[] {
  if (!Array.isArray(value) || !value.length) return [{ id: 'todo', title: '待处理', color: '#6f9c7e', cards: [] }]
  return value.slice(0, 20).map((rawColumn, columnIndex) => {
    const column = asObject(rawColumn)
    const rawCards = Array.isArray(column?.cards) ? column.cards : []
    return {
      id: text(column?.id, `column-${columnIndex + 1}`),
      title: text(column?.title, ''),
      color: /^#[0-9a-fA-F]{6}$/.test(text(column?.color, '')) ? text(column?.color, '') : '#6f9c7e',
      cards: rawCards.slice(0, 200).map((rawCard, cardIndex) => { const card = asObject(rawCard); return { id: text(card?.id, `card-${columnIndex + 1}-${cardIndex + 1}`), title: text(card?.title, ''), description: text(card?.description, '') } }),
    }
  })
}
function validSimpleCard(cardId: string, data: Record<string, unknown>) {
  if (!simpleConfigCards.has(cardId)) return true
  if (cardId === 'quote') return Boolean(text(data.text, '').trim())
  if (cardId === 'callout') return ['INFO', 'SUCCESS', 'WARNING', 'DANGER'].includes(text(data.tone, '')) && Boolean(text(data.text, '').trim())
  if (cardId === 'toggle') return Boolean(text(data.title, '').trim())
  if (cardId === 'code') return /^[A-Za-z0-9_+.-]{1,30}$/.test(text(data.language, ''))
  if (cardId === 'formula') return Boolean(text(data.latex, '').trim())
  if (['flowchart', 'mermaid', 'uml', 'text-diagram'].includes(cardId)) return Boolean(text(data.source, '').trim())
  if (cardId === 'mind-map') return Boolean(text(data.root, '').trim())
  if (cardId === 'table') { const rows = normalizeTableRows(data.rows); return rows.length >= 1 && rows.length <= 200 && (rows[0]?.length ?? 0) >= 1 && (rows[0]?.length ?? 0) <= 20 }
  if (cardId === 'kanban') { const columns = normalizeKanbanColumns(data.columns); const ids = columns.flatMap((column) => [column.id, ...column.cards.map((card) => card.id)]); return columns.length >= 1 && columns.length <= 20 && columns.every((column) => Boolean(column.title.trim()) && column.cards.length <= 200 && column.cards.every((card) => Boolean(card.title.trim()))) && columns.reduce((count, column) => count + column.cards.length, 0) <= 500 && new Set(ids).size === ids.length }
  if (cardId === 'database') return validDatabaseCard(data)
  if (cardId === 'whiteboard' || cardId === 'excalidraw') return validDrawingCard(cardId, data)
  if (cardId === 'drawio') return validDrawioCard(data)
  return true
}

function validDrawingCard(cardId: 'whiteboard' | 'excalidraw', data: Record<string, unknown>) {
  if (data.type !== cardId || !Array.isArray(data.elements) || data.elements.length > 500) return false
  return data.elements.every((value) => { const element = asObject(value); return Boolean(element && text(element.id, '') && ['RECT', 'ELLIPSE', 'DIAMOND', 'STICKY', 'TEXT', 'ARROW', 'FREEDRAW'].includes(text(element.kind, ''))) })
}
function validDrawioCard(data: Record<string, unknown>) {
  return data.type === 'drawio' && typeof data.xml === 'string' && data.xml.length > 0 && data.xml.length <= 250_000 && Array.isArray(data.nodes) && data.nodes.length <= 500 && Array.isArray(data.edges) && data.edges.length <= 1_000
}
function validDatabaseCard(data: Record<string, unknown>) {
  if (data.type !== 'database' || !['TABLE', 'KANBAN', 'GALLERY', 'CALENDAR'].includes(text(data.view, ''))) return false
  if (!Array.isArray(data.fields) || data.fields.length < 1 || data.fields.length > 50 || !Array.isArray(data.rows) || data.rows.length > 1_000) return false
  const fieldIds = data.fields.map(asObject).filter(Boolean).map((field) => text(field?.id, ''))
  return fieldIds.length === data.fields.length && fieldIds.every(Boolean) && new Set(fieldIds).size === fieldIds.length
}
function toLocalDateTime(value: unknown) {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
function nextLocalHour() {
  const date = new Date()
  date.setMinutes(0, 0, 0)
  date.setHours(date.getHours() + 1)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function TimezoneField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span className="field-label">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="Asia/Shanghai">Asia/Shanghai</option><option value="Asia/Hong_Kong">Asia/Hong_Kong</option><option value="Asia/Tokyo">Asia/Tokyo</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New_York</option><option value="UTC">UTC</option></select></label>
}
