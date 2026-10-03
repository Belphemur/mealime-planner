/**
 * Mealime Planner — live room relay, self-host adapter.
 *
 * Every DECISION lives in `./relay-core` (ADR-0040); this file is the Bun
 * half of the seam and does three things only:
 *
 * 1. reads the configuration the core deliberately does not know about
 *    (`process.env`, which workerd does not have);
 * 2. implements the core's storage INTENTS over two Maps;
 * 3. maps WebSocket events onto core verdicts and back onto the wire.
 *
 * Zero dependencies: Bun's native WebSocket support (`Bun.serve`), no
 * database, no persistence, and — as before this refactor — no build step
 * (Bun runs the TypeScript directly).
 *
 * Rooms are keyed by canonical code and hold whole-state snapshots;
 * conflict resolution belongs to the client, via a monotonic `rev` the
 * relay only stores and fans out (ADR-0006).
 *
 * Run: `bun server/relay.ts` (listens on :8081, override with PORT env).
 */

import { createRoomRegistry, type FloorRecord, type RoomRecord, type RoomRegistry, type RoomStore } from './relay-core/lifecycle'
import { canonicalizeCode, mintLegacyCode, WORD_CODE_RE } from './relay-core/codes'
import { IDLE_TTL_MS as IDLE_TTL_DEFAULT_MS, INACTIVITY_TTL_MS as INACTIVITY_TTL_DEFAULT_MS, RELAY_SERVICE } from './relay-core/policy'
import { RELAY_ERRORS, type RelayMessage } from './relay-core/protocol'
import { makeThrottle, MemoryAttemptBuckets } from './relay-core/throttle'

/* ------------------------------------------------------------------ config */

/**
 * Read a numeric env override, falling back when it is absent or
 * nonsense. The e2e suite shrinks the TTLs to exercise expiry in
 * milliseconds, so a typo'd value must not become `NaN` and close every
 * room instantly.
 */
function envNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const PORT = envNumber(process.env.PORT, 8081)
const INACTIVITY_TTL_MS = envNumber(process.env.RELAY_INACTIVITY_TTL_MS, INACTIVITY_TTL_DEFAULT_MS)
const IDLE_TTL_MS = envNumber(process.env.RELAY_IDLE_TTL_MS, IDLE_TTL_DEFAULT_MS)
/** Transport liveness only — see the heartbeat at the bottom. */
const HEARTBEAT_MS = 30_000

/* -------------------------------------------------------------- transports */

/**
 * The slice of `ServerWebSocket` this adapter uses, declared structurally
 * so the relay typechecks without pulling in Bun's own type package (the
 * repo has no `@types/bun`, and the ADR forbids a new dependency for it).
 * The worker adapter types the same concept from `@cloudflare/...`.
 */
interface Socket {
  data: SocketData
  readyState: number
  send: (payload: string) => void
  ping: () => void
  terminate: () => void
}

interface SocketData {
  peerId: string
  isAlive: boolean
  /** The canonical code of the ONE room this socket may write into. */
  roomCode: string | undefined
  /** Throttle key: the real client address, captured at upgrade time. */
  ip: string
  /** A create/join carried in the upgrade URL (ADR-0038). */
  intent: { op: 'create' | 'join'; code: string } | undefined
}

/**
 * The slice of Bun's upgrade server this adapter uses. Declared here
 * rather than imported: the repo ships no `@types/bun`, and the ADR
 * forbids a new dependency for a type package. Being explicit also keeps
 * the adapter honest about how little of Bun it touches.
 */
interface UpgradeServer {
  upgrade: (req: Request, options: { data: SocketData }) => boolean
  requestIP: (req: Request) => { address: string } | null
}

declare const Bun: {
  serve: (options: {
    port: number
    fetch: (req: Request, srv: UpgradeServer) => Response | undefined
    websocket: {
      open: (ws: Socket) => void
      message: (ws: Socket, data: string | Uint8Array) => void
      pong: (ws: Socket) => void
      close: (ws: Socket) => void
    }
  }) => unknown
}

/* ------------------------------------------------------------------- state */

