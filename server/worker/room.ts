/**
 * `Room` — one Durable Object per room code (ADR-0038), on the shared core
 * (ADR-0040).
 *
 * The Bun relay kept rooms in a Map inside one process. The mapping onto a
 * DO is deliberately one-to-one: the code is the Durable Object's NAME,
 * so routing a socket to its room is `idFromName(code)` and two things
 * fall out for free instead of needing bookkeeping:
 *
 * - a socket belongs to AT MOST ONE room (review F3) — structurally, it
 *   is only ever handed to one stub;
 * - rooms are independent of each other's load — one busy household
 *   cannot stall another's storage operations.
 *
 * WHAT IS STILL HERE is only the half ADR-0040 leaves to the adapter: the
 * SQL rows, the alarm, and the hibernating WebSocket lifecycle. Every
 * decision — admission, the rev floor, which snapshot keys are preserved,
 * which clock fires first, whether a push is even admissible — comes from
 * `../relay-core`, which is where the Bun adapter gets the same answers.
 *
 * What the in-memory relay expressed with a Map and a `setTimeout` becomes
 * a SQL row and an alarm:
 *
 * - the room row (rev, state JSON, created_at, last_activity, both
 *   deadlines, a peer serial);
 * - the per-code floor row, which OUTLIVES the room row and is handed back
 *   in `created`/`joined` so a room re-created after an expiry cannot
 *   restart the household's revision history at zero (review F4).
 *
 * ONE alarm, armed at the earlier of the two deadlines. workerd gives a
 * hibernated object no timers at all, so a `setTimeout` here would simply
 * not fire once the object went idle — an alarm is the only clock that
 * survives eviction.
 *
 * SCOPED DEVIATION (ADR-0038 §4): when the last peer leaves, this relay
 * KEEPS the room row. The Bun relay deletes a room nobody is in; here the
 * state survives until the expiry clocks fire, so a phone that reconnects
 * after a tunnel or a reload gets its plan back instead of re-seeding an
 * empty room. The deviation is one line — `leave` is simply never called.
 */

import { DurableObject } from 'cloudflare:workers'
import {
  createRoomRegistry,
  type FloorRecord,
  type RoomRecord,
  type RoomRegistry,
  type RoomStore,
} from '../relay-core/lifecycle'
import { IDLE_TTL_MS, INACTIVITY_TTL_MS } from '../relay-core/policy'
import { RELAY_ERRORS, type RelayErrorCode, type RelayMessage } from '../relay-core/protocol'
import { canonicalizeCode } from '../relay-core/codes'

/** What `deserializeAttachment` carries: this socket's peer identity. */
interface PeerAttachment {
  id: string
  code: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS room (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  rev INTEGER NOT NULL,
  state TEXT,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  inactivity_at INTEGER NOT NULL,
  idle_at INTEGER NOT NULL,
  serial INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rev_floor (
  code TEXT PRIMARY KEY,
  rev INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS peer_serial (
  code TEXT PRIMARY KEY,
  serial INTEGER NOT NULL
);
`

/**
 * Why the peer serial lives in its own table rather than as a column on
 * `rev_floor`. It was added after the first Durable Object deploy, and
 * SQLite cannot widen an existing table except through `ALTER TABLE` —
 * which would need a migration probe to stay safe on a database that
 * already has the column. `CREATE TABLE IF NOT EXISTS` needs no probe and
 * cannot fail on an existing database, so the migration is purely
 * additive. A room that predates the table simply has no serial row and
 * falls back to the room row's own counter, which is exactly the
 * behaviour of the first deploy.
 */

const ROOM_ID = 1

export class Room extends DurableObject<Env> {
  /**
   * Guards the one-time DDL. `ctx.storage` is unavailable before the
   * first event reaches the object, and the object can be evicted between
   * any two events, so the schema is (re)checked lazily per instance
   * rather than once in the constructor.
   */
  #schemaReady = false

  /**
   * This object's room code, i.e. the name the worker entry derived it
   * from. The name is a property of the id rather than something the
   * worker has to remember, so it costs nothing to re-read after an
   * eviction; it is absent only for an id that was not built by
   * `idFromName`, which this relay never creates.
   */
  get #code(): string {
    return this.ctx.id.name ?? ''
  }

  /**
   * The shared core, built over this object's SQL store. Recreated per
   * event rather than cached in a field: the instance is cheap, the core
   * is a few closures, and a field would have to survive hibernation to
   * be worth it.
   */
  get #room(): RoomRegistry {
    return createRoomRegistry({
      code: this.#code,
      store: this.#store,
      inactivityTtlMs: INACTIVITY_TTL_MS,
      idleTtlMs: IDLE_TTL_MS,
      now: () => Date.now(),
      arm: (deadline) => this.ctx.storage.setAlarm(deadline),
      onExpire: (_code, reason) => this.#notifyExpired(reason),
    })
  }

  /* ---------------------------------------------------------------- schema */

  #ensureSchema(): void {
    if (this.#schemaReady) return
    this.ctx.storage.sql.exec(SCHEMA)
    this.#schemaReady = true
  }

  /**
   * Re-verify the schema against the actual database. Storage isolation
   * (vitest-pool-workers rolls each test's storage back) and any future
   * storage reset can leave an object that remembers `#schemaReady`
   * looking at a database without its tables, so "did I run the DDL" is
   * answered from SQLite, not from a flag. Cheap: one indexed lookup.
   */
  #ensureTables(): void {
    const present = this.ctx.storage.sql
      .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room'")
      .next()
    // `done` means the probe came back EMPTY, i.e. the table is missing.
    if (present.done) {
      this.#ensureSchema()
      return
    }
    this.#schemaReady = true
  }

  /**
   * One row, or undefined. `one()` THROWS on an empty result, which would
   * turn every "is there a room?" check into an exception, so the row is
   * pulled through `next()` and its `done` flag is the emptiness check.
   */
  #one(query: string, ...bindings: SqlStorageValue[]): Record<string, SqlStorageValue> | undefined {
    this.#ensureTables()
    const step = this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>(query, ...bindings)
      .next()
    return step.done ? undefined : step.value
  }

