/**
 * The relay wire protocol, declared once (ADR-0040).
 *
 * These are the message shapes the client sends and both relays answer.
 * They are TYPE-only declarations plus the `RELAY_ERRORS` taxonomy, so
 * importing this module costs nothing at runtime — a `import type` on the
 * client, a value import on the relays for the error codes.
 *
 * The taxonomy being one export is the point: the relays can no longer
 * disagree on a spelling, and `src/lib/relayErrors.ts` keys its
 * user-facing outcomes off the same names.
 */

/** A shared-state snapshot, opaque to the relay: it stores and fans it out. */
export type SharedSnapshot = Record<string, unknown>

/** What a client sends. `state` is the only message carrying household data. */
export type ClientMessage =
  /** Join-or-create a room under `code` (ADR-0026). */
  | { type: 'join'; code?: unknown }
  /** Claim `code`, minting one when absent. Refused as `code_taken` when live. */
  | { type: 'create'; code?: unknown }
  /** Application-level liveness. Refreshes BOTH clocks; never throttled. */
  | { type: 'keepalive' }
  /** A whole-state push at revision `rev`. */
  | { type: 'state'; rev?: unknown; state?: unknown }
  /** Detach this socket; the room dies with its last peer (ADR-0026). */
  | { type: 'leave' }

/** What a relay sends. */
export type RelayMessage =
  /** The room now exists (create, or a join that established it). `rev` is the per-code floor. */
  | { type: 'created'; code: string; rev: number; count: number }
  /** An existing room admitted this peer; `state` is null until the first push. */
  | { type: 'joined'; code: string; rev: number; state: SharedSnapshot | null; count: number }
  /**
   * Live membership count, broadcast to EVERY peer on every membership
   * change (ADR-0049). `count` is the number of ATTACHED peers AFTER the
   * change, so the joining peer is included in the frame it receives with
   * its own `created`/`joined` too.
   */
  | { type: 'peers'; count: number }
  /** Fan-out of a peer's push, to every peer EXCEPT the sender. */
  | { type: 'state'; rev: number; state: SharedSnapshot; from: string }
  /** Answer to `keepalive`. Deliberately not `pong` — that is the socket-level beat. */
  | { type: 'keepalive_ack' }
  /** Answer to `leave`. */
  | { type: 'left' }
  /** Every refusal, terminal or not. `reason` accompanies `room_expired`. */
  | { type: 'error'; code: RelayErrorCode; reason?: ExpiryReason }

/** Why a room closed: which of the two expiry clocks fired (ADR-0038). */
export type ExpiryReason = 'inactive' | 'idle'

/**
 * The `error` payloads the relay can emit. One taxonomy for both runtimes
 * (ADR-0040) — the Bun relay used to spell these inline in its switch and
 * the worker kept its own copy in `worker/codes.ts`.
 */
export const RELAY_ERRORS = {
  codeTaken: 'code_taken',
  notFound: 'not_found',
  roomExpired: 'room_expired',
  rateLimited: 'rate_limited',
  badState: 'bad_state',
  badJson: 'bad_json',
  notInRoom: 'not_in_room',
  unknownType: 'unknown_type',
} as const

export type RelayErrorCode = (typeof RELAY_ERRORS)[keyof typeof RELAY_ERRORS]