/**
 * The decision table (ADR-0040 §4).
 *
 * Every rule the two relays share is asserted HERE, once, against the core
 * through an in-memory `RoomStore` — a third implementation of the storage
 * intents alongside the Bun relay's Maps and the worker's SQL rows. If
 * this spec is green, both relays agree on the rules; what it cannot see
 * (hibernation, `SELF.fetch`, alarm survival across eviction) stays in
 * `worker/room.test.ts`.
 *
 * `bun run test:unit` covers this file — it is the reason that script now
 * names `server/relay-core` as well as `src`.
 */

import { describe, expect, test } from 'bun:test'
import {
  createRoomRegistry,
  type ExpiryReason,
  type FloorRecord,
  type RoomRecord,
  type RoomRegistry,
  type RoomStore,
} from './lifecycle'
import { CODE_ALPHABET, IDLE_TTL_MS, INACTIVITY_TTL_MS } from './policy'
import { RELAY_ERRORS } from './protocol'
import { canonicalizeCode, WORD_CODE_RE, mintLegacyCode, normalizeRoomCode } from './codes'

const HOUR = 60 * 60 * 1000

/** A `RoomStore` over two Maps — what a relay with no database does. */
function memoryStore(code: string): RoomStore & { rooms: Map<string, RoomRecord>; floors: Map<string, FloorRecord> } {
  const rooms = new Map<string, RoomRecord>()
  const floors = new Map<string, FloorRecord>()
  return {
    rooms,
    floors,
    read: () => rooms.get(code) ?? null,
    write: (row) => void rooms.set(code, row),
    drop: () => void rooms.delete(code),
    readFloor: () => floors.get(code) ?? null,
    writeFloor: (record) => void floors.set(code, record),
    dropFloor: () => void floors.delete(code),
  }
}

interface Harness {
  registry: RoomRegistry
  store: ReturnType<typeof memoryStore>
  expired: { code: string; reason: ExpiryReason }[]
  /** Absolute deadline of the single armed wake-up, or null. */
  armedAt: () => number | null
  now: (ms: number) => void
}

function harness(code = 'mauve-peacock-candle'): Harness {
  let t = 1_000_000
  let armed: number | null = null
  const expired: { code: string; reason: ExpiryReason }[] = []
  const store = memoryStore(code)
  const registry = createRoomRegistry({
    code,
    store,
    now: () => t,
    arm: (deadline) => void (armed = deadline),
    onExpire: (c, reason) => expired.push({ code: c, reason }),
  })
  return {
    registry,
    store,
    expired,
    armedAt: () => armed,
    now: (ms) => void (t += ms),
  }
}

/* ------------------------------------------------------------------ codes */

describe('room codes are canonicalised by the shared client helper', () => {
  test('both ADR-0021 shapes canonicalise identically', () => {
    expect(normalizeRoomCode('Mauve-Peacock-Candle')).toBe('mauve-peacock-candle')
    expect(normalizeRoomCode('mauve peacock candle')).toBe('mauve-peacock-candle')
    expect(normalizeRoomCode('mauve_peacock_candle')).toBe('mauve-peacock-candle')
    expect(normalizeRoomCode('mauvepeacockcandle')).toBe('mauve-peacock-candle')
    expect(normalizeRoomCode('abc123')).toBe('ABC123')
  })

  test('a PARTIAL word code is refused, never coerced', () => {
    expect(normalizeRoomCode('mauve-peacock')).toBe('')
    expect(normalizeRoomCode('mauve-peacock-candle-extra')).toBe('')
    expect(normalizeRoomCode('a-b-c')).toBe('')
    expect(normalizeRoomCode('!!!')).toBe('')
    expect(normalizeRoomCode('')).toBe('')
  })

  test('the relay entry point is TOTAL over untrusted input', () => {
    // `code` arrives as parsed JSON, so it can be any type at all. The
    // client-typed helper throws on a non-string; the relay must refuse
    // rather than raise inside a socket handler.
    expect(canonicalizeCode(undefined)).toBe('')
    expect(canonicalizeCode(42)).toBe('')
    expect(canonicalizeCode({ code: 'abc123' })).toBe('')
    expect(canonicalizeCode(['amber-falcon-lantern'])).toBe('')
    expect(canonicalizeCode(' Amber-Falcon-Lantern ')).toBe('amber-falcon-lantern')
  })

  test('the relay mints only vowel-free legacy codes', () => {
    for (let i = 0; i < 100; i++) {
      const code = mintLegacyCode()
      expect(code).toMatch(/^[0-9BCDFGHJKLMNPQRSTVWXZ]{6}$/)
      for (const v of 'AEIOU') expect(code).not.toContain(v)
      // A minted code must round-trip through canonicalisation unchanged.
      expect(normalizeRoomCode(code)).toBe(code)
    }
    expect(CODE_ALPHABET).toHaveLength(30)
    expect(CODE_ALPHABET).not.toMatch(/[AEIOU]/)
    expect(WORD_CODE_RE.test('mauve-peacock-candle')).toBe(true)
  })
})