  /* ----------------------------------------------------------------- store */

  /** Stored state is our own JSON; a corrupt row must not kill the room. */
  static #parseState(raw: string | null): Record<string, unknown> | null {
    if (raw === null) return null
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /**
   * The core's storage INTENTS over this object's two tables — the whole
   * "adapter owns state" half of ADR-0040, including the JSON codec the
   * core knows nothing about.
   */
  get #store(): RoomStore {
    return {
      read: () => this.#readRoom(),
      write: (row) => this.#writeRoom(row),
      drop: () => {
        this.#ensureTables()
        this.ctx.storage.sql.exec('DELETE FROM room WHERE id = ?', ROOM_ID)
      },
      readFloor: () => this.#readFloor(),
      writeFloor: (record) => this.#writeFloor(record),
      dropFloor: () => {
        this.#ensureTables()
        this.ctx.storage.sql.exec('DELETE FROM rev_floor WHERE code = ?', this.#code)
        this.ctx.storage.sql.exec('DELETE FROM peer_serial WHERE code = ?', this.#code)
      },
    }
  }

  #readRoom(): RoomRecord | null {
    const row = this.#one('SELECT * FROM room WHERE id = ?', ROOM_ID)
    if (!row) return null
    const state = row.state === null || row.state === undefined ? null : String(row.state)
    return {
      code: String(row.code),
      rev: Number(row.rev),
      state: Room.#parseState(state),
      createdAt: Number(row.created_at),
      lastActivityAt: Number(row.last_activity),
      inactivityAt: Number(row.inactivity_at),
      idleAt: Number(row.idle_at),
      serial: Number(row.serial),
    }
  }

