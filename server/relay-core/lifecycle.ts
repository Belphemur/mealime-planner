/**
 * The room state machine — the ONE semantics owner for both relays
 * (ADR-0040, ADR-0026, ADR-0038).
 *
 * ## The persistence boundary
 *
 * This module owns DECISIONS — when a room expires, what a join adopts,
 * how the rev floor moves, which refusal a message earns — and never
 * touches storage. It speaks in INTENTS (`RoomStore` below); each adapter
 * implements them over its own medium: the Bun relay's in-process Maps,
 * the Durable Object's SQL rows plus an alarm. That is what lets the
 * decision table in `./lifecycle.test.ts` run against a pure in-memory
 * store while workerd proves the SQL side.
 *
 * ## Everything is injected
 *
 * The clock (`now`), the timer sink (`arm`), the TTLs, the code and the
 * store are all parameters, and NOTHING here reads `process.env` or
 * imports a runtime API: workerd has no `process` without
 * `nodejs_compat`, and a module-scope read would throw before the worker
 * ran its first line. That rule is structural now, not a convention.
 *
 * ## One registry per code
 *
 * A registry is scoped to ONE room code, which is exactly the Durable
 * Object's shape (one DO per code, `idFromName`). The Bun relay keeps a
 * Map of registries, one per live code — so the two adapters differ in
 * their store implementation and nowhere else.
 */

import { IDLE_TTL_MS, INACTIVITY_TTL_MS, PRESERVED_WHEN_ABSENT } from './policy'
import {
  RELAY_ERRORS,
  type ExpiryReason,
  type RelayErrorCode,
  type RelayMessage,
  type SharedSnapshot,
} from './protocol'

/** Re-exported so an adapter needs only this module for the whole vocabulary. */
export type { ExpiryReason }

/* ------------------------------------------------------------------ records */

/**
 * The room row. Deliberately runtime-neutral: the DO stores it as SQL
 * columns and the Bun relay keeps it as a Map value, so the field names
 * must mean the same thing to both.
 */
export interface RoomRecord {
  code: string
  /** The revision of the last stored snapshot. */
  rev: number
  /** The last shared-state snapshot, or null until the first push. */
  state: SharedSnapshot | null
  createdAt: number
  /** When the room was last touched by any liveness signal. */
  lastActivityAt: number
  /** Absolute deadline of the 24h inactivity clock. */
  inactivityAt: number
  /** Absolute deadline of the 7-day idle backstop. */
  idleAt: number
  /**
   * Monotonic peer counter. The DO derives `state.from` from it so peer
   * ids are stable and unique within a code's history, even across a
   * room's re-creation (review F4).
   */
  serial: number
}

/**
 * The per-code floor record, which OUTLIVES the room row (review F4).
 *
 * It carries the rev AND the peer serial, because both must survive the
 * room's deletion: `rev` so a re-created room never passes a stale
 * snapshot off as newer, `serial` so a peer id is never handed out twice
 * under the same code (the relay echoes `state.from`, so a repeat would
 * read as another device's push).
 */
export interface FloorRecord {
  code: string
  rev: number
  at: number
  serial: number
}

/**
 * The storage intents. Every method is a question the core asks, never an
 * assumption about where bytes live.
 */
export interface RoomStore {
  /** The room row, or null when the room does not exist. */
  read: () => RoomRecord | null
  write: (row: RoomRecord) => void
  /** Forget the room (and its state). The floor deliberately survives. */
  drop: () => void
  readFloor: () => FloorRecord | null
  writeFloor: (record: FloorRecord) => void
  dropFloor: () => void
}

/* ------------------------------------------------------------------ verdicts */

/**
 * What the core decided an upgrade should be answered with.
 *
 * `count` is the live membership INCLUDING the peer being admitted, and it
 * is computed HERE rather than by each adapter: the core already receives
 * `livePeers`, so `livePeers + 1` is the one arithmetic both relays must
 * agree on (ADR-0049). Only the socket-set broadcast of later changes
 * stays in the adapters, because which sockets belong to a room is exactly
 * what differs between a Bun `Set` and a hibernated Durable Object.
 */
export type Admission =
  /** Refuse: the code is unusable, or a live room already holds it. */
  | { kind: 'refuse'; error: RelayErrorCode }
  /** The room is being established (create into an unheld code, or a join the relay never knew). */
  | { kind: 'establish'; code: string; rev: number; count: number }
  /** An existing room admitted this peer; the snapshot may be adopted. */
  | { kind: 'join'; code: string; rev: number; state: SharedSnapshot | null; count: number }