/* -------------------------------------------------------------- admission */

describe('admission (ADR-0026 join-or-create)', () => {
  test('a join onto a code the relay never knew ESTABLISHES the room', () => {
    const h = harness()
    expect(h.registry.admit('join', 0)).toEqual({ kind: 'establish', code: 'mauve-peacock-candle', rev: 0, count: 1 })
    expect(h.store.rooms.get('mauve-peacock-candle')?.state).toBeNull()
  })

  test('a second join adopts the room at its stored rev and state', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(4, { plan: ['a'] }, 'p1')
    expect(h.registry.admit('join', 1)).toEqual({
      kind: 'join',
      code: 'mauve-peacock-candle',
      rev: 4,
      state: { plan: ['a'] },
      count: 2,
    })
  })

  test('create into a free code establishes; into a LIVE room it is code_taken', () => {
    const h = harness()
    expect(h.registry.admit('create', 0).kind).toBe('establish')
    expect(h.registry.admit('create', 1)).toEqual({ kind: 'refuse', error: RELAY_ERRORS.codeTaken })
  })

  test('a stored room with NO peers is not held: create re-establishes it', () => {
    // The room is deleted when its last peer leaves, so a peerless row is
    // reachable only after a crash or a hibernation; treating it as taken
    // would strand the code with no way to open it.
    const h = harness()
    h.registry.admit('create', 0)
    expect(h.registry.admit('create', 0)).toEqual({ kind: 'establish', code: 'mauve-peacock-candle', rev: 0, count: 1 })
  })

  test('an admission reports the headcount INCLUDING the arriving peer (ADR-0049)', () => {
    // The core is the DRY home for `count`: both adapters read it off the
    // verdict rather than recomputing it, so the two runtimes cannot
    // disagree about whether the joiner counts itself.
    const h = harness()
    expect(h.registry.admit('create', 0)).toMatchObject({ count: 1 })
    expect(h.registry.admit('join', 1)).toMatchObject({ kind: 'join', count: 2 })
    expect(h.registry.admit('join', 2)).toMatchObject({ kind: 'join', count: 3 })
    // A create is REFUSED rather than admitted, so it carries no count and
    // must not be mistaken for a headcount change.
    expect(h.registry.admit('create', 3)).toEqual({ kind: 'refuse', error: RELAY_ERRORS.codeTaken })
  })

  test('admission refreshes the clocks of the room it admits into', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.now(HOUR)
    const before = h.store.rooms.get('mauve-peacock-candle')!.inactivityAt
    h.registry.admit('join', 1)
    expect(h.store.rooms.get('mauve-peacock-candle')!.inactivityAt).toBeGreaterThan(before)
  })
})

/* ---------------------------------------------------------------- pushes */