/** One live room: the core's registry over its Map-backed store, plus peers. */
interface Room {
  code: string
  registry: RoomRegistry
  peers: Set<Socket>
  row: RoomRecord | null
  timer: ReturnType<typeof setTimeout> | undefined
}

const rooms = new Map<string, Room>()
/** Per-code rev floors. Deliberately separate: they outlive their room. */
const floors = new Map<string, FloorRecord>()
/**
 * Wake-ups for floors whose room is gone. Kept apart from the rooms'
 * own timers so a room dying cannot cancel its floor's prune — and so
 * neither timer is cancelled by the other's lifecycle.
 */
const floorTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** All live sockets (Bun has no iterable `server.clients` — track manually). */
const sockets = new Set<Socket>()

/** Monotonic peer id, used only as the fan-out `from` attribution. */
let nextPeerId = 0

/**
 * The core's storage intents, over the two Maps. This is the whole
 * "adapter owns state" half of ADR-0040 — the core never sees a Map.
 */
function storeFor(code: string): RoomStore {
  return {
    read: () => rooms.get(code)?.row ?? null,
    write: (row) => {
      const room = rooms.get(code)
      if (room) room.row = row
    },
    drop: () => void rooms.delete(code),
    readFloor: () => floors.get(code) ?? null,
    writeFloor: (record) => void floors.set(code, record),
    dropFloor: () => void floors.delete(code),
  }
}

/**
 * The core, wired to this adapter's clock, timer sink and store.
 *
 * Built per live room AND per floor prune: the Bun registry is a few
 * closures over the Maps, so a throwaway one costs nothing and keeps the
 * prune decision in the core instead of duplicating it here.
 */
function registryFor(code: string): RoomRegistry {
  return createRoomRegistry({
    code,
    store: storeFor(code),
    inactivityTtlMs: INACTIVITY_TTL_MS,
    idleTtlMs: IDLE_TTL_MS,
    now: () => Date.now(),
    arm: (deadline) => armRoom(code, deadline),
    onExpire: (expired, reason) => notifyExpired(expired, reason),
  })
}

/**
 * The single timer sink: re-arm the wake-up for whichever deadline the
 * core just decided on, then let the core decide what a wake-up means.
 * Bun's `setTimeout` is used rather than the Durable Object's alarm only
 * because this adapter never hibernates — a live process always has
 * timers.
 *
 * A deadline can belong to a room OR to an orphaned floor (the floor
 * outlives its room, so pruning it needs its own wake-up). They are kept
 * in separate maps because they have different lifetimes: the room timer
 * dies with the room, the floor timer outlives it.
 */
function armRoom(code: string, deadline: number): void {
  const delay = Math.max(0, deadline - Date.now())
  const room = rooms.get(code)
  if (room) {
    if (room.timer) clearTimeout(room.timer)
    room.timer = setTimeout(() => {
      room.timer = undefined
      room.registry.tick()
    }, delay)
    return
  }
  const pending = floorTimers.get(code)
  if (pending) clearTimeout(pending)
  floorTimers.set(
    code,
    setTimeout(() => {
      floorTimers.delete(code)
      // The room is gone; the core prunes the floor if it has aged out and
      // re-arms the timer if it has not.
      registryFor(code).tick()
    }, delay),
  )
}

function roomFor(code: string): Room {
  const existing = rooms.get(code)
  if (existing) return existing
  const room: Room = {
    code,
    peers: new Set(),
    row: null,
    timer: undefined,
    registry: registryFor(code),
  }
  rooms.set(code, room)
  return room
}

/**
 * Tell every peer the room is gone BEFORE the core drops it, so the client
 * stops instead of re-joining a corpse (`room_expired` is terminal on the
 * client — a re-join would join-or-create an empty room and read as silent
 * household data loss).
 *
 * Only sockets STILL in this room are notified, and each one has its
 * `roomCode` cleared: a stale socket that kept the code could otherwise
 * write into — or `leave` and delete — a room re-created under it.
 */
