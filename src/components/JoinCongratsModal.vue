<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Users } from 'lucide-vue-next'

/**
 * The full-page celebration for arriving in a household through a shared
 * `?room=` link (ADR-0049).
 *
 * A toast was the old answer, and it was the wrong one: "Joining live
 * room…" is indistinguishable from every other toast the app raises, and
 * it is gone in three seconds. Someone who has just been handed a link by
 * their household is now *in*, and the next thing they will do is show
 * that code to somebody else — so the code is the most prominent thing
 * on the page, not a fragment of a sentence.
 *
 * This celebrates. It never excuses: a link that fails to join shows the
 * error toast and no modal (the caller decides by only opening this once
 * the room is actually live).
 *
 * There is no scrim click-to-dismiss and no Escape here: the only thing
 * to do is acknowledge it, and an accidental dismissal would undo the
 * one moment this screen exists for. Focus MANAGEMENT is still the full
 * job, exactly as in `NutritionModal` — `aria-modal="true"` is a promise
 * that the app underneath is unreachable, so focus MOVES into the panel
 * on open, Tab is TRAPPED inside it, and the trigger gets focus back on
 * the way out. Without that, a keyboard user who arrives by link keeps
 * tabbing through controls they cannot see.
 *
 * `peers` is the headcount the relay reported WHEN this modal opened
 * (ADR-0049 addendum), passed in as a value rather than read live: the
 * count keeps arriving on `peers` frames while the panel is up, and a
 * sentence that rewrites itself mid-read is worse than one that is a
 * moment out of date. `null` — nobody told us — omits the sentence
 * entirely rather than inventing a household of one.
 */
defineProps<{ code: string; peers: number | null }>()

const emit = defineEmits<{ (e: 'dismiss'): void }>()

const panel = ref<HTMLElement | null>(null)
let restoreFocusTo: HTMLElement | null = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(): HTMLElement[] {
  return panel.value
    ? Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
    : []
}

/** Keep Tab (and Shift+Tab) cycling the panel's own controls. */
/**
 * Keep Tab (and Shift+Tab) inside the panel.
 *
 * The trap walks `focusables()` — the CONTROLS — and never the panel
 * itself: the panel carries `tabindex="-1"`, so it is not a tab stop,
 * and appending it made `last` a node the user can never be on, which
 * silently defeated the forward wrap (review kody). The panel is instead
 * the wrap TARGET when focus is on it or outside it, which is the state
 * it is actually opened in.
 */
function trapTab(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !panel.value) return
  const stops = focusables()
  if (stops.length === 0) {
    // Nothing to reach: keep focus on the panel rather than letting it go.
    e.preventDefault()
    panel.value.focus()
    return
  }
  const first = stops[0]
  const last = stops[stops.length - 1]
  const active = document.activeElement
  if (!active || active === panel.value || !panel.value.contains(active)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
    return
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  } else if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  }
}

onMounted(() => {
  restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', trapTab)
  void nextTick(() => panel.value?.focus())
})
onUnmounted(() => {
  window.removeEventListener('keydown', trapTab)
  const target = restoreFocusTo
  restoreFocusTo = null
  if (!target) return
  void nextTick(() => {
    if (document.contains(target)) target.focus()
    else document.body.focus?.()
  })
})

function dismiss() {
  emit('dismiss')
}
</script>

<template>
  <Teleport to="body">
  <div
  class="fixed inset-0 z-40 flex items-center justify-center bg-surface-dark/50 px-6"
  data-test="join-congrats"
  >
  <div
  ref="panel"
  tabindex="-1"
  class="w-full max-w-sm space-y-4 rounded-2xl bg-surface-raised p-6 text-center shadow-xl outline-none"
  role="dialog"
  aria-modal="true"
  aria-label="Joined the household"
  data-test="join-congrats-dialog"
  >
  <Users
  :size="32"
  class="mx-auto text-success"
  aria-hidden="true"
  data-test="join-congrats-icon"
  />
  <h2 class="text-lg font-bold tracking-tight">You've joined the household</h2>
  <p
  v-if="peers !== null"
  class="text-sm font-medium text-success"
  data-test="join-congrats-peers"
  >
  {{ peers === 1 ? 'You are the first one here right now.' : `You're one of ${peers} in the room right now.` }}
  </p>
  <p class="text-sm text-text-muted">
  Share this code with the rest of your household so everyone plans in the same room.
  </p>
  <p
  class="select-all break-all rounded-xl bg-surface-sunken px-3 py-3 font-mono text-lg font-semibold tracking-tight"
  data-test="join-congrats-code"
  >
  {{ code }}
  </p>
  <button
  type="button"
  class="h-11 w-full rounded-xl bg-brand px-3 text-sm font-semibold text-on-brand active:bg-brand-strong"
  aria-label="Continue to the app"
  data-test="join-congrats-continue"
  @click="dismiss"
  >
  Continue
  </button>
  </div>
  </div>
  </Teleport>
</template>