describe('state commits', () => {
  test('a push stores the snapshot, moves the floor and returns the fan-out', () => {
    const h = harness()
    h.registry.admit('join', 0)
    const verdict = h.registry.push(7, { plan: ['x'], checked: [] }, 'p1')
    expect(verdict).toMatchObject({ ok: true, rev: 7 })
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.fanOut).toEqual({ type: 'state', rev: 7, state: { plan: ['x'], checked: [] }, from: 'p1' })
    expect(h.store.rooms.get('mauve-peacock-candle')!.rev).toBe(7)
    expect(h.registry.floor()).toBe(7)
  })

  test.each([
    ['a string rev', '9', {}],
    ['a non-finite rev', Number.NaN, {}],
    ['a non-object state', 9, 'nope'],
    ['a null state', 9, null],
  ])('a push with %s is refused as bad_state', (_label, rev, state) => {
    const h = harness()
    h.registry.admit('join', 0)
    expect(h.registry.push(rev, state, 'p1')).toEqual({ ok: false, error: RELAY_ERRORS.badState })
  })

  test('a push into a room that no longer exists still refuses (no resurrection)', () => {
    const h = harness()
    expect(h.registry.push(1, { a: 1 }, 'p1')).toEqual({ ok: false, error: RELAY_ERRORS.badState })
    expect(h.store.rooms.size).toBe(0)
  })

  test('cookedHistory is preserved when ABSENT — an opted-out sender never wipes it', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(1, { plan: ['a'], cookedHistory: ['2026-01-01'] }, 'p1')
    const verdict = h.registry.push(2, { plan: ['b'] }, 'p2')
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.state.cookedHistory).toEqual(['2026-01-01'])
    expect(h.store.rooms.get('mauve-peacock-candle')!.state).toMatchObject({ cookedHistory: ['2026-01-01'] })
  })

  test('planIdentity: an explicit null REPLACES; absence carries the stored value forward', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(1, { plan: ['a'], planIdentity: 'party' }, 'p1')
    const explicit = h.registry.push(2, { plan: ['a'], planIdentity: null }, 'p2')
    if (!explicit.ok) throw new Error('unreachable')
    expect(explicit.state.planIdentity).toBeNull()
    const absent = h.registry.push(3, { plan: ['a'] }, 'p3')
    if (!absent.ok) throw new Error('unreachable')
    expect(absent.state.planIdentity).toBeNull()
  })

  test('a push does not mutate the caller’s snapshot', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(1, { cookedHistory: ['x'] }, 'p1')
    const incoming: Record<string, unknown> = { plan: [] }
    h.registry.push(2, incoming, 'p2')
    expect(incoming).toEqual({ plan: [] })
  })
})

/* --------------------------------------------------------- rev floor */

describe('the per-code rev floor', () => {
  test('the floor never moves backwards', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(5, { a: 1 }, 'p1')
    h.registry.push(3, { a: 1 }, 'p1')
    expect(h.registry.floor()).toBe(5)
  })

  test('the floor survives the room’s deletion and is carried by the next room', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(11, { a: 1 }, 'p1')
    expect(h.registry.leave(0)).toEqual({ dropped: true })
    expect(h.store.rooms.size).toBe(0)
    // Re-created under the same code: created/join reports the FLOOR, so a
    // stale snapshot can never be passed off as newer (review F4).
    expect(h.registry.admit('join', 0)).toEqual({ kind: 'establish', code: 'mauve-peacock-candle', rev: 11, count: 1 })
    expect(h.store.rooms.get('mauve-peacock-candle')!.state).toBeNull()
  })

  test('the floor is pruned once it is idle-TTL old', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(11, { a: 1 }, 'p1')
    h.now(IDLE_TTL_MS + 1)
    expect(h.registry.floor()).toBe(0)
    expect(h.store.floors.size).toBe(0)
  })

  test('a room’s peer serial never repeats across re-creations of the same code', () => {
    const h = harness()
    h.registry.admit('join', 0)
    expect(h.registry.nextSerial()).toBe(1)
    expect(h.registry.nextSerial()).toBe(2)
    expect(h.store.rooms.get('mauve-peacock-candle')!.serial).toBe(2)
    // The room is deleted with its last peer; the count must not restart.
    h.registry.leave(0)
    h.registry.admit('join', 0)
    expect(h.registry.nextSerial()).toBe(3)
    expect(h.store.rooms.get('mauve-peacock-candle')!.serial).toBe(3)
    // And the floor record carries it even with no room at all.
    h.store.drop()
    h.registry.admit('join', 0)
    expect(h.registry.nextSerial()).toBe(4)
  })
})