function notifyExpired(code: string, reason: 'inactive' | 'idle'): void {
  const room = rooms.get(code)
  if (!room) return
  for (const peer of room.peers) {
    if (peer.data.roomCode !== code) continue
    peer.data.roomCode = undefined
    send(peer, { type: 'error', code: RELAY_ERRORS.roomExpired, reason })
  }
}

function send(ws: Socket, payload: RelayMessage): void {
  if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(payload))
}

/* --------------------------------------------------------------- throttle */

/**
 * Brute-force throttle: create/join attempts are limited per socket AND
 * per IP, so a guessed-code flood gets `rate_limited`. State fan-out
 * between joined peers is never charged. The arithmetic is the core's; the
 * limit comes from the environment because that is a deployment knob.
 *
 * The address is the REAL peer IP, captured at upgrade time: behind the
 * compose nginx the socket address is nginx's own container IP, which
 * would make every household share one budget — the same collapse that
 * failed 4-9 room-join specs in a 224-test e2e run until
 * `RELAY_ATTEMPT_LIMIT` was raised.
 */
const throttle = makeThrottle({
  limit: envNumber(process.env.RELAY_ATTEMPT_LIMIT, 30),
  buckets: new MemoryAttemptBuckets(),
  peerAddress: (peer) => (peer as Socket).data?.ip ?? 'unknown',
})

/* -------------------------------------------------------------- membership */

/**
 * Tell every attached peer how many of them there are (ADR-0049).
 *
 * Membership is the ONE thing the core cannot broadcast: which sockets
 * belong to a room is the whole difference between a Bun `Set` and a
 * hibernated Durable Object, so each adapter walks its own peer set. The
 * arithmetic and the policy ("on every membership change") are shared.
 * A peer whose socket has already died is skipped by `send`'s guard, so a
 * stale socket cannot turn a fan-out into an exception.
 */
function broadcastPeers(room: Room): void {
  const frame: RelayMessage = { type: 'peers', count: room.peers.size }
  for (const peer of room.peers) send(peer, frame)
}

/** Put a socket into `code`, detaching it from any previous room first. */
function attach(ws: Socket, code: string): void {
  // Already in this room: DO NOT detach. `detach` runs `leave`, and a
  // socket that is the room's only peer would take the room down with it
  // — a client that re-sends `join` for the room it is already in (a
  // retry, or the URL intent on a reconnect that raced) would get a
  // `joined` carrying real state and then find every later push refused
  // with `bad_state`. The admission verdict was already computed against
  // the room this socket is still in, so returning early is also the
  // cheaper answer.
  if (ws.data.roomCode === code && rooms.get(code)?.peers.has(ws)) return
  detach(ws)
  const room = roomFor(code)
  room.peers.add(ws)
  ws.data.roomCode = code
}

/**
 * Remove a socket from its room. The room dies with its last peer
 * (ADR-0026) — a returning client re-joins, which re-creates it, and it
 * is re-seeded. The per-code rev floor survives, so the re-created room
 * continues the household's revision history.
 */
function detach(ws: Socket): void {
  const code = ws.data.roomCode
  if (!code) return
  const room = rooms.get(code)
  ws.data.roomCode = undefined
  if (!room) return
  room.peers.delete(ws)
  // Everyone who is left learns the new headcount before the room may drop
  // (it cannot if nobody is left — the fan-out would have no recipient).
  if (room.peers.size > 0) broadcastPeers(room)
  if (room.registry.leave(room.peers.size).dropped && room.timer) {
    // The room is gone, so its wake-up has nothing left to decide — clear
    // it. An armed 24h timer would keep the Room object (and its peer set)
    // alive long after the last peer left, for every code the relay ever
    // served; `roomLifecycle.mjs`'s dropRoom cleared both timers for the
    // same reason.
    clearTimeout(room.timer)
    room.timer = undefined
  }
}

/* ---------------------------------------------------------------- admission */

/** A legacy mint, avoiding codes that are currently live. */
function mintFreeCode(): string {
  let code = mintLegacyCode()
  for (let i = 0; i < 8 && rooms.has(code); i++) code = mintLegacyCode()
  return code
}

/**
 * Ask the core what an upgrade should be answered with, then translate the
 * verdict into a frame. Both transports (the URL intent and the message
 * protocol) funnel through here, so a create/join pays one budget and one
 * set of replies regardless of how it arrived.
 */
