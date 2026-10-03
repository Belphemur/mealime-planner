import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { classifyDiets, type DietId } from '../src/lib/dietFilter'

/** Repo root, resolved from this file (e2e/helpers.ts). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Hosts the app must never contact — it is fully offline. */
const FORBIDDEN_HOSTS = /(^|\.)mealime\.com$/

/**
 * Install route interception that fails any request to mealime.com hosts and
 * records the attempts. Assert with `expectZeroMealimeRequests(page)`.
 */
export async function blockExternalRequests(page: Page): Promise<void> {
  const attempts = (page as Page & { __mealimeAttempts?: string[] }).__mealimeAttempts ?? []
  ;(page as Page & { __mealimeAttempts?: string[] }).__mealimeAttempts = attempts
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname
    if (FORBIDDEN_HOSTS.test(host)) {
      attempts.push(route.request().url())
      return route.abort('blocked_by_client')
    }
    return route.continue()
  })
}

/** Assert that zero requests were made to mealime.com hosts. */
export async function expectZeroMealimeRequests(page: Page): Promise<void> {
  const attempts = (page as Page & { __mealimeAttempts?: string[] }).__mealimeAttempts ?? []
  expect(attempts, `requests to mealime.com hosts: ${attempts.join(', ')}`).toEqual([])
}

/**
 * Wait for the catalog to finish loading (recipe cards render).
 * Returns the list of recipe card articles.
 */
export function recipeCards(page: Page) {
  return page.locator('main article')
}

export async function waitForCatalog(page: Page): Promise<void> {
  await expect(recipeCards(page).first()).toBeVisible({ timeout: 15_000 })
}

/**
 * The code of the live room the header chip is showing.
 *
 * Read from the chip's `aria-label` (ADR-0049), which is now the ONLY
 * place the chip says anything: the chip itself is a dot, and the owner's
 * ruling took the word "Live" and the room code out of the header. The
 * label is the thing a screen reader announces and the thing the tooltip
 * bubble repeats, so a spec that scrapes it asserts the same sentence the
 * user is shown.
 */
export async function liveRoomCode(page: Page): Promise<string> {
  const chip = page.getByTestId('room-chip')
  await expect(chip).toHaveAttribute('aria-label', /^Live room /, { timeout: 15_000 })
  const label = await chip.getAttribute('aria-label')
  const code = label?.match(/Live room ([a-z0-9-]+)/i)?.[1]
  if (!code) throw new Error(`room chip carries no code: aria-label=${label}`)
  return code
}

/**
 * Acknowledge the congrats modal that a shared `?room=` link raises
 * (ADR-0049), the way a person arriving on that link would.
 *
 * A no-op when the modal is not up, so a spec can call it after ANY link
 * open without first having to know whether this page came through a link
 * or through the household auto-join (ADR-0019, which must NOT open it).
 */
export async function dismissJoinCongrats(page: Page): Promise<void> {
  const modal = page.getByTestId('join-congrats')
  if ((await modal.count()) === 0) return
  await page.getByTestId('join-congrats-continue').click()
  await expect(modal).toHaveCount(0)
}

/**
 * The number the relay reports as live in this device's room, read off the
 * chip's `aria-label` (ADR-0049).
 *
 * The chip is a DOT, so the headcount has exactly one textual carrier —
 * `Live room <code>, <N> in room` — and that is what this reads. The
 * badge-dot (`room-chip-count`) is the same number rendered visually when
 * the count is 2 or more, but it is absent at 1, so it cannot be the
 * thing a helper waits on. Polled, because the count arrives on a `peers`
 * frame sent by a second socket.
 */
export async function liveRoomPeers(page: Page, timeout = 15_000): Promise<number> {
  const chip = page.getByTestId('room-chip')
  await expect(chip).toBeAttached({ timeout })
  await expect
    .poll(
      async () => {
        const label = (await chip.getAttribute('aria-label')) ?? ''
        const n = label.match(/, (\d+) in room/)?.[1]
        return n === undefined ? null : Number(n)
      },
      { timeout, message: 'the room chip never reported a headcount' },
    )
    .not.toBeNull()
  const label = (await chip.getAttribute('aria-label')) ?? ''
  return Number(label.match(/, (\d+) in room/)![1])
}

/** Open the first recipe card and wait for the detail sheet. Returns the recipe name. */
export async function openFirstRecipeDetail(page: Page): Promise<string> {
  await recipeCards(page).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  return (await sheet.getByRole('heading', { level: 2 }).textContent())!.trim()
}

/** Open the first recipe card matching `name` and wait for the detail sheet. */
export async function openRecipeDetail(page: Page, name: string | RegExp): Promise<void> {
  await recipeCards(page).filter({ has: page.getByRole('heading', { name }) }).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  return
}

export async function gotoTab(
  page: Page,
  label: 'Recipes' | 'Plan' | 'Grocery' | 'History' | 'Settings',
): Promise<void> {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label }).click()
}

/* ---------- Diet classifier reference sets (ADR-0018) ---------- */

interface SnapshotMeta {
  id: number
  name: string
  ingredient_names: string[]
}

let snapshot: SnapshotMeta[] | null = null

/** The frozen catalog's variant metadata, read straight off disk. */
function catalogSnapshot(): SnapshotMeta[] {
  if (!snapshot) {
    const raw = readFileSync(resolve(REPO_ROOT, 'public/data/builder_data.json'), 'utf8')
    snapshot = (JSON.parse(raw) as { variant_meta: SnapshotMeta[] }).variant_meta
  }
  return snapshot
}

const dietSets = new Map<DietId, Set<number>>()

/**
 * Variant ids passing each diet rule, computed with the SAME classifier the
 * app uses (imported from src), so the assertions can never drift from the
 * UI. Membership is the contract — the counts are a heuristic (ADR-0018).
 */
export function dietIdSet(diet: DietId): Set<number> {
  const cached = dietSets.get(diet)
  if (cached) return cached
  const set = new Set<number>()
  for (const meta of catalogSnapshot()) {
    if (classifyDiets(meta.ingredient_names)[diet]) set.add(meta.id)
  }
  dietSets.set(diet, set)
  return set
}

/** Variant ids of the recipe cards currently rendered on the Recipes tab. */
export async function visibleVariantIds(page: Page): Promise<number[]> {
  return recipeCards(page).evaluateAll((nodes) =>
    nodes.map((n) => Number((n as HTMLElement).dataset.variantId)),
  )
}
