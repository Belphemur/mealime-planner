<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, Link, Dices, Minus, Plus, Scale, Upload, Utensils } from 'lucide-vue-next'
import { applyBackup, backupFileName, buildBackupZip } from '../lib/backup'
import { generateRoomCode, normalizeRoomCode } from '../lib/roomWords'
import { MAX_SERVINGS, MIN_SERVINGS } from '../lib/servings'
import { UNIT_SYSTEMS, UNIT_SYSTEM_LABEL, type UnitSystem } from '../lib/units'
import { useShareRoomLink } from '../composables/useShareRoomLink'
import { useRoomStore } from '../stores/room'
import { useUiStore } from '../stores/ui'

/**
 * Settings (ADR-0016): the app's data surface. Backup & restore MOVED here
 * from the bottom of the Plan tab (ADR-0013 built it as a Plan section;
 * it is a data-management concern, not a plan concern, and on the Plan tab
 * it sat below a list the user reads, not edits).
 *
 * The logic is unchanged — same registry-driven zip export
 * (`buildBackupZip`) and validation-first atomic import (`applyBackup`) —
 * only the host surface moved.
 */
const ui = useUiStore()
const room = useRoomStore()
const { shareRoomLink, shareableCode } = useShareRoomLink()

/* ---------- Default servings (ADR-0037) ---------- */

/**
 * Nudge the remembered default serving size.
 *
 * Every OTHER surface that changes servings (the recipe-detail stepper,
 * the plan-row stepper) writes this same store value, so this control is
 * a direct view of it rather than a second, independent setting. The
 * store clamps; these bounds just stop the buttons walking into it.
 */
function bumpDefaultServings(delta: number) {
  const next = ui.defaultServings + delta
  if (next < MIN_SERVINGS || next > MAX_SERVINGS) return
  ui.setDefaultServings(next)
}

const canFewerDefault = computed(() => ui.defaultServings > MIN_SERVINGS)
const canMoreDefault = computed(() => ui.defaultServings < MAX_SERVINGS)

/* ---------- Unit system (ADR-0047) ---------- */

/**
 * The labels are the shared `UNIT_SYSTEM_LABEL` registry (the recipe-detail
 * toggle reads the same map); what each mode actually puts on screen is
 * spelled out in the card's note below.
 */

/** One line per mode: what the screen will actually read. */
const UNIT_SYSTEM_NOTE: Record<UnitSystem, string> = {
  dual: 'Showing the recipe exactly as authored: dual temperatures, cups as written.',
  metric: 'Showing g, kg, ml and °C; cups gain their volume (1 cup → 1 cup (240 ml)).',
  imperial: 'Showing oz, lb, fl oz and °F; cups gain their volume (1 cup → 1 cup (8 fl oz)).',
}

/** The one writer — the recipe-detail toggle writes the same store value. */
function setUnitSystem(system: UnitSystem) {
  ui.setUnitSystem(system)
}

/* ---------- Household sync (ADR-0019) ---------- */

/** Draft code, seeded from the persisted setting. */
const roomInput = ref(ui.householdRoom)
/**
 * True while the user is editing the field: Settings lives under
 * KeepAlive, so a backup import can change ui.householdRoom without a
 * remount. The store→draft echo is suppressed while typing so an import
 * never stomps an in-progress edit (qodo 4128519632); the flag resets on
 * blur and on every save path.
 */
let roomTyping = false

watch(
  () => ui.householdRoom,
  (code) => {
  if (roomTyping) return
  roomInput.value = code
  },
)

/** @input on the room field: mark the draft as user-owned until blur. */
function onRoomInput() {
  roomTyping = true
}

/** @blur on the room field: resume following the store on future changes. */
function onRoomBlur() {
  roomTyping = false
}

const householdCode = computed(() => ui.householdRoom)
/** Both shapes normalize (ADR-0021): three words, or a legacy code. */
const canJoinRoom = computed(() => {
  // An EMPTY field is joinable: it will roll a fresh code (ADR-0049). Only
  // a field the user has half-typed into nonsense is refused, so the
  // guard the room-words spec pins survives while the empty field became
  // a useful action instead of a dead end.
  const draft = roomInput.value.trim()
  return draft === '' || normalizeRoomCode(draft) !== ''
})
/** True while this device is actually connected to the saved room. */
const householdConnected = computed(
  () => room.status === 'live' && room.inRoom && room.code === ui.householdRoom,
)