function admit(ws: Socket, code: string, mode: 'create' | 'join'): void {
  const room = roomFor(code)
  const verdict = room.registry.admit(mode, room.peers.size)
  if (verdict.kind === 'refuse') {
    send(ws, { type: 'error', code: verdict.error })
    return
  }
  attach(ws, code)
  // `rev` is the per-code FLOOR, never the room's current rev: a client
  // seeds above it, so a re-created room cannot pass a stale snapshot off
  // as newer (review F4). `count` is the headcount after this peer joined
  // (ADR-0049) — the same number `broadcastPeers` is about to tell the
  // room, stitched in so the joining peer learns it without waiting for a
  // second frame.
  //
  // Clamped to the set's real size: `attach` deliberately keeps a socket
  // that re-joins the room it is ALREADY in, so `livePeers + 1` from the
  // core would report one more peer than exists. The clamp is adapter
  // work on purpose — only the adapter knows whether `attach` grew the
  // set. (The `peers` fan-out below reports the same size, so a clamped
  // join is confirmed a frame later.)
  const count = Math.min(verdict.count, room.peers.size)
  if (verdict.kind === 'establish') {
    send(ws, { type: 'created', code: verdict.code, rev: verdict.rev, count })
  } else {
    send(ws, { type: 'joined', code: verdict.code, rev: verdict.rev, state: verdict.state, count })
  }
  broadcastPeers(room)
}

/**
 * A create. The budget is charged HERE so a URL-carried intent and the
 * legacy message pay the same price.
 *
 * The message form predates the URL intent and only ever honoured word
 * codes (the client rolled them); the URL intent accepts the whole
 * ADR-0021 union through the shared canonicaliser, because that is what
 * the client sends and what the Durable Object relay honours.
 */
function performCreate(ws: Socket, rawCode: unknown, { legacyMessage = false } = {}): void {
  if (!throttle.allow(ws)) {
    send(ws, { type: 'error', code: RELAY_ERRORS.rateLimited })
    return
  }
  const wanted = legacyMessage
    ? typeof rawCode === 'string' && WORD_CODE_RE.test(rawCode.trim())
      ? rawCode.trim()
      : ''
    : canonicalizeCode(rawCode)
  admit(ws, wanted || mintFreeCode(), 'create')
}

/**
 * A join-or-create (ADR-0026): whoever arrives first ESTABLISHES the room
 * under the code they asked for, which is what makes a household room
 * startable by any peer. An unusable code shape answers `not_found`,
 * which the client maps to "not a room code".
 */
function performJoin(ws: Socket, rawCode: unknown): void {
  if (!throttle.allow(ws)) {
    send(ws, { type: 'error', code: RELAY_ERRORS.rateLimited })
    return
  }
  const code = canonicalizeCode(rawCode)
  if (!code) {
    send(ws, { type: 'error', code: RELAY_ERRORS.notFound })
    return
  }
  admit(ws, code, 'join')
}

/* ------------------------------------------------------------------- server */

