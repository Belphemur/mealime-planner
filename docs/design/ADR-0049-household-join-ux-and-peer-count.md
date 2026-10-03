# ADR-0049 — Household join UX, the live peer count, and the relay protocol

* Extends: ADR-0019 (household room as a persisted default join target),
  ADR-0023 (share-room link), ADR-0026 (join-or-create lifecycle), ADR-0038
  (the Cloudflare relay adapter), ADR-0040 (the one TypeScript relay core),
  ADR-0044 (icon-scoped tooltips)
* Status: **Proposed** (2026-10-04)
* Companions: `server/relay-core/protocol.ts`, `server/relay-core/lifecycle.ts`,
  `server/relay.ts`, `server/worker/room.ts`, `src/stores/room.ts`,
  `src/App.vue`, `src/components/SettingsTab.vue`,
  `src/components/JoinCongratsModal.vue` (new)

## Context

The household room worked, and nobody could tell. Three findings, in the
owner's own words:

> "the code should be visible but only the join now button. That will save
> and join the room, then share link and last leave. That's it, make it
> simpler to work. The join now if no code will generate a new code
> automatically. Clicking new code will also join the room automatically."
>
> "Also we should add a proper tooltip to the live at the top and bring
> back some green dot for it."
>
> "Leave actually should remove the code too."
>
> "When using a shared room link the user should get a simple
> congratulations modal full page saying they have joined the household
> with the code."
>
> "Also in the settings (when connected only) and tooltip on the live
> chip we should show how many people are actively in the room now."
>
> "Be sure we have clear architectural docs on the protocol too."

Each of those is a symptom of one cause: **the app never told the truth
about the room it was in.** It knew `status` and `code` — a boolean and a
string — so the header chip could say "Live" and nothing more, the settings
card could only offer *Save* and *Join now* over the same field, and a
successful join was indistinguishable from a failed one except by a toast
that was replaced a second later.

The peer count is the interesting half, because it is the one thing the
**relay** already knew and threw away.

## The protocol, in one place

ADR-0040 put every relay *decision* in one TypeScript core with two thin
adapters. That split is what makes the count tractable, so it is worth
restating which side of the seam each concern lives on:

```
             server/relay-core/                    adapters
  protocol.ts   types + the error taxonomy    ──▶  both speak this shape
  lifecycle.ts  admit / push / keepalive /       relay.ts   (Bun: Maps,
               leave / expiry verdicts            worker/    Set<WebSocket>)
  policy.ts     TTLs, canonical codes            room.ts    (DO: SQL rows,
  codes.ts      normalizeRoomCode (re-exports    throttle.ts ctx.getWebSockets())
               src/lib/roomWords.ts)
  throttle.ts   attempt budget arithmetic
```

**The core owns decisions and never counts sockets.** It has no WebSocket,
no Map and no SQL — only a `RoomStore` interface with intents
(`read`/`write`/`drop`/`readFloor`/`writeFloor`/`dropFloor`). The two
adapters differ in exactly one thing: the peer set. A Bun relay holds a
`Set<Socket>`; a Durable Object can only ask the runtime
(`ctx.getWebSockets()`), which counts only *accepted* sockets and answers
*before* a freshly accepted one is visible. That difference is why the
membership **fan-out** must live in the adapters and the membership
**arithmetic** must not.

That is the whole architectural statement this ADR adds, and the peer count
is its first user.

## Decision 1 — the headcount is computed once, in the core

`admit(mode, livePeers)` already received the number of live peers: `create`
refuses a held code precisely by testing `livePeers > 0` (ADR-0026). So
"how many people are in this room once I have joined" is
`livePeers + 1`, and the core already has both operands.

```ts
export type Admission =
  | { kind: 'refuse'; error: RelayErrorCode }
  | { kind: 'establish'; code: string; rev: number; count: number }
  | { kind: 'join'; code: string; rev: number; state: SharedSnapshot | null; count: number }
```

Both adapters read `verdict.count` off the verdict. Neither recomputes it.
If the arithmetic lived in the adapters it would exist twice, and a
one-off difference between the Docker relay and the Cloudflare one would be
invisible until a household split its brain across the two deployments.

A refusal carries no count: a refused socket is not a member, so there is no
headcount to report.

## Decision 2 — one new frame, `peers`, on every membership change

```ts
| { type: 'peers'; count: number }
```