/** Roll a fresh three-word code into the field (ADR-0021). */
function newRoomCode() {
  roomTyping = false
  roomInput.value = generateRoomCode()
  // The rolled code exists NOWHERE yet: joining must CREATE it on the
  // relay instead of joining (qodo 4128519644).
  rolledNewCode.value = true
}

/** The live room, else the saved setting — whichever we can share. */
const shareableCodeText = computed(() => shareableCode())

/**
 * The card's single mutation entry point (ADR-0049).
 *
 * One button, not three. `Save` and `Join now` used to differ only in
 * *when* the sync started, which is a choice nobody wants to make twice
 * for a kitchen surface; and `Adopt` existed only to point the setting at
 * a room this device was already in. All three collapse here:
 *
 *  - empty field          → roll a code into it and CREATE it
 *  - rolled here          → CREATE it (a collision re-rolls rather than
 *                           silently adopting a stranger's room)
 *  - a parseable code     → JOIN it (join-or-create, ADR-0026)
 *  - nonsense             → the button is disabled, so it cannot be pressed
 *  - already live here    → save + confirm, WITHOUT dropping the socket
 */
function joinHouseholdRoom() {
  roomTyping = false
  const draft = roomInput.value.trim()
  // Empty is not an error here: it means "I have no code yet", and the
  // answer is to mint one rather than to scold the user.
  const rolledHere = rolledNewCode.value
  const code = draft === '' ? generateRoomCode() : normalizeRoomCode(draft)
  if (!code) {
    ui.showToast('Room codes look like amber-falcon-lantern', { kind: 'error' })
    return
  }
  const isNewCode = rolledHere || draft === ''
  rolledNewCode.value = false
  roomInput.value = code
  ui.setHouseholdRoom(code)

  // Already LIVE in THIS room: reconnecting would drop a healthy socket
  // just to re-establish it, so the setting is saved and the state
  // confirmed without touching the connection. `live` and not merely
  // `inRoom`: the store keeps the code through `error`, the reconnect
  // backoff and a latched `roomGone`, and in those states the old
  // condition short-circuited to a success toast that never retried —
  // the user had to press Leave and join again to get out of a dead room.
  if (room.status === 'live' && room.inRoom && room.code === code) {
    ui.showToast(`Household sync active — ${code}`, { kind: 'household' })
    return
  }

  // From here the card OWNS the outcome: a `code_taken` re-roll moves
  // this device into a different room than the one just saved, and the
  // watcher below adopts whatever code we actually ended up in.
  pendingHouseholdJoin = true
  if (isNewCode) room.create(code)
  else room.join(code)
  // The toast carries the share action: joining and sharing are the
  // same two-phone moment (ADR-0023).
  ui.showToast(`Joining household ${code}…`, {
    kind: 'household',
    actions: [{ label: 'Share link', run: () => void shareRoomLink(code) }],
    duration: 6000,
  })
}

/**
 * True while roomInput holds a freshly ROLLED (not typed) code — see
 * newRoomCode / joinHouseholdRoom (qodo 4128519644).
 */
const rolledNewCode = ref(false)

/**
 * True between pressing `Join now` and the store settling. It is what
 * lets the card adopt a code it did not choose: a rolled code the relay
 * already holds comes back `code_taken` and the store re-rolls
 * (ADR-0021), so the room this device ends up in is NOT the one saved a
 * moment ago — and a saved code we are not in means the next launch
 * joins a stranger's empty room.
 */
let pendingHouseholdJoin = false

watch(
  () => [room.status, room.code] as const,
  ([status, code]) => {
    if (!pendingHouseholdJoin) return
    // Any terminal answer ends the wait; only a LIVE frame has a code
    // worth adopting.
    if (status !== 'live') {
      if (status === 'error' || status === 'idle') pendingHouseholdJoin = false
      return
    }
    pendingHouseholdJoin = false
    if (!code || code === roomInput.value) return
    roomTyping = false
    roomInput.value = code
    ui.setHouseholdRoom(code)
    ui.showToast(`That code was taken — using ${code} instead`, {
      kind: 'household',
      duration: 6000,
    })
  },
)

/**
 * `New code` rolls AND joins (ADR-0049): the owner's point was that a
 * rolled code which does nothing until a second press is a dead end.
 */
function newRoomCodeAndJoin() {
  newRoomCode()
  joinHouseholdRoom()
}