  #writeRoom(row: RoomRecord): void {
    this.#ensureTables()
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO room
        (id, code, rev, state, created_at, last_activity, inactivity_at, idle_at, serial)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ROOM_ID,
      row.code,
      row.rev,
      row.state === null ? null : JSON.stringify(row.state),
      row.createdAt,
      row.lastActivityAt,
      row.inactivityAt,
      row.idleAt,
      row.serial,
    )
  }

  #readFloor(): FloorRecord | null {
    const row = this.#one('SELECT * FROM rev_floor WHERE code = ?', this.#code)
    if (!row) return null
    return {
      code: String(row.code),
      rev: Number(row.rev),
      at: Number(row.at),
      serial: this.#readSerial(),
    }
  }

  #writeFloor(record: FloorRecord): void {
    this.#ensureTables()
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO rev_floor (code, rev, at) VALUES (?, ?, ?)',
      record.code,
      record.rev,
      record.at,
    )
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO peer_serial (code, serial) VALUES (?, ?)',
      record.code,
      record.serial,
    )
  }

  /** The peer serial, or 0 for a room created before the table existed. */
  #readSerial(): number {
    const row = this.#one('SELECT serial FROM peer_serial WHERE code = ?', this.#code)
    return row ? Number(row.serial) : 0
  }

  /* ---------------------------------------------------------------- sockets */

  #send(ws: WebSocket, payload: RelayMessage): void {
    try {
      ws.send(JSON.stringify(payload))
    } catch {
      // A socket that died between the fan-out and this send is not an
      // error: the close handler already reaped it.
    }
  }

  #fail(ws: WebSocket, code: RelayErrorCode): void {
    this.#send(ws, { type: 'error', code })
  }

  /**
   * Refuse the socket: answer with a relay error and close. These are
   * still WebSockets, not rejected handshakes — the client's room UI is
   * driven by relay messages, so an HTTP 4xx here would surface as a bare
   * "connection failed" instead of "that code is taken".
   */
  #refuse(client: WebSocket, server: WebSocket, code: RelayErrorCode): Response {
    // `accept()` (not `ctx.acceptWebSocket`) is deliberate: a refused
    // socket is never hibernated, so it cannot linger in this room's
    // peer set and cannot be revived by a later message. The client end
    // is still what gets returned, which is what completes the handshake
    // and delivers the error.
    server.accept()
    try {
      server.send(JSON.stringify({ type: 'error', code }))
    } catch {
      // The peer is gone before the refusal could land; nothing to do.
    } finally {
      server.close(1000, code)
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Tell every hibernated peer how many of them there are (ADR-0049).
   *
   * The count itself is the CORE's (`livePeers + 1` on the admission
   * verdict); walking the peer set is the adapter's, because
   * `ctx.getWebSockets()` is the Durable Object's only notion of "live
   * peer" — the Bun relay walks a `Set` instead. A refused socket is never
   * hibernated (`#refuse` uses `accept()`), so it cannot inflate the
   * count; a socket that died mid-send is guarded by `#send`'s try/catch.
   */
  #broadcastPeers(): void {
    const frame: RelayMessage = { type: 'peers', count: this.ctx.getWebSockets().length }
    for (const peer of this.ctx.getWebSockets()) this.#send(peer, frame)
  }

  /**
   * Hibernatable accept, tagged with this peer's id. The serial comes
   * from the core, which keeps it monotone across a re-creation of this
   * code, so an id is never handed out twice within a code's history.
   */
  #acceptPeer(server: WebSocket, code: string): string {
    const id = `p${this.#room.nextSerial()}`
    this.ctx.acceptWebSocket(server, [id])
    server.serializeAttachment({ id, code } satisfies PeerAttachment)
    return id
  }

  /**
   * Tell every peer the room is gone, BEFORE the core drops the row. The
   * client treats `room_expired` as TERMINAL — a re-join would
   * join-or-create an empty room and read as silent household data loss.
   */
  #notifyExpired(reason: 'inactive' | 'idle'): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: 'error', code: RELAY_ERRORS.roomExpired, reason }))
        ws.close(1000, RELAY_ERRORS.roomExpired)
      } catch {
        // Already gone; the close handler reaped it.
      }
    }
  }

  /* ------------------------------------------------------------------ fetch */

  /**
   * Entry point for an upgrade the worker entry has already validated,
   * throttled and routed here. `?mode=create|join&room=<canonical code>`.
   */
  async fetch(request: Request): Promise<Response> {
    this.#ensureTables()
    const url = new URL(request.url)
    const mode = url.searchParams.get('mode') === 'create' ? 'create' : 'join'
    // The entry routed by name, so the code in the URL is already
    // canonical; re-deriving it keeps the row self-describing.
    const code = canonicalizeCode(url.searchParams.get('room')) || this.#code

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    const verdict = this.#room.admit(mode, this.ctx.getWebSockets().length)
    if (verdict.kind === 'refuse') return this.#refuse(client, server, verdict.error)

    this.#acceptPeer(server, code)
    if (verdict.kind === 'establish') {
      // `created` carries the code's rev FLOOR, never the room's current
      // rev: the client seeds above it, so a re-created room cannot pass a
      // stale snapshot off as newer (review F4).
      this.#send(server, { type: 'created', code: verdict.code, rev: verdict.rev, count: verdict.count })
    } else {
      this.#send(server, { type: 'joined', code: verdict.code, rev: verdict.rev, state: verdict.state, count: verdict.count })
    }
    // Everyone learns the new headcount, the joiner included (its own
    // frame already carries it; the fan-out keeps the rest in step).
    this.#broadcastPeers()
    return new Response(null, { status: 101, webSocket: client })
  }

  /* --------------------------------------------------------------- message */

  /**
   * A message off a hibernating socket. Woken objects never pass through
   * `fetch`, so this is where the room rules are applied — by the core.
   */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    this.#ensureTables()
    const attachment = ws.deserializeAttachment() as PeerAttachment | null
    const member = !!attachment && attachment.code === this.#code && attachment.id.startsWith('p')

    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      this.#fail(ws, RELAY_ERRORS.badJson)
      return
    }
    if (!msg || typeof msg !== 'object') {
      this.#fail(ws, RELAY_ERRORS.badJson)
      return
    }

    switch (msg.type) {
      case 'keepalive': {
        // Never throttled: it carries no guessable input and must not be
        // able to burn a create/join budget. The core refreshes BOTH
        // clocks, so a 7-day-connected household is never closed by the
        // idle backstop (review F1).
        if (!member || this.#room.keepalive().kind !== 'ok') {
          this.#fail(ws, RELAY_ERRORS.notInRoom)
          return
        }
        this.#send(ws, { type: 'keepalive_ack' })
        return
      }

      case 'state': {
        // Review F2: MEMBERSHIP, not just the code. A socket that was
        // refused (code_taken / not_found) must not write into the room
        // it was aiming at. The Bun relay answers a non-member's state
        // with bad_state (the membership check is folded into the same
        // guard), so the two relays speak the same reply here.
        const verdict = member
          ? this.#room.push(msg.rev, msg.state, attachment!.id)
          : { ok: false as const, error: RELAY_ERRORS.badState as RelayErrorCode }
        if (!verdict.ok) {
          this.#fail(ws, verdict.error)
          return
        }
        for (const peer of this.ctx.getWebSockets()) {
          if (peer === ws) continue
          this.#send(peer, verdict.fanOut)
        }
        return
      }

      case 'leave': {
        this.#send(ws, { type: 'left' })
        ws.close(1000, 'left')
        // The peer is still hibernated at this point (its close handler runs
        // after), so the count is broadcast from `webSocketClose` once the
        // runtime has actually reaped it. Announcing `size - 1` here would
        // be right by arithmetic and wrong in fact if the socket did not
        // close cleanly.
        return
      }

      case 'create':
      case 'join': {
        // The worker entry carries the intent in the upgrade URL, so
        // these are not part of the documented vocabulary any more. They
        // are still answered rather than dropped when they re-assert THIS
        // room (an old client that only knows how to say so), and refused
        // otherwise: a socket cannot move rooms, and a different code
        // would need a different Durable Object entirely.
        const asked = canonicalizeCode(msg.code)
        const row = member && asked === this.#code ? this.#readRoom() : null
        if (!row) {
          this.#fail(ws, RELAY_ERRORS.unknownType)
          return
        }
        this.#send(
          ws,
          msg.type === 'create'
            ? { type: 'created', code: this.#code, rev: this.#room.floor(), count: this.ctx.getWebSockets().length }
            : { type: 'joined', code: this.#code, rev: row.rev, state: row.state, count: this.ctx.getWebSockets().length },
        )
        return
      }

      default:
        this.#fail(ws, RELAY_ERRORS.unknownType)
    }
  }

  /* ----------------------------------------------------------------- alarms */

  /**
   * Expiry. The core reads the row, decides which of the two clocks fired
   * (and re-arms the alarm when a keepalive moved the deadline), notifies
   * the peers through `onExpire` and drops the row. The floor row
   * deliberately stays, so the household's revision history outlives the
   * room until the idle TTL prunes it.
   */
  async alarm(): Promise<void> {
    this.#ensureTables()
    this.#room.tick()
  }

  /* ------------------------------------------------------------------ close */

  /**
   * A peer left. Deliberately a no-op beyond the peer count: ADR-0038 §4
   * keeps the room row until the clocks fire, so a phone that reloads
   * mid-cook comes back to its plan — which is also why `leave` is never
   * called on the core from here. The runtime has already removed this
   * socket from the hibernation set by the time the handler runs, so
   * `getWebSockets().length` is the headcount AFTER the departure
   * (ADR-0049). With nobody left there is no recipient for the frame, and
   * the DO will be evicted with the row still on its expiry clocks.
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) this.#broadcastPeers()
  }

  /** Same story as close: a dropped transport is not a room deletion. */
  async webSocketError(ws: WebSocket): Promise<void> {
    void ws
  }
}