- **On admission** the relay fans a `peers` frame to *every* peer —
  including the joiner, whose `created`/`joined` already carried the same
  number. Redundant on purpose: the joiner is the one peer whose admission
  frame cannot arrive before the fan-out it triggers.
- **On departure** (`leave`, socket close, or being detached from another
  room) the relay fans it to the survivors.
- `created` and `joined` grow a `count` field so the first headcount a peer
  ever sees arrives with its admission, not a frame later.

Two adapter-specific consequences, both forced by the runtime rather than
chosen:

- **The DO broadcasts from `webSocketClose`, not from the `leave` case.**
  `ctx.getWebSockets()` reaps a socket *before* its close handler runs, so
  that handler is the first moment the post-departure headcount is a fact.
  Broadcasting `size - 1` from the `leave` case would be correct by
  arithmetic and wrong whenever the socket did not close cleanly.
- **A refused socket never counts.** `#refuse()` uses `server.accept()`
  rather than `ctx.acceptWebSocket` precisely so a refusal is not
  hibernated — which is also what keeps `code_taken` from inflating the
  headcount of the room it was aimed at.

The relay does not track *people*, it tracks *sockets*. One person on two
tabs is two; that is deliberate and is what "actively in the room" means.

## Decision 3 — the client stores a third state, not a number

```ts
const peers = ref<number | null>(null)
```

`null` is "not told yet" and is rendered differently from `1`: a device that
is still connecting is not a household of one. `leave()` restores `null`,
because the count described a room this device is no longer in. Anything
that is not a positive integer is **dropped**, not displayed — a relay
answering `0` for a room the asking socket is in is lying, and showing that
is worse than showing nothing.

The client never counts anything itself. It displays the last number the
relay gave it.

## Decision 4 — one primary action, `Join now`

The household card had two mutation buttons over one field (`Save` and
`Join now`) plus a third, `Adopt`, that existed only to point the setting
at a room the device was already in. Two buttons that do the same thing
differ only in *when* they take effect is a decision the user has to make
twice for no reason, and the `Adopt` button asked them to read a code off
a chip and type it back.

There is now exactly **one** mutation entry point for the code field:

| Input state | `Join now` does |
| --- | --- |
| empty | rolls a fresh code into the field, **creates** it |
| rolled here (never joined) | **creates** it |
| a parseable typed code | joins it (join-or-create, ADR-0026) |
| non-empty but unparseable | button is **disabled** |
| already live in this same code | no reconnect; just saves + confirms |

The rolled-code path **creates** rather than joins on purpose: it keeps the
existing `code_taken` re-roll behaviour (ADR-0026), so a collision re-rolls
instead of silently adopting a stranger's room. That is the exact review
finding (`qodo` 4128519644) the two-button design was working around.

`Save` and `Adopt` are **removed**. The input stays visible and editable,
including the KeepAlive draft-echo guard: a backup import landing
mid-edit must not stomp what the user is typing.

## Decision 5 — `Leave` is a full opt-out

`Leave` clears the saved code as well as the socket. Leaving the room but
keeping the code means the household **silently rejoins on next launch**,
which is the opposite of what a person who pressed "Leave" asked for. The
toast says so outright: *"Left the household room — it will not rejoin next
launch."* A stale saved code is not a convenience; it is a surprise.

## Decision 6 — one green dot, and a tooltip that is not the OS one

The header chip gets a `size-2 rounded-full bg-success` dot and a real
tooltip bubble (hover **and** `focus-within`, `pointer-events-none`,
`aria-hidden`) replacing the native `title`. The bubble carries the code and
the headcount; the chip's `aria-label` carries the same sentence, because
the label is what a screen reader — and the e2e suite — actually reads.