/**
 * `Leave` is a FULL opt-out (ADR-0049): leaving the socket while KEEPING
 * the saved code means the household silently rejoins on the next launch,
 * which is the opposite of what pressing Leave asked for.
 */
function clearHouseholdRoom() {
  roomTyping = false
  rolledNewCode.value = false
  pendingHouseholdJoin = false
  const saved = ui.householdRoom
  // Only the room this card is ABOUT. A device that is live in a
  // Plan-tab or share-link room is holding a different socket, and
  // pressing the household card's Leave asked about the household room,
  // not about whatever else happens to be connected. With no saved code
  // there is nothing else to stop joining, so the live room IS the one
  // being left.
  const leavingHousehold = room.inRoom && (saved === '' || room.code === saved)
  if (leavingHousehold) room.leave()
  ui.setHouseholdRoom('')
  roomInput.value = ''
  ui.showToast(
    leavingHousehold
      ? 'Left the household room — it will not rejoin next launch'
      : `Stopped joining ${saved} — this device stays in the room it is in`,
  )
}

/* ---------- Backup & restore (ADR-0013) ---------- */

const backupInput = ref<HTMLInputElement | null>(null)

/** File staged for import: shown in the confirm dialog before it is applied. */
const pendingBackup = ref<File | null>(null)
const backupConfirmOpen = computed(() => pendingBackup.value !== null)