/* ------------------------------------------------------------- liveness */

describe('keepalive', () => {
  test('is accepted for a live room and refreshes BOTH clocks', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.now(2 * HOUR)
    const before = h.store.rooms.get('mauve-peacock-candle')!
    h.registry.keepalive()
    const after = h.store.rooms.get('mauve-peacock-candle')!
    expect(after.inactivityAt).toBeGreaterThan(before.inactivityAt)
    expect(after.idleAt).toBeGreaterThan(before.idleAt)
    expect(after.lastActivityAt).toBe(2 * HOUR + 1_000_000)
  })

  test('is refused as not_in_room when the room is gone', () => {
    const h = harness()
    expect(h.registry.keepalive()).toEqual({ kind: 'refuse', error: RELAY_ERRORS.notInRoom })
  })

  test('a household that keeps itself alive for a week is never closed by the idle backstop', () => {
    const h = harness()
    h.registry.admit('join', 0)
    // A WEEK of hourly keepalives, not eight hours: the clock under test
    // is the 7-day backstop, and a shorter loop would still pass if
    // `keepalive` stopped refreshing `idleAt` entirely — which is exactly
    // the review F1 regression this case exists to guard.
    const hours = IDLE_TTL_MS / HOUR + 8
    for (let i = 0; i < hours; i++) {
      h.now(HOUR)
      expect(h.registry.keepalive()).toEqual({ kind: 'ok' })
      // A wake-up that fires while the room is still live must decide
      // "not yet" every single time, for the whole week.
      expect(h.registry.tick()).toBeNull()
      expect(h.expired).toEqual([])
    }
    // And the deadline really did move: past the original 7-day mark.
    expect(h.store.read()!.idleAt).toBeGreaterThan(1_000_000 + IDLE_TTL_MS)
    expect(h.registry.tick()).toBeNull()
  })
})

/* --------------------------------------------------------------- expiry */

