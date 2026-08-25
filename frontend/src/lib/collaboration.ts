import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { post } from './api'

const UPDATE_FRAME = 0
const AWARENESS_FRAME = 1
const SNAPSHOT_FRAME = 2
const ACK_FRAME = 3
const REMOTE_ORIGIN = Symbol('collaboration-remote')
const RECONNECT_DELAYS = [500, 1_000, 2_000, 5_000, 10_000]

interface CollaborationTicket {
  ticket: string
  websocketPath: string
  expiresAt: string
}

interface PresencePayload {
  sessionId: string
  userId: string
  email: string
  color: string
  selection?: { start: number; end: number }
  sentAt: number
}

export interface CollaboratorPresence extends PresencePayload {
  lastSeen: number
}

export type CollaborationStatus = 'connecting' | 'syncing' | 'connected' | 'reconnecting' | 'unavailable'

interface CollaborationOptions {
  pageId: string
  initialBody: string
  enabled: boolean
  userId: string
  email: string
}

export function usePageCollaboration({ pageId, initialBody, enabled, userId, email }: CollaborationOptions) {
  const [body, setBodyState] = useState(initialBody)
  const [status, setStatus] = useState<CollaborationStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [peers, setPeers] = useState<CollaboratorPresence[]>([])
  const [lastAcknowledgedSequence, setLastAcknowledgedSequence] = useState<string | null>(null)
  const sharedTextRef = useRef<Y.Text | null>(null)
  const initializedRef = useRef(false)
  const desiredBodyRef = useRef(initialBody)
  const editedBeforeInitializationRef = useRef(false)
  const presenceSenderRef = useRef<(selection?: { start: number; end: number }) => void>(() => undefined)

  useEffect(() => {
    if (!enabled || !pageId) return
    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let attempt = 0
    let connectionReady = false
    let sessionId: string = crypto.randomUUID()
    let currentSelection: { start: number; end: number } | undefined
    const pendingUpdates: Uint8Array[] = []
    const inFlightUpdates: Uint8Array[] = []
    const peerMap = new Map<string, CollaboratorPresence>()
    const doc = new Y.Doc()
    const sharedText = doc.getText('content')
    sharedTextRef.current = sharedText
    initializedRef.current = false
    editedBeforeInitializationRef.current = false
    desiredBodyRef.current = initialBody
    setBodyState(initialBody)
    setError(null)

    const refreshPeers = () => {
      const now = Date.now()
      for (const [id, peer] of peerMap) {
        if (now - peer.lastSeen > 45_000) peerMap.delete(id)
      }
      setPeers([...peerMap.values()].sort((left, right) => left.email.localeCompare(right.email)))
    }

    const sendUpdate = (update: Uint8Array) => {
      if (!socket || socket.readyState !== WebSocket.OPEN || !connectionReady) {
        pendingUpdates.push(update)
        return
      }
      try {
        socket.send(toArrayBuffer(encodeFrame(UPDATE_FRAME, update)))
        inFlightUpdates.push(update)
      } catch {
        pendingUpdates.push(update)
      }
    }

    const flushUpdates = () => {
      while (pendingUpdates.length && socket?.readyState === WebSocket.OPEN && connectionReady) {
        const update = pendingUpdates.shift()
        if (update) sendUpdate(update)
      }
    }

    const sendPresence = (selection = currentSelection) => {
      currentSelection = selection
      if (!socket || socket.readyState !== WebSocket.OPEN || !connectionReady) return
      const payload: PresencePayload = {
        sessionId,
        userId,
        email,
        color: presenceColor(userId),
        ...(selection ? { selection } : {}),
        sentAt: Date.now(),
      }
      socket.send(toArrayBuffer(encodeFrame(AWARENESS_FRAME, new TextEncoder().encode(JSON.stringify(payload)))))
    }
    presenceSenderRef.current = sendPresence

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      const nextBody = sharedText.toString()
      if (initializedRef.current || origin !== REMOTE_ORIGIN) {
        desiredBodyRef.current = nextBody
        setBodyState(nextBody)
      }
      if (origin !== REMOTE_ORIGIN) sendUpdate(update)
    }
    doc.on('update', updateHandler)

    const scheduleReconnect = () => {
      if (stopped) return
      connectionReady = false
      while (inFlightUpdates.length) {
        const update = inFlightUpdates.pop()
        if (update) pendingUpdates.unshift(update)
      }
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      setStatus('reconnecting')
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]
      attempt += 1
      reconnectTimer = setTimeout(connect, delay)
    }

    const handleSnapshot = (payload: Uint8Array) => {
      Y.applyUpdate(doc, payload, REMOTE_ORIGIN)
      connectionReady = true
      if (!initializedRef.current) {
        const remoteIsUninitialized = Y.encodeStateVector(doc).length === 1
        if (editedBeforeInitializationRef.current || (remoteIsUninitialized && desiredBodyRef.current.length > 0)) {
          replaceSharedText(doc, sharedText, desiredBodyRef.current)
        } else {
          desiredBodyRef.current = sharedText.toString()
          setBodyState(sharedText.toString())
        }
        initializedRef.current = true
      }
      flushUpdates()
      sendPresence()
      attempt = 0
      setStatus('connected')
      heartbeatTimer = setInterval(() => {
        sendPresence()
        refreshPeers()
      }, 15_000)
    }

    const handleAwareness = (payload: Uint8Array) => {
      try {
        const value = JSON.parse(new TextDecoder().decode(payload)) as PresencePayload
        if (!value.sessionId || value.sessionId === sessionId || !value.userId || !value.email) return
        peerMap.set(value.sessionId, { ...value, lastSeen: Date.now() })
        refreshPeers()
      } catch {
        // Ignore awareness frames from incompatible clients; document updates remain unaffected.
      }
    }

    async function connect() {
      if (stopped) return
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      try {
        const issued = await post<CollaborationTicket>('/api/v1/collaboration/ticket', { pageId })
        if (stopped) return
        sessionId = ticketSessionId(issued.ticket) ?? crypto.randomUUID()
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const nextSocket = new WebSocket(`${protocol}//${window.location.host}${issued.websocketPath}?ticket=${encodeURIComponent(issued.ticket)}`)
        nextSocket.binaryType = 'arraybuffer'
        socket = nextSocket
        connectionReady = false
        nextSocket.onopen = () => { if (!stopped) setStatus('syncing') }
        nextSocket.onmessage = (event) => {
          if (stopped || !(event.data instanceof ArrayBuffer)) return
          const frame = new Uint8Array(event.data)
          if (frame.length < 2) return
          const kind = frame[0]
          const payload = frame.subarray(1)
          try {
            if (kind === SNAPSHOT_FRAME) handleSnapshot(payload)
            else if (kind === UPDATE_FRAME) Y.applyUpdate(doc, payload, REMOTE_ORIGIN)
            else if (kind === AWARENESS_FRAME) handleAwareness(payload)
            else if (kind === ACK_FRAME && payload.length === 8) {
              inFlightUpdates.shift()
              setLastAcknowledgedSequence(new DataView(payload.buffer, payload.byteOffset, 8).getBigUint64(0).toString())
            }
          } catch {
            setError('实时协作数据无法解析，正在重新连接')
            nextSocket.close()
          }
        }
        nextSocket.onerror = () => nextSocket.close()
        nextSocket.onclose = scheduleReconnect
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '实时协作暂不可用'
        setError(message)
        setStatus('unavailable')
      }
    }

    void connect()
    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      if (socket) {
        socket.onclose = null
        socket.close()
      }
      doc.off('update', updateHandler)
      doc.destroy()
      sharedTextRef.current = null
      initializedRef.current = false
      presenceSenderRef.current = () => undefined
    }
  }, [enabled, pageId, userId, email])

  const setBody = useCallback((nextBody: string) => {
    desiredBodyRef.current = nextBody
    setBodyState(nextBody)
    const sharedText = sharedTextRef.current
    if (!sharedText || !initializedRef.current) {
      editedBeforeInitializationRef.current = true
      return
    }
    replaceSharedText(sharedText.doc ?? null, sharedText, nextBody)
  }, [])

  const broadcastSelection = useCallback((start: number, end: number) => {
    presenceSenderRef.current({ start, end })
  }, [])

  return { body, setBody, status, error, peers, lastAcknowledgedSequence, broadcastSelection }
}

