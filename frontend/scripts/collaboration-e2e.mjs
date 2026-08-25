import * as Y from 'yjs'

const UPDATE_FRAME = 0
const SNAPSHOT_FRAME = 2
const ACK_FRAME = 3
const mode = process.env.MODE
const expected = process.env.EXPECTED_TEXT

if (!mode || !expected || !process.env.WS_BASE || !process.env.PAGE_ID || !process.env.TICKET_ONE) {
  throw new Error('MODE, EXPECTED_TEXT, WS_BASE, PAGE_ID, and TICKET_ONE are required')
}

const socketUrl = (ticket) => `${process.env.WS_BASE}/api/v1/collaboration/${process.env.PAGE_ID}?ticket=${encodeURIComponent(ticket)}`

function frame(kind, payload) {
  const value = new Uint8Array(payload.length + 1)
  value[0] = kind
  value.set(payload, 1)
  return value
}

function connect(ticket) {
  const doc = new Y.Doc()
  const socket = new WebSocket(socketUrl(ticket))
  socket.binaryType = 'arraybuffer'
  let snapshotResolve
  let updateResolve
  let acknowledgementResolve
  const snapshot = new Promise((resolve) => { snapshotResolve = resolve })
  const update = new Promise((resolve) => { updateResolve = resolve })
  const acknowledgement = new Promise((resolve) => { acknowledgementResolve = resolve })
  socket.addEventListener('message', (event) => {
    const value = new Uint8Array(event.data)
    const kind = value[0]
    const payload = value.subarray(1)
    if (kind === SNAPSHOT_FRAME) {
      Y.applyUpdate(doc, payload)
      snapshotResolve()
    } else if (kind === UPDATE_FRAME) {
      Y.applyUpdate(doc, payload)
      updateResolve()
    } else if (kind === ACK_FRAME) {
      acknowledgementResolve()
    }
  })
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true })
  })
  return { doc, socket, opened, snapshot, update, acknowledgement }
}

function timeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 10_000)),
  ])
}

if (mode === 'broadcast') {
  if (!process.env.TICKET_TWO) throw new Error('TICKET_TWO is required in broadcast mode')
  const first = connect(process.env.TICKET_ONE)
  const second = connect(process.env.TICKET_TWO)
  await timeout(Promise.all([first.opened, second.opened, first.snapshot, second.snapshot]), 'initial snapshots')
  const source = new Y.Doc()
  source.getText('content').insert(0, expected)
  first.socket.send(frame(UPDATE_FRAME, Y.encodeStateAsUpdate(source)))
  await timeout(Promise.all([first.acknowledgement, second.update]), 'acknowledgement and peer update')
  if (second.doc.getText('content').toString() !== expected) throw new Error('Peer did not receive the expected Yjs text')
  first.socket.close()
  second.socket.close()
  console.log('COLLABORATION_BROADCAST_SUCCESS')
} else if (mode === 'recover') {
  const recovered = connect(process.env.TICKET_ONE)
  await timeout(Promise.all([recovered.opened, recovered.snapshot]), 'recovery snapshot')
  if (recovered.doc.getText('content').toString() !== expected) throw new Error('Recovered snapshot did not contain the expected Yjs text')
  recovered.socket.close()
  console.log('COLLABORATION_RECOVERY_SUCCESS')
} else if (mode === 'rejected') {
  const socket = new WebSocket(socketUrl(process.env.TICKET_ONE))
  let opened = false
  const rejected = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      opened = true
      socket.close()
      reject(new Error('Revoked collaboration ticket unexpectedly connected'))
    }, { once: true })
    socket.addEventListener('error', resolve, { once: true })
    socket.addEventListener('close', () => {
      if (!opened) resolve()
    }, { once: true })
  })
  await timeout(rejected, 'ticket rejection')
  console.log('COLLABORATION_REVOCATION_SUCCESS')
} else {
  throw new Error(`Unsupported MODE: ${mode}`)
}