function downloadBackup(): void {
  let blob: Blob
  try {
  blob = new Blob([buildBackupZip() as BlobPart], { type: 'application/zip' })
  } catch (e) {
  // Registry-coverage violation (AGENTS.md standing rule) — fail loudly.
  ui.showToast(`Backup failed — ${e instanceof Error ? e.message : 'unknown error'}`, {
  duration: 6000,
  })
  return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName()
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  ui.showToast('Backup downloaded')
}

/** Validate + apply happens ONLY after the user confirms; a rejected file
 *  (bad json / wrong app tag) mutates nothing (atomic apply). */
function confirmBackupImport(): void {
  const file = pendingBackup.value
  if (!file) return
  pendingBackup.value = null
  void file
  .arrayBuffer()
  .then((buf) => applyBackup(new Uint8Array(buf)))
  .then((result) => {
  if (!result.ok) {
  ui.showToast(`Couldn't import backup — ${result.error}`)
  return
  }
  const c = result.counts ?? { plans: 0, items: 0, history: 0, ingredients: 0, checks: 0, favourites: 0, ratings: 0 }
  ui.showToast(`Backup restored — ${c.plans} plans, ${c.items} items`)
  })
}

function onBackupInputChange(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // re-selecting the same file must fire change again
  if (file) pendingBackup.value = file
}

function cancelBackupImport(): void {
  pendingBackup.value = null
}
</script>

<template>
  <section class="space-y-4 pb-4">
  <h2 class="text-lg font-bold tracking-tight">Settings</h2>

  <!-- Unit system (ADR-0047): how quantities, grocery lines and oven
  temperatures READ on this device. The catalog stays canonical; only the
  display converts, so nothing stored ever changes. `dual` — the default —
  is the catalog exactly as authored. -->
  <div class="space-y-2 rounded-xl bg-surface p-3" data-test="unit-system-card">
  <span class="text-sm font-bold tracking-tight">Unit system</span>
  <p class="text-xs">
  Convert ingredient amounts, grocery lines and oven temperatures on this device. Your recipes, plan and checked items are
  stored in metric and stay that way.
  </p>
  <div
  class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2"
  data-test="unit-system-row"
  role="group"
  aria-label="Unit system"
  >
  <span class="flex min-w-0 items-center gap-2 text-sm font-medium">
  <Scale :size="16" aria-hidden="true" class="shrink-0 text-text-muted" />
  Measure in
  </span>
  <div class="flex shrink-0 items-center rounded-lg border">
  <button
  v-for="system in UNIT_SYSTEMS"
  :key="system"
  class="px-3 py-2 text-sm font-semibold"
  :class="
  ui.unitSystem === system
    ? 'rounded-lg bg-primary-tint text-primary-strong'
    : 'text-text-muted'
  "
  :aria-pressed="ui.unitSystem === system"
  :aria-label="`${UNIT_SYSTEM_LABEL[system]} units`"
  :data-test="`unit-system-${system}`"
  @click="setUnitSystem(system)"
  >
  {{ UNIT_SYSTEM_LABEL[system] }}
  </button>
  </div>
  </div>
  <p class="text-xs text-text-muted" data-test="unit-system-note">
  {{ UNIT_SYSTEM_NOTE[ui.unitSystem] }}
  </p>
  </div>

  <!-- Default servings (ADR-0037): the remembered starting count. Set it
  once here, or just change servings on any recipe and this follows. -->
  <div class="space-y-2 rounded-xl bg-surface p-3" data-test="default-servings-card">
  <span class="text-sm font-bold tracking-tight">Default servings</span>
  <p class="text-xs">
  New recipes, generated plans and re-planned meals start at this number. Changing servings on a recipe or on a planned meal
  remembers it here for next time.
  </p>
  <div
  class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2"
  data-test="default-servings-row"
  >
  <span class="flex min-w-0 items-center gap-2 text-sm font-medium">
  <Utensils :size="16" aria-hidden="true" class="shrink-0 text-text-muted" />
  Servings per recipe
  </span>
  <div class="flex shrink-0 items-center rounded-lg border">
  <button
  class="flex size-11 items-center justify-center"
  :disabled="!canFewerDefault"
  aria-label="Fewer default servings"
  data-test="default-servings-fewer"
  @click="bumpDefaultServings(-1)"
  >
  <Minus :size="16" aria-hidden="true" />
  </button>
  <span
  class="w-8 text-center text-sm font-semibold tabular-nums"
  aria-label="Default servings"
  data-test="default-servings-value"
  >{{ ui.defaultServings }}</span
  >
  <button
  class="flex size-11 items-center justify-center"
  :disabled="!canMoreDefault"
  aria-label="More default servings"
  data-test="default-servings-more"
  @click="bumpDefaultServings(1)"
  >
  <Plus :size="16" aria-hidden="true" />
  </button>
  </div>
  </div>
  <p class="text-xs text-text-muted" data-test="default-servings-note">
  Recipes already in your plan keep the servings they were added with.
  </p>
  </div>

  <!-- Household sync: set a room code once and this device re-joins it
  on every launch, so the other phone needs no share link. The room
  itself is unchanged (ephemeral relay, LWW state, ADR-0006/0011) —
  this is only a persisted default join target (ADR-0019). -->
  <div class="space-y-2 rounded-xl bg-surface p-3" data-test="household-card">
  <span class="text-sm font-bold tracking-tight">Household sync</span>
  <p class="text-xs">
  Sync your plan, grocery checks, extras and recipe filters with the other phone. Join once — this device re-joins the room automatically every time the app opens.
  </p>
  <!-- Status is shown only while CONNECTED (ADR-0049): "active" while the
       socket is down would be a claim the relay has not made. The headcount
       is the relay's number, and `null` (not told yet) is worded as
       absence rather than as one person. -->
  <p
  v-if="householdConnected"
  class="text-xs font-semibold text-text"
  data-test="household-room-status"
  >
  Household sync active — {{ householdCode }}<template v-if="room.peers"> · {{ room.peers }} in room</template>
  </p>
  <!-- Always rendered, never behind a saved-room condition: the note
  on the History tab points here, and a member in a Plan-tab
  room (or with no household code yet) must still be able to
  opt out. The control only means anything once a room exists,
  which the surrounding card says out loud. -->
  <div
  class="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2"
  data-test="history-sharing-row"
  >
  <label class="flex min-w-0 flex-1 items-start gap-2 text-xs">
  <input
  v-model="ui.shareCookedHistory"
  type="checkbox"
  class="mt-0.5 size-4 shrink-0"
  aria-label="Share cooked history with the household room"
  data-test="share-cooked-history"
  />
  <span>
  Sync <strong>cooked history</strong> with the household.
  <span class="block">
  On by default — everyone in the room shares one cooking log, and histories merge rather than replace.
  Turn this off to stop sharing new cooks: this device will no longer send its history to the room, and future snapshots won't include it. Cooks shared earlier stay in the room — sharing only controls what goes out from here.
  </span>
  </span>
  </label>
  </div>
  <div class="flex gap-2">
  <input
  v-model="roomInput"
  type="text"
  inputmode="text"
  maxlength="40"
  placeholder="amber-falcon-lantern"
  aria-label="Household room code"
  data-test="household-room-input"
  @input="onRoomInput"
  @blur="onRoomBlur"
  class="h-11 min-w-0 flex-1 rounded-xl border bg-surface-raised px-3 text-sm outline-none focus:border-brand-text"
  />
  <button
  class="h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand active:bg-brand-strong disabled:opacity-50"
  data-test="household-room-join"
  aria-label="Save this household room code and join it now"
  :disabled="!canJoinRoom"
  @click="joinHouseholdRoom"
  >
  Join now
  </button>
  </div>
  <div class="flex flex-wrap gap-2">
  <button
  class="h-11 rounded-lg border px-3 text-xs font-medium disabled:opacity-50"
  data-test="share-room"
  :disabled="!shareableCodeText"
  :aria-label="`Share the join link for household room ${shareableCodeText}`"
  @click="shareRoomLink()"
  >
  <Link :size="14" aria-hidden="true" class="mr-1 inline" />
  Share room link
  </button>
  <button
  class="h-11 rounded-lg bg-brand px-3 text-xs font-semibold text-on-brand active:bg-brand-strong"
  data-test="household-room-new"
  aria-label="Generate a new three-word room code and join it"
  @click="newRoomCodeAndJoin"
  >
  <Dices :size="14" aria-hidden="true" class="mr-1 inline" />
  New code
  </button>
  <button
  v-if="householdCode || room.inRoom"
  class="h-11 rounded-lg border px-3 text-xs font-medium"
  data-test="household-room-clear"
  aria-label="Leave the household room and stop joining it on future launches"
  @click="clearHouseholdRoom"
  >
  Leave
  </button>
  </div>
  </div>

  <!-- Backup & restore: ALWAYS rendered (restoring a backup is precisely
  what a fresh device needs, and this view is reachable on one). -->
  <div class="space-y-2 rounded-xl bg-surface p-3">
  <span class="text-sm font-bold tracking-tight">Backup &amp; restore</span>
  <p class="text-xs">
  Save everything (plan, groceries, history, favourites, settings) to a file — or restore one. Works fully offline.
  </p>
  <div class="flex gap-2">
  <button
  class="flex h-11 flex-1 items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand active:bg-brand-strong"
  data-test="export-settings"
  aria-label="Download backup file"
  @click="downloadBackup"
  >
  <Download :size="16" aria-hidden="true" class="mr-1 inline" />
  Export backup
  </button>
  <button
  class="flex h-11 flex-1 items-center justify-center rounded-xl border px-4 text-sm font-medium"
  data-test="import-settings"
  aria-label="Choose a backup file to restore"
  @click="backupInput?.click()"
  >
  <Upload :size="16" aria-hidden="true" class="mr-1 inline" />
  Import backup
  </button>
  </div>
  <input
  ref="backupInput"
  type="file"
  accept="application/zip,.zip"
  class="hidden"
  aria-label="Backup file picker"
  data-test="import-settings-input"
  @change="onBackupInputChange"
  />
  </div>

  <p class="px-1 text-xs text-text-muted">
  Everything lives on this device — the app never talks to a server about your data, so a backup file is the
  only way to move it.
  </p>

  <!-- Import-backup confirm dialog -->
  <div
  v-if="backupConfirmOpen"
  class="fixed inset-0 z-50 flex items-center justify-center bg-surface-dark/50 p-4"
  @click.self="cancelBackupImport"
  >
  <div
  class="w-full max-w-md space-y-3 rounded-2xl bg-surface-raised p-4 shadow-xl"
  role="dialog"
  aria-label="Confirm backup restore"
  >
  <h3 class="text-sm font-bold tracking-tight">Restore this backup?</h3>
  <p class="text-xs">
  This overwrites your current plan, checked items, cooked history, favourites, custom ingredients and settings with the backup’s contents. Recipe ratings are merged instead — a rating you set after the backup was taken is kept.
  </p>
  <p class="truncate text-xs">
  {{ pendingBackup?.name }}
  </p>
  <div class="flex gap-2">
  <button
  class="h-11 flex-1 rounded-xl border text-sm font-medium"
  data-test="import-settings-cancel"
  aria-label="Cancel restore"
  @click="cancelBackupImport"
  >
  Cancel
  </button>
  <button
  class="h-11 flex-1 rounded-xl bg-brand text-sm font-semibold text-on-brand active:bg-brand-strong"
  data-test="import-settings-confirm"
  aria-label="Restore backup"
  @click="confirmBackupImport"
  >
  Restore
  </button>
  </div>
  </div>
  </div>
  </section>
</template>