try {
  Bun.serve({
    port: PORT,
    // Plain HTTP responses so health probes (the Playwright webServer check,
    // load balancers, the CI image smoke-run) get a 200; WebSocket upgrades
    // are handed to the websocket handler below.
    fetch(req, srv) {
      const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      // `requestIP` THROWS for a plain socket argument, so it is only
      // reached through the core throttle's guarded path — never called
      // unguarded from here.
      const ip = forwarded || srv.requestIP(req)?.address || 'unknown'
      // A URL-carried intent (ADR-0038) makes create/join happen the moment
      // the socket opens instead of racing a first message. Only a query
      // that SAYS something carries an intent: a bare /ws upgrade (the e2e
      // suite's direct-dial peers) keeps speaking the message protocol,
      // which stays supported.
      const url = new URL(req.url)
      const carriesIntent = url.searchParams.has('op') || url.searchParams.has('room')
      const intent = carriesIntent
        ? {
            op: url.searchParams.get('op') === 'create' ? ('create' as const) : ('join' as const),
            code: url.searchParams.get('room') ?? '',
          }
        : undefined
      if (srv.upgrade(req, { data: { isAlive: true, roomCode: undefined, ip, intent, peerId: '' } })) return undefined
      // The health body echoes the lifecycle configuration so a test (or an
      // operator) can tell two relays apart without guessing: a leftover
      // listener from an earlier run with DIFFERENT TTLs must never be
      // mistaken for the one a spec asked for.
      return new Response(
        JSON.stringify({
          service: RELAY_SERVICE,
          inactivityTtlMs: INACTIVITY_TTL_MS,
          idleTtlMs: IDLE_TTL_MS,
          attemptLimit: throttle.limit,
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    },
    websocket: {
      open(ws) {
        ws.data.peerId = `p${++nextPeerId}`
        sockets.add(ws)
        const intent = ws.data.intent
        if (!intent) return
        ws.data.intent = undefined
        if (intent.op === 'create') performCreate(ws, intent.code)
        else performJoin(ws, intent.code)
      },

      message(ws, data) {
        let msg: { type?: unknown; code?: unknown; rev?: unknown; state?: unknown }
        try {
          msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
        } catch {
          send(ws, { type: 'error', code: RELAY_ERRORS.badJson })
          return
        }

        const room = ws.data.roomCode ? rooms.get(ws.data.roomCode) : undefined
        // Membership, not just a code: a socket whose room expired (its
        // `roomCode` was cleared) or that a later join detached must not
        // write into or keep alive a room it is not in (review F2/F3).
        const member = Boolean(room?.peers.has(ws))

        switch (msg?.type) {
          case 'create':
            performCreate(ws, msg.code, { legacyMessage: true })
            break

          case 'join':
            performJoin(ws, msg.code)
            break

          case 'keepalive': {
            // Application-level liveness (ADR-0026). NOT throttled: it
            // carries no guessable input and must never be able to burn a
            // create/join budget. The answer is deliberately NOT named
            // `pong` — that name belongs to the socket-level beat below.
            // The core refreshes BOTH expiry clocks, so a 7-day-connected
            // household is never closed by the idle backstop (review F1).
            if (!member || !room) {
              send(ws, { type: 'error', code: RELAY_ERRORS.notInRoom })
              return
            }
            if (room.registry.keepalive().kind === 'ok') send(ws, { type: 'keepalive_ack' })
            else send(ws, { type: 'error', code: RELAY_ERRORS.notInRoom })
            break
          }

          case 'state': {
            if (!member || !room) {
              send(ws, { type: 'error', code: RELAY_ERRORS.badState })
              return
            }
            const verdict = room.registry.push(msg.rev, msg.state, ws.data.peerId)
            if (!verdict.ok) {
              send(ws, { type: 'error', code: verdict.error })
              return
            }
            for (const peer of room.peers) {
              if (peer !== ws) send(peer, verdict.fanOut)
            }
            break
          }

          case 'leave':
            detach(ws)
            send(ws, { type: 'left' })
            break

          default:
            send(ws, { type: 'error', code: RELAY_ERRORS.unknownType })
        }
      },

      pong(ws) {
        ws.data.isAlive = true
      },

      close(ws) {
        sockets.delete(ws)
        detach(ws)
      },
    },
  })
} catch (err) {
  console.error(`[relay] ${(err as Error).message}`)
  process.exit(1)
}

console.log(
  `[relay] listening on :${PORT} (inactivity TTL ${Math.round(INACTIVITY_TTL_MS / 1000)}s, ` +
    `idle backstop TTL ${Math.round(IDLE_TTL_MS / 1000)}s)`,
)

/**
 * Prune dead sockets: a missed pong marks the socket, the next beat
 * terminates it. TRANSPORT liveness only — deliberately it does not touch
 * room activity, which is what `keepalive` is for.
 */
const heartbeat = setInterval(() => {
  for (const socket of sockets) {
    if (socket.data.isAlive === false) {
      socket.terminate()
      continue
    }
    socket.data.isAlive = false
    socket.ping()
  }
}, HEARTBEAT_MS)

process.on('exit', () => clearInterval(heartbeat))