export type RoomReply = Admission | { kind: 'message'; reply: RelayMessage }

/** What a commit of a pushed snapshot did. */
export type PushVerdict =
  | { ok: false; error: RelayErrorCode }
  | {
      ok: true
      rev: number
      /** The stored snapshot, including the members carried forward. */
      state: SharedSnapshot
      /** The fan-out payload for every peer except the sender. */
      fanOut: RelayMessage
    }

export interface RegistryOptions {
  /** The room code this registry owns. */
  code: string
  store: RoomStore
  inactivityTtlMs?: number
  idleTtlMs?: number
  /** The clock. Injected so the decision table can pin time. */
  now?: () => number
  /**
   * The timer sink: schedule a wake-up for an ABSOLUTE deadline. The Bun
   * relay clears and re-arms a `setTimeout`; the DO calls
   * `ctx.storage.setAlarm` (workerd gives a hibernated object no timers,
   * so an alarm is the only clock that survives eviction).
   */
  arm: (deadline: number) => void
  /** Called with `reason` just BEFORE the room is dropped, so peers can stop. */
  onExpire?: (code: string, reason: ExpiryReason) => void
}

export interface RoomRegistry {
  readonly code: string
  /** The row, or null. */
  snapshot: () => RoomRecord | null
  /** The canonical rev this code has reached (0 when unknown or stale). */
  floor: () => number
  /** Decide, and persist, what an upgrade should be answered with. */
  admit: (mode: 'create' | 'join', livePeers: number) => Admission
  /** A `keepalive` from a member. Refreshes BOTH clocks (review F1). */
  keepalive: () => { kind: 'ok' } | { kind: 'refuse'; error: RelayErrorCode }
  /** Commit a snapshot and refresh the clocks. */
  push: (rev: unknown, state: unknown, from: string) => PushVerdict
  /** Restart both clocks without changing state. */
  touch: () => void
  /**
   * Mint the next peer serial for this room and persist it. Needed by
   * adapters that derive a peer's identity from it (the Durable Object
   * uses it as both the hibernation tag and the `state.from`
   * attribution); the in-process relay has its own global counter.
   *
   * The serial is stored in the FLOOR record, not only the room row, so it
   * never repeats under a code whose room was deleted and re-created —
   * a repeated `from` would read as another device's push.
   */
  nextSerial: () => number
  /**
   * A peer detached. `remaining` is how many peers are left; the room dies
   * with its last peer (ADR-0026) unless the adapter says otherwise.
   */
  leave: (remaining: number) => { dropped: boolean }
  /**
   * Expiry check, called from the timer sink or the alarm. Returns the
   * reason when the room closed, null when it is still live (an early or
   * spurious wake-up is a no-op that re-arms itself).
   */
  tick: () => ExpiryReason | null
}

/** Guard shared by `push` in both relays: membership + shape, one error. */
export function isCommitShape(rev: unknown, state: unknown): boolean {
  return typeof rev === 'number' && Number.isFinite(rev) && typeof state === 'object' && state !== null
}

/**
 * Build the registry for one room code. Everything it needs is injected,
 * so the same object graph runs under Bun, under workerd and under the
 * decision table's in-memory store.
 */