`success` is a **status** token, not a food hue (DESIGN.md: *"Status is not
food identity"*). It is a deliberately different green from `hue-vegetarian`
(`#137A38`) and `hue-vegan` (`#047857`) — at 8 RGB units from one of them a
green dot could have read as a dietary cue. `#116149` / `#34D399` measure
6.66:1 and 7.62:1 against `surface-sunken`, the chip they sit on.

The composable `useIconHoverTarget` is deliberately **not** used here: it
exists for `HueIcon`, whose host is pointer-transparent so a hover can never
match. The chip is a normal pointer-active element, and plain CSS
(`group` + `focus-within`) is the whole mechanism.

## Decision 7 — a join through a shared link is celebrated

A shared `?room=` link ended with a toast that was gone in three seconds,
which is indistinguishable from every other toast the app raises. Someone
who has just been handed a link by their household deserves to be told, in
one full page, that they are *in*, and to see the code they are in — because
the next thing they will do is show that code to someone else.

Gated on the `?room=` query **captured before `joinRoomFromLink` strips it**,
plus `status === 'live'` for that code. A link that fails shows the error
toast and no modal: the modal celebrates, it never excuses.

## Decision 8 — addendum (2026-10-04): the chip IS the dot, and a badge-dot for the count

Decision 6 gave the chip a dot **beside** the word "Live" plus a status
icon. The owner looked at the built header and reversed it:

> "Live shouldn't have the green dot and an icon, just the green dot is
> enough. Also on mobile any suggestions to show the number of people in
> the room?"

**8.1 — The chip is a dot and nothing else.** No word, no icon. The status
is one circle in a `size-7` round chip: `bg-success` live, `bg-text-muted`
connecting, `bg-warning` error/idle. All three class strings are LITERAL
values in a `Record<RoomStatus, string>`, because Tailwind scans source
text for complete class names (same rule as the role registry).

**8.2 — Why the label moved to `aria-label` only.** The words did not
disappear; they moved to the one carrier that already existed for them and
that no visual redesign can take away:

| carrier | text | who reads it |
| --- | --- | --- |
| `aria-label` on the chip | `Live room <code>, <N> in room` / `Connecting to the household…` / `Offline — <error>` | screen readers, and the e2e suite |
| tooltip bubble | the identical sentence | pointer and keyboard users |
| the DOT itself | nothing | everyone, at a glance |

Three reasons, in the order they mattered:

1. **Footprint.** The chip was a 14px icon plus the word "Live" plus
   padding — roughly 70px of a 412px header, of which the actual status was
   a 8px circle. ADR-0016's bottom-tab fit is e2e-pinned and the header
   shares that row's crowding.
2. **The count has to be visible on a phone, and a phone has no hover.**
   Tooltips are a desktop affordance; the owner's follow-up question was
   exactly about mobile. Whatever the count is going to be, it cannot live
   only behind `hover`.
3. **Two representations of one fact is two things to keep in step.** The
   icon, the word and the colour all encoded "live". Keeping the colour and
   dropping the other two leaves exactly one visual truth to design.

**8.3 — The badge-dot is the mobile answer to (2).** From **two** peers up,
the dot becomes a small green pill (`room-chip-count`, `h-4 min-w-4`,
`bg-success`, `text-on-success`) with the count inside, so a phone shows the
household size with no interaction at all. At one peer it stays the plain
dot: one is the ordinary case and a `1` would be noise. At
`peers === null` (never told) it stays the plain dot too — never a `0`, and
never an invented `1`.

`on-success` is a **new token**, added to DESIGN.md → `@theme` → the
`.dark` flip together, with the parity test as the gate. White on the deep
light-mode green; dark green-black on the light dark-mode green, because
white on `#34D399` measures ~1.9:1. A green pill with white digits was the
brief; on the dark theme it is not legible, so the token is what makes the
ruling survive both surfaces.

**8.4 — Colour is no longer the only signal, because the shape and the
position are.** ADR-0036 says a colour must never be the only signal, and
Decision 6 satisfied it with the word "Live". The dot alone does not, so
the mitigation is explicit rather than accidental: the chip is a
**shape change**, not a recolour — a plain 10px circle becomes a wider
rounded pill the moment the household is not a household of one — and the
full sentence stays one hover, one Tab-stop or one screen-reader stop away.
A dot-only status is a deliberate trade of glanceability for footprint,
recorded here so a later change to the chip re-litigates it rather than
inheriting it.

**8.5 — What did NOT change.** The bubble is still `display: none` when
closed, still `group-hover` + `group-focus-within`, still `max-w-56`
anchored `right-0`. The Pixel 7 overflow bug (a `visibility: hidden`
bubble still occupied layout, made the document horizontally scrollable,
and silently killed every tap on the `fixed` bottom nav) is orthogonal to
how much the chip says, and `peer-count.spec.ts` still pins the document
width. The Settings card's `· N in room` line is untouched — it is a
sentence in a panel, not a status dot.

## Decision 9 — addendum (2026-10-04): a plan-less joiner lands on the recipes list

A shared `?room=` link can be followed from any tab. Followed from /grocery,
it dropped the newcomer into a grocery list derived from a plan they had
never seen — an empty list presented as if it were theirs, which is a small
dismiss and a real one.

So: **a fresh join into an empty plan navigates to the recipes list.**
Four guards, because a router push is a visible move:

- **Fresh only.** `room.freshJoin` is armed by a **deliberate**
  `join()` / `create()` and disarmed by every other `connect()` — a
  page-reload resume and an automatic reconnect walk the identical
  `idle → connecting → live` edge, so `status` alone cannot tell them
  apart from a join somebody asked for. The signal is a **parameter of
  `connect()`**, not an assignment in `join()`: `connect()` assigns, so
  `resume()` and `scheduleReconnect()` disarm it by omission. It is also
  disarmed on every terminal failure and by `leave()`, so a failed join
  cannot navigate minutes later off a stale flag.

  The **ADR-0019 household auto-join passes `false`** (kody, review). It is
  not a join somebody tapped — it runs on *every launch* of a device that
  already has a saved room, so an armed flag there would bounce the user
  off the tab they opened once per session, which is the move this whole
  decision is trying to avoid. A `?room=` link and `Join now` are the
  deliberate joins; the auto-join is background bookkeeping.
- **Empty plan only**, read *after* the room's snapshot has landed. A
  household that HAS meals gives the joiner a plan, and they keep the tab
  they opened — which is right, because their grocery list is not empty.
- **Never on /settings.** Somebody who just tapped `Join now` is asking
  about the room, and the card's `· N in room` line under the field they
  typed into is the answer. Landing them on the recipes list navigates away
  from the confirmation of the thing they just did — three e2e failed on
  exactly this, which is how the guard got written.
- **Never from a fullscreen focus mode** (cooking / shopping have no nav to
  navigate around and their own leave-confirm), and never a no-op push when
  the recipes tab is already open.

## Decision 10 — addendum (2026-10-04): the congrats modal states the headcount

The modal celebrates a join; the count is what makes it a celebration
rather than a receipt. `peers` is passed in as a **value captured at the
live frame**, not read live from the store: `peers` frames keep arriving
while the panel is up, and a sentence that rewrites itself under someone
reading it is worse than one that is a moment out of date. `null` — never
told — omits the sentence entirely rather than claiming a household of one.

## Decision 11 — addendum (2026-10-04): a link join adopts the household

Following a `?room=` link used to be a one-night stand: the modal
celebrated the join, but `ui.householdRoom` stayed empty, so ADR-0019 had
nothing to re-join — the new member silently dropped out of the household
on the next launch, with the congrats screen as the only memory of it.

So: **the live frame of a link join saves the code as the household room.**
From that moment the device is a member in the full ADR-0019 sense — auto
re-join on every launch, the settings card carrying the code, `Leave` as
the one-tap opt-out. The save sits in the SAME gate as the congrats modal
(live, and in the code the link named), so a broken link toasts and saves
nothing.

Replacing an existing saved code is deliberate: a household's invitation
says "join US", and a device that follows it twice to two different rooms
meant the second one. `Leave` remains the way to say "not my household".

## Decision 12 — addendum (2026-10-04): the word returns beside the dot

After living with the dot-only chip, the owner reversed the word half of
Decision 8:

> "We also need to keep the text Live next to the green dot."

So the chip is **[dot | badge] + word**, and the ICON stays gone — the
owner asked for the word back, not the icon, and the icon was the element
whose only content duplicated the word. The state labels are the record
that already existed: `Live` / `Connecting` / `Offline`. The badge-dot
(8.3) and the aria-label carrier (8.2) are unchanged; 8.4's colour-only
trade-off is now moot, because the word satisfies ADR-0036 directly again.

## Alternatives considered

- **Compute `count` in each adapter.** Rejected: it is one subtraction
  duplicated in two runtimes, with no local simplification to buy, and the
  whole point of ADR-0040 is that a relay semantic lives once.
- **Derive the count client-side from push traffic.** Rejected: a household
  that has been connected but idle for a day is still *in* the room, and a
  push-derived count would report zero.
- **Count peers, deduplicate by device.** Rejected: no device identity
  exists, and it would under-report the real thing the header is for.
- **Keep `Save` as a quiet sibling of `Join now`.** Rejected: the owner's
  instruction, and the review finding — two buttons whose only difference is
  *when* the sync starts is the kind of choice a kitchen surface should not
  ask anyone to make.
- **Reuse `Adopt` as the single action** (adopt the live room, or roll a new
  one). Rejected: it cannot express "I typed my household's code", which is
  the case a second phone actually has.
- **Celebrate with a toast instead of a modal.** Rejected by the owner
  directly; a toast is also what the successful join already had.
- **Reuse the green food hue for the live dot.** Rejected: DESIGN.md forbids
  status colours reading as food identity, and the two greens are close
  enough to collide.
- **Keep the word, drop only the icon.** Rejected: the owner's ruling, and
  the footprint argument in 8.2 — with the icon gone the word was the only
  thing left in the chip that the dot did not already say.
- **Show the count in the chip at every count, including 1.** Rejected: it
  is the ordinary case on every household's first day, and a `1` next to
  the dot is permanent noise that trains people to stop reading the chip.
- **Put the count only in the Settings card.** That is what exists today,
  and it is why the owner asked: the card is two taps away and the status
  dot is where the eye already is.
- **Navigate on every join, whatever the plan.** Rejected: it moves people
  off the tab they deliberately opened for no reason. The empty plan is the
  case that is actually disorienting.
- **Navigate from /settings too.** Rejected by three e2e at once: the card
  is where a `Join now` is confirmed, so landing anywhere else deletes the
  feedback for the most deliberate join the app has.
- **Derive "fresh" from a `status` edge in the view.** Rejected: resume and
  reconnect produce the same edge, so a reload on /plan would yank the
  view — the bug the `freshJoin` signal exists to prevent, and the reason
  it is a store-level fact rather than a view-level heuristic.
- **Treat the ADR-0019 auto-join as a landing event** (kody, review). It
  looks like a fresh join — it walks the same edge and creates the room —
  but it is not *asked for* by the person on that launch, and it happens on
  every launch. `join(code, deliberate = true)` is what separates the two,
  and `autoJoinHousehold` passes `false`.
- **Read `room.peers` live inside the modal.** Rejected: the number would
  change under the reader, and the modal would need its own subscription to
  a value it opens with.
- **Save the household code before the room is live.** Rejected: a link
  that never joins would leave a dead code that ADR-0019 then chases on
  every launch — a persistent error dressed as a setting.
- **Ask the user "make this your household?" on a link join.** Rejected:
  the link IS the household's invitation, and the congrats modal already
  says "you've joined the household"; a second question would make the
  save feel like a trap.

## Implementation notes

- `success` / `success-soft` go in DESIGN.md **first**, then `@theme`, then
  the `.dark` flip; `src/lib/palette.test.ts` fails if the three drift.
- Test placement follows ADR-0040: the *decision* (the `livePeers + 1`
  arithmetic, a refusal carrying no count) is pinned in
  `relay-core/lifecycle.test.ts`; the *fan-out* is pinned at the wire level
  in `worker/room.test.ts` and through two browser contexts in e2e.
- **Timing trap in the worker suite:** the client-side `close` event takes
  ~10 s to surface through `Self` in `vitest-pool-workers`, while the DO's
  own close handler fires in ~10 ms. A departure test must await the
  surviving peer's `peers` frame, never `await peer.closed` — that exceeds
  the 5 s test timeout while the behaviour under test is already correct.

## Consequences

- The header chip and the settings status line answer "is anyone else
  here?" without a page refresh and without the client guessing.
- `peers` is a new field on `created` / `joined`: an older client ignores
  it, a newer client against an older relay reads `null` and renders the
  "unknown" state. Both directions are safe because the field is optional
  everywhere it is read.
- The room card has one primary action, so the only question left on it is
  *which room* — which is the one thing the user actually knows.
- The header is now three status colours and one sentence. Every spec that
  used to assert `toContainText('Live')` asserts the `aria-label`, and the
  badge-dot has its own `data-test` — so a regression that drops the count
  fails a nameable test rather than being argued about in review.
- `freshJoin` is a public store field, which is a cost: the store now knows
  that *somebody* cares about landing pages. It is one boolean, assigned
  only at `connect()`, and the alternative (a view-level heuristic that
  cannot tell a resume from a join) is a bug generator.