describe('expiry clocks (ADR-0038 widening ADR-0026)', () => {
  test('defaults are 24h inactivity and a 7-day idle backstop', () => {
    expect(INACTIVITY_TTL_MS).toBe(24 * HOUR)
    expect(IDLE_TTL_MS).toBe(7 * 24 * HOUR)
  })

  test('one wake-up is armed, at the earlier of the two deadlines', () => {
    const h = harness()
    h.registry.admit('join', 0)
    const row = h.store.rooms.get('mauve-peacock-candle')!
    expect(h.armedAt()).toBe(Math.min(row.inactivityAt, row.idleAt))
  })

  test('24h of silence closes the room as `inactive`, drops the row and keeps the floor', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(3, { a: 1 }, 'p1')
    h.now(INACTIVITY_TTL_MS)
    expect(h.registry.tick()).toBe('inactive')
    expect(h.expired).toEqual([{ code: 'mauve-peacock-candle', reason: 'inactive' }])
    expect(h.store.rooms.size).toBe(0)
    expect(h.store.floors.size).toBe(1)
  })

  test('a tick BEFORE the deadline is a no-op that re-arms itself', () => {
    const h = harness()
    h.registry.admit('join', 0)
    const row = h.store.rooms.get('mauve-peacock-candle')!
    h.now(HOUR)
    expect(h.registry.tick()).toBeNull()
    expect(h.store.rooms.size).toBe(1)
    expect(h.armedAt()).toBe(row.inactivityAt)
  })

  test('a row whose idle clock has passed but whose inactivity clock has not closes as `idle`', () => {
    const h = harness()
    h.registry.admit('join', 0)
    const row = h.store.rooms.get('mauve-peacock-candle')!
    h.store.write({ ...row, inactivityAt: h.store.read()!.idleAt + HOUR, idleAt: 1_000_000 - 1 })
    expect(h.registry.tick()).toBe('idle')
    expect(h.expired[0]!.reason).toBe('idle')
  })

  test('a tick for a room that is already gone prunes only a stale floor', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(3, { a: 1 }, 'p1')
    h.now(IDLE_TTL_MS + 1)
    h.store.drop()
    expect(h.registry.tick()).toBeNull()
    expect(h.expired).toEqual([])
    expect(h.store.floors.size).toBe(0)
  })

  test('a FRESH floor with no room keeps a wake-up armed until it ages out', () => {
    // Nothing reads an orphaned floor until its code comes back, so
    // without this wake-up a relay accumulates one floor entry per code
    // it has ever served, forever. The wake-up re-arms while the floor is
    // fresh and stops dead once the idle TTL has reclaimed it.
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(3, { a: 1 }, 'p1')
    // The real drop path, not a raw `store.drop()`: the adapter never
    // touches the store directly, and `leave` is what re-aims the
    // wake-up at the floor it leaves behind.
    expect(h.registry.leave(0).dropped).toBe(true)
    const floor = h.store.floors.get('mauve-peacock-candle')!
    expect(h.armedAt()).toBe(floor.at + IDLE_TTL_MS)

    // A wake-up that fires while the floor is still fresh decides nothing
    // and re-arms for the same deadline.
    h.now(HOUR)
    expect(h.registry.tick()).toBeNull()
    expect(h.store.floors.size).toBe(1)
    expect(h.armedAt()).toBe(floor.at + IDLE_TTL_MS)

    // Once the floor has aged out, the wake-up reclaims it and stops.
    h.now(IDLE_TTL_MS)
    expect(h.registry.tick()).toBeNull()
    expect(h.store.floors.size).toBe(0)
  })

  test('dropping a room arms nothing new when there is no floor to prune', () => {
    // No floor means nothing to reclaim, and an armed deadline with nothing
    // behind it would be a timer that fires to no purpose.
    const h = harness()
    h.registry.admit('join', 0)
    const armedWhileLive = h.armedAt()
    expect(h.store.floors.size).toBe(0)
    expect(h.registry.leave(0).dropped).toBe(true)
    expect(h.armedAt()).toBe(armedWhileLive)
  })

  test('dropping a room re-aims the wake-up at the surviving floor', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(3, { a: 1 }, 'p1')
    const floor = h.store.floors.get('mauve-peacock-candle')!
    expect(h.registry.leave(0).dropped).toBe(true)
    expect(h.store.rooms.size).toBe(0)
    expect(h.store.floors.size).toBe(1)
    expect(h.armedAt()).toBe(floor.at + IDLE_TTL_MS)
  })

  test('a throwing expire hook cannot keep a room alive', () => {
    const store = memoryStore('mauve-peacock-candle')
    let t = 1_000_000
    const registry = createRoomRegistry({
      code: 'mauve-peacock-candle',
      store,
      now: () => t,
      arm: () => {},
      onExpire: () => {
        throw new Error('peer sink is down')
      },
    })
    registry.admit('join', 0)
    t += INACTIVITY_TTL_MS
    expect(registry.tick()).toBe('inactive')
    expect(store.rooms.size).toBe(0)
  })
})

/* --------------------------------------------------------------- leaving */

describe('a room dies with its last peer (ADR-0026)', () => {
  test('the last peer leaving drops the room and its state; the floor stays', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(2, { plan: ['a'] }, 'p1')
    expect(h.registry.leave(1)).toEqual({ dropped: false })
    expect(h.store.rooms.size).toBe(1)
    expect(h.registry.leave(0)).toEqual({ dropped: true })
    expect(h.store.rooms.size).toBe(0)
    expect(h.registry.floor()).toBe(2)
  })

  test('a returning peer re-joins and finds the rev floor, not the old snapshot', () => {
    const h = harness()
    h.registry.admit('join', 0)
    h.registry.push(2, { plan: ['a'] }, 'p1')
    h.registry.leave(0)
    const back = h.registry.admit('join', 0)
    expect(back).toEqual({ kind: 'establish', code: 'mauve-peacock-candle', rev: 2, count: 1 })
  })
})