export function createRoomRegistry({
  code,
  store,
  inactivityTtlMs = INACTIVITY_TTL_MS,
  idleTtlMs = IDLE_TTL_MS,
  now = () => Date.now(),
  arm,
  onExpire = () => {},
}: RegistryOptions): RoomRegistry {
  /**
   * Restart BOTH expiry clocks. Every liveness signal funnels through
   * here — create, join, state AND keepalive (review F1) — because a
   * connected peer that keepalives is by definition not an idle room, and
   * a 7-day-connected household must never be closed by the backstop.
   *
   * ONE deadline is armed, at the earlier of the two. The Bun relay used
   * to arm two `setTimeout`s and the DO one alarm; the arithmetic is
   * identical (both clocks are re-armed together, so the inactivity
   * deadline is always the earlier one) and the single wake-up is what
   * lets `tick()` tell which clock fired.
   */
  function touch(row: RoomRecord): RoomRecord {
    const t = now()
    const next: RoomRecord = {
      ...row,
      lastActivityAt: t,
      inactivityAt: t + inactivityTtlMs,
      idleAt: t + idleTtlMs,
    }
    store.write(next)
    arm(Math.min(next.inactivityAt, next.idleAt))
    return next
  }

  function touchIfLive(): RoomRecord | null {
    const row = store.read()
    return row ? touch(row) : null
  }

  /**
   * The canonical `rev` this code has reached (0 when unknown, or older
   * than the idle TTL — the entry is pruned on the way through, which is
   * what keeps the floor bounded without a clock of its own).
   */
  function floorRev(): number {
    const entry = store.readFloor()
    if (!entry) return 0
    if (now() - entry.at > idleTtlMs) {
      store.dropFloor()
      return 0
    }
    return entry.rev
  }

  /**
   * Record a rev, moving the floor forward when it is higher and
   * refreshing the floor's own age either way, so a busy household never
   * has its floor pruned underneath it. `rev` is monotone PER CODE and
   * never moves backwards (review F4).
   */
  function noteFloor(rev: number, serial = store.readFloor()?.serial ?? 0): void {
    const t = now()
    const entry = store.readFloor()
    // Either the rev moves forward, or the entry was stale (and is being
    // replaced anyway); otherwise only the AGE is refreshed, so a busy
    // household never has its floor pruned underneath it.
    if (!entry || rev > entry.rev || t - entry.at > idleTtlMs) {
      store.writeFloor({ code, rev, at: t, serial })
      return
    }
    store.writeFloor({ ...entry, at: t, serial })
  }

  /**
   * Establish a fresh room and answer `created`, carrying the code's rev
   * FLOOR so a re-created room continues the household's revision history
   * (review F4). Both `create` into an unheld code and `join` onto a code
   * with no stored room land here — the same event with the same reply,
   * which is what join-or-create means.
   */
  function establish(count: number): Admission {
    const t = now()
    const floor = floorRev()
    // The serial is NOT bumped here: the adapter that admits the peer mints
    // it with `nextSerial()`, which also persists it to the floor record.
    const serial = Math.max(store.readFloor()?.serial ?? 0, store.read()?.serial ?? 0)
    store.write({
      code,
      rev: floor,
      state: null,
      createdAt: t,
      lastActivityAt: t,
      inactivityAt: t + inactivityTtlMs,
      idleAt: t + idleTtlMs,
      serial,
    })
    arm(Math.min(t + inactivityTtlMs, t + idleTtlMs))
    return { kind: 'establish', code, rev: floor, count }
  }

  function admit(mode: 'create' | 'join', livePeers: number): Admission {
    const existing = store.read()
    // The count every admission reports: the peers already attached plus
    // the one about to be (ADR-0049).
    const count = livePeers + 1
    if (mode === 'create') {
      // A stored room that nobody is in is, logically, gone — the room is
      // deleted when its last peer leaves (ADR-0026), so a `create` lands
      // on a fresh room either way. What survives the deletion is the rev
      // FLOOR, and the `created` reply carries it.
      if (existing && livePeers > 0) return { kind: 'refuse', error: RELAY_ERRORS.codeTaken }
      return establish(count)
    }
    // join-or-create (ADR-0026): the first peer to arrive under a code the
    // relay has never seen ESTABLISHES the room and is answered `created`.
    // `not_found` for an unusable code shape is the adapter's call — it is
    // the one that parsed the URL/message.
    if (!existing) return establish(count)
    const row = touch(existing)
    return { kind: 'join', code, rev: row.rev, state: row.state, count }
  }

  function keepalive(): { kind: 'ok' } | { kind: 'refuse'; error: RelayErrorCode } {
    // Never throttled: it carries no guessable input and must not be able
    // to burn a create/join budget. It DOES refresh both clocks.
    if (!touchIfLive()) return { kind: 'refuse', error: RELAY_ERRORS.notInRoom }
    return { kind: 'ok' }
  }

  /**
   * Commit a snapshot and move the floor. `cookedHistory` and
   * `planIdentity` are PRESERVED when the inbound snapshot omits them
   * (ADR-0032 / ADR-0034): an opted-out sender is silent about history,
   * never a wipe, and an explicit `planIdentity: null` really does mean
   * "no current plan", so only an ABSENT key carries the stored value
   * forward. This store is what a later joiner adopts, which is exactly
   * why a wholesale replace would be destructive.
   */
  function push(rev: unknown, state: unknown, from: string): PushVerdict {
    if (!isCommitShape(rev, state)) return { ok: false, error: RELAY_ERRORS.badState }
    const incoming = state as SharedSnapshot
    const previous = store.read()?.state
    let next = incoming
    for (const key of PRESERVED_WHEN_ABSENT) {
      if (incoming[key] === undefined && previous?.[key] !== undefined) {
        if (next === incoming) next = { ...incoming }
        next[key] = previous[key]
      }
    }
    // A push into a room that is gone is refused rather than resurrected:
    // the sender believed it was in a household, and it is not (the room
    // expired, or its last peer left and took the room with it).
    const row = touchIfLive()
    if (!row) return { ok: false, error: RELAY_ERRORS.badState }
    store.write({ ...row, rev: rev as number, state: next })
    noteFloor(rev as number, row.serial)
    return {
      ok: true,
      rev: rev as number,
      state: next,
      fanOut: { type: 'state', rev: rev as number, state: next, from },
    }
  }

  /**
   * Mint and persist the next peer serial. Both the floor record and the
   * room row are stamped, so the value survives whichever of the two
   * outlives the other.
   */
  function nextSerial(): number {
    const row = store.read()
    const serial = Math.max(store.readFloor()?.serial ?? 0, row?.serial ?? 0) + 1
    noteFloor(row?.rev ?? floorRev(), serial)
    if (row) store.write({ ...row, serial })
    return serial
  }

  /**
   * Arm the wake-up that prunes an ORPHANED floor.
   *
   * A floor outlives its room by design, so dropping the room leaves a
   * record that nothing else will ever look at: with no timer armed, a
   * relay that keeps serving codes would accumulate one floor entry per
   * code it has EVER seen (the Bun adapter's `Map`, the DO's
   * `rev_floor`/`peer_serial` rows). The floor is small, but it is
   * unbounded, and it is read only if the code comes back — so the only
   * honest way to reclaim it is to wake up when it reaches its idle TTL.
   */
  function armFloorPrune(): void {
    const entry = store.readFloor()
    if (entry) arm(entry.at + idleTtlMs)
  }

  function leave(remaining: number): { dropped: boolean } {
    if (remaining > 0) return { dropped: false }
    // Nobody is there, so the room (and its state) goes too. A returning
    // client re-joins — which re-creates it — and re-seeds it. The
    // per-code rev floor survives (review F4).
    store.drop()
    armFloorPrune()
    return { dropped: true }
  }

  /**
   * Expiry. Whichever clock fired first closes the room, tells its peers
   * `room_expired` (the client treats that as TERMINAL — a re-join would
   * join-or-create an empty room and read as silent household data loss)
   * and deletes the room row. The floor row deliberately stays, so the
   * household's revision history outlives the room until the idle TTL
   * prunes it.
   */
  function tick(): ExpiryReason | null {
    const t = now()
    const row = store.read()
    if (!row) {
      // The room is already gone; this wake-up only prunes a stale floor,
      // and re-arms itself for as long as the floor is still fresh.
      const entry = store.readFloor()
      if (!entry) return null
      if (t - entry.at > idleTtlMs) {
        store.dropFloor()
        return null
      }
      arm(entry.at + idleTtlMs)
      return null
    }
    const deadline = Math.min(row.inactivityAt, row.idleAt)
    if (t < deadline) {
      // Touched (a keepalive re-armed it) since the wake-up was set.
      arm(deadline)
      return null
    }
    const reason: ExpiryReason = row.inactivityAt <= row.idleAt ? 'inactive' : 'idle'
    try {
      onExpire(code, reason)
    } catch (err) {
      // A misbehaving peer sink must never keep the room alive; expiry has
      // already happened by contract.
      console.error(`[relay] expire hook failed for ${code}: ${(err as Error)?.message ?? err}`)
    }
    store.drop()
    // The room is gone but its floor survives, so the prune wake-up moves
    // from the room's deadline to the floor's (see `armFloorPrune`).
    armFloorPrune()
    return reason
  }

  return {
    code,
    snapshot: () => store.read(),
    floor: floorRev,
    admit,
    keepalive,
    push,
    touch: () => void touchIfLive(),
    nextSerial,
    leave,
    tick,
  }
}