export function replaceSharedText(doc: Y.Doc | null, text: Y.Text, nextValue: string): void {
  if (!doc) return
  const currentValue = text.toString()
  if (currentValue === nextValue) return
  let prefix = 0
  const maximumPrefix = Math.min(currentValue.length, nextValue.length)
  while (prefix < maximumPrefix && currentValue[prefix] === nextValue[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < currentValue.length - prefix
    && suffix < nextValue.length - prefix
    && currentValue[currentValue.length - suffix - 1] === nextValue[nextValue.length - suffix - 1]
  ) suffix += 1
  doc.transact(() => {
    const deleteLength = currentValue.length - prefix - suffix
    if (deleteLength > 0) text.delete(prefix, deleteLength)
    const insertion = nextValue.slice(prefix, nextValue.length - suffix)
    if (insertion) text.insert(prefix, insertion)
  })
}

export function encodeFrame(kind: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(payload.length + 1)
  frame[0] = kind
  frame.set(payload, 1)
  return frame
}

function ticketSessionId(ticket: string): string | null {
  try {
    const [payload] = ticket.split('.', 1)
    if (!payload) return null
    const encoded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { session_id?: string }
    return claims.session_id ?? null
  } catch {
    return null
  }
}

function presenceColor(value: string): string {
  const colors = ['#397a55', '#4f6fa8', '#8a5ca0', '#a06448', '#337c83', '#9b6f2f']
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  return colors[Math.abs(hash) % colors.length] ?? colors[0]!
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.length)
  copy.set(value)
  return copy.buffer
}
