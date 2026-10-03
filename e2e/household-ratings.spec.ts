import { expect, test, type Page } from '@playwright/test'
import {
  blockExternalRequests,
  dismissJoinCongrats,
  expectZeroMealimeRequests,
  gotoTab,
  liveRoomCode,
  openFirstRecipeDetail,
  recipeCards,
  waitForCatalog,
} from './helpers'

/**
 * Household favourites + per-recipe ratings (ADR-0031).
 *
 * Favourites seed from the user's own Mealime snapshot on first run and
 * are shared as a UNION; ratings are a NEW store seeded empty (a rating
 * is opinion, never catalog truth) and reconcile per record, newest
 * `updatedAt` wins. The Auto-Plan pin must NOT move for a fresh profile:
 * the new weights are a no-op without household preference.
 */

// Same contract as e2e/auto-plan.spec.ts, same value: the generation-0
// DINNER pack after the 2,759-recipe sync. Only the ORDER within the pack
// moved (the 9889/6389 pair swapped), which is the seed ranking re-sorting
// inside the eligible slice — not a different pack. See
// `bun run scripts/probe_autoplan_pin.ts`.
const PINNED_DEFAULT_IDS = [17452, 9889, 6389, 6167]

type RatingRecord = { rating: number; count: number; updatedAt: number }

/** The persisted ratings record, keyed by variant id as a string. */
async function ratingsOf(page: Page): Promise<Record<string, RatingRecord>> {
  return page.evaluate(() => {
    const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
    return (pinia?.state?.value?.ratings?.map ?? {}) as Record<string, { rating: number; count: number; updatedAt: number }>
  })
}

/**
 * The starred ids, MATERIALIZED from the store's tombstone records
 * (`ids` is a computed in ADR-0031, so it is not part of Pinia state).
 */
async function favouritesOf(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
    const records = pinia?.state?.value?.favourites?.records ?? {}
    return Object.entries(records)
      .filter(([, r]) => (r as { favorited: boolean }).favorited)
      .map(([id]) => Number(id))
      .sort((x, y) => x - y)
  })
}

/** A card that is NOT yet a favourite, so the tap is an add. */
function unfavouritedCard(page: Page) {
  return recipeCards(page)
    .filter({ has: page.getByRole('button', { name: 'Add to favourites' }) })
    .first()
}

/** Plan the first recipe, so the Plan tab renders its share affordance. */
async function planFirstRecipe(page: Page): Promise<string> {
  await gotoTab(page, 'Recipes')
  const name = await openFirstRecipeDetail(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()
  return name
}

/** Start a live room from A's plan tab share sheet; returns the room link. */
async function startLiveRoom(page: Page): Promise<string> {
  await gotoTab(page, 'Plan')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByTestId('start-room').click()
  const code = await liveRoomCode(page)
  const url = `${page.url().replace(/\/plan.*$/, '')}/plan?room=${code}`
  // The share sheet is a modal that would swallow the next nav click; the
  // room survives a full navigation (the code lives in sessionStorage).
  await page.goto('/')
  await waitForCatalog(page)
  return url
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page)
  await page.goto('/')
  await waitForCatalog(page)
})

test('a fresh profile stars nothing — a rating is never seeded from the catalog', async ({ page }) => {
  expect(await ratingsOf(page)).toEqual({})
  // Favourites, by contrast, ARE seeded (the user's own snapshot).
  expect((await favouritesOf(page)).length).toBeGreaterThan(0)
  // The catalog hint is shown, not stored: no stars are filled.
  const first = recipeCards(page).first()
  await expect(first.getByTestId('rating-stars')).toHaveAttribute('data-rating', '0')
  await expectZeroMealimeRequests(page)
})

test('rate a recipe half a star at a time; it survives a reload', async ({ page }) => {
  const card = recipeCards(page).first()
  const id = await card.getAttribute('data-variant-id')
  const stars = card.getByTestId('rating-stars')

  // The right half of the 4th slot = 4 stars exactly.
  await card.getByRole('button', { name: 'Rate 4 of 5 stars' }).click()
  await expect(stars).toHaveAttribute('data-rating', '4')
  // The LEFT half of the 4th slot = 3.5.
  await card.getByRole('button', { name: 'Rate 3.5 of 5 stars' }).click()
  await expect(stars).toHaveAttribute('data-rating', '3.5')

  // Half steps are the persisted grid, and the write is stamped.
  const record = (await ratingsOf(page))[id!]
  expect(record.rating).toBe(3.5)
  expect(record.count).toBe(1)
  expect(record.updatedAt).toBeGreaterThan(0)

  await page.reload()
  await waitForCatalog(page)
  await expect(recipeCards(page).first().getByTestId('rating-stars')).toHaveAttribute(
    'data-rating',
    '3.5',
  )
  // Re-rating replaces the value and keeps the household count.
  await recipeCards(page).first().getByRole('button', { name: 'Rate 5 of 5 stars' }).click()
  const after = (await ratingsOf(page))[id!]
  expect(after.rating).toBe(5)
  expect(after.count).toBe(1)
  expect(after.updatedAt).toBeGreaterThanOrEqual(record.updatedAt)
  await expectZeroMealimeRequests(page)
})

test('hover previews a rating and a tooltip, and never writes one (ADR-0040)', async ({
  page,
  isMobile,
}) => {
  // A hover affordance is mouse-only by design: `hovercap:` is
  // `@media (hover: hover)`, so on the touch project there is no bubble
  // to assert and the case is meaningless, not failing.
  test.skip(isMobile === true, 'hover affordance, asserted on desktop')
  const card = recipeCards(page).first()
  const stars = card.getByTestId('rating-stars')

  const slot = card.getByRole('button', { name: 'Rate 4 of 5 stars' })
  await slot.hover()

  // The preview bubble says the SAME string the slot's aria-label carries
  // — one source of truth, so they cannot drift.
  const bubble = card.getByTestId('rating-preview')
  await expect(bubble).toBeVisible()
  await expect(bubble).toHaveText(/Rate 4 of 5 stars/)

  // Previewing is NOT rating: the committed value is untouched, and
  // nothing reached the store.
  await expect(stars).toHaveAttribute('data-rating', '0')
  expect(await ratingsOf(page)).toEqual({})

  // Mouse-out reverts instantly. Moving to a neutral corner is the only
  // honest way to do it: the card is covered by its own stretched link,
  // so hovering a sibling "safely" retries forever (and the sticky header
  // can cover a card scrolled under it).
  await page.mouse.move(2, 2)
  await expect(bubble).toHaveCount(0)
  await expect(stars).toHaveAttribute('data-rating', '0')

  // Tap still commits exactly as before.
  await slot.click()
  await expect(stars).toHaveAttribute('data-rating', '4')
  await expectZeroMealimeRequests(page)
})

test('a tap on a phone never opens a preview bubble', async ({ page, isMobile }) => {
  // The other half of ADR-0040's "desktop only": a phone tap FOCUSES the
  // half-slot button, so an ungated `group-focus-within` reveal would pop
  // the bubble on exactly the device the affordance is excluded from.
  // This case is the regression guard for that, and it is the only place
  // the touch project can say anything useful about a hover affordance.
  test.skip(isMobile !== true, 'touch project only')
  const card = recipeCards(page).first()
  const slot = card.getByRole('button', { name: 'Rate 4 of 5 stars' })
  await slot.tap()

  // The tap rates (that is the whole touch contract) and the bubble is
  // still hidden: the reveal is `hovercap:`-gated, and this viewport
  // never matches `(hover: hover)`.
  await expect(card.getByTestId('rating-stars')).toHaveAttribute('data-rating', '4')
  await expect(card.getByTestId('rating-preview')).toBeHidden()
  await expect(page.locator('[data-test="icon-tooltip"]').first()).toBeHidden()
})

test('tapping a star does not open the recipe', async ({ page }) => {
  const card = recipeCards(page).first()
  await card.getByRole('button', { name: 'Rate 2 of 5 stars' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(card.getByTestId('rating-stars')).toHaveAttribute('data-rating', '2')
})

test('room: a favourite and a rating reach the other phone live', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)
  await a.goto('/')
  await waitForCatalog(a)

  const name = await planFirstRecipe(a)
  const roomUrl = await startLiveRoom(a)

  // A rates the recipe, THEN B joins: B must see the star it did not cast.
  const cardA = recipeCards(a).filter({ has: a.getByRole('heading', { name, exact: true }) })
  const variantId = (await cardA.getAttribute('data-variant-id'))!
  await cardA.getByRole('button', { name: 'Rate 4.5 of 5 stars' }).click()

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })
  await dismissJoinCongrats(b)
  await gotoTab(b, 'Recipes')
  const cardB = recipeCards(b).filter({ has: b.getByRole('heading', { name, exact: true }) })
  await expect(cardB.getByTestId('rating-stars')).toHaveAttribute('data-rating', '4.5')

  // B stars it and rates a DIFFERENT recipe: A must see both, and A's own
  // rating must survive B's push (per-record reconcile, never a wipe).
  await cardB.getByRole('button', { name: 'Add to favourites' }).click()
  const other = recipeCards(b)
    .filter({ hasNot: b.getByRole('heading', { name, exact: true }) })
    .first()
  await other.getByRole('button', { name: 'Rate 1 of 5 stars' }).click()

  await expect
    .poll(async () => (await favouritesOf(a)).includes(Number(variantId)), { timeout: 10_000 })
    .toBe(true)
  await expect
    .poll(async () => Object.keys(await ratingsOf(a)).length, { timeout: 10_000 })
    .toBe(2)
  const aRatings = await ratingsOf(a)
  expect(aRatings[variantId]).toMatchObject({ rating: 4.5, count: 1 })
  await expectZeroMealimeRequests(a)
  await expectZeroMealimeRequests(b)
})

test('room: the LAST rating written wins, and both devices agree', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)
  await a.goto('/')
  await waitForCatalog(a)
  const name = await planFirstRecipe(a)
  const roomUrl = await startLiveRoom(a)

  // A rates it 4 at t0.
  const cardA = recipeCards(a).filter({ has: a.getByRole('heading', { name, exact: true }) })
  const variantId = (await cardA.getAttribute('data-variant-id'))!
  await cardA.getByRole('button', { name: 'Rate 4 of 5 stars' }).click()
  const aFirst = (await ratingsOf(a))[variantId]

  // B joins and rates the SAME recipe 5, later. A must adopt the newer
  // record verbatim — and the two devices must end up byte-identical, or
  // the count-weighted scoring drifts apart per device.
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })
  await dismissJoinCongrats(b)
  await gotoTab(b, 'Recipes')
  const cardB = recipeCards(b).filter({ has: b.getByRole('heading', { name, exact: true }) })
  await cardB.getByRole('button', { name: 'Rate 5 of 5 stars' }).click()

  await expect
    .poll(async () => (await ratingsOf(a))[variantId]?.rating, { timeout: 10_000 })
    .toBe(5)
  const merged = (await ratingsOf(a))[variantId]
  expect(merged.updatedAt).toBeGreaterThan(aFirst.updatedAt)
  // Adopted verbatim, count included: an increment on receive is not
  // idempotent under replay and leaves peers disagreeing.
  expect(merged.count).toBe(1)
  // Both devices now hold the same record.
  expect((await ratingsOf(b))[variantId]).toEqual(merged)
  await expectZeroMealimeRequests(a)
  await expectZeroMealimeRequests(b)
})

test('a fresh profile leaves the Auto-Plan pin untouched (ADR-0031)', async ({ page }) => {
  // The new weights are a no-op without household preference: the pin is
  // the contract that proves the pure lib is unchanged for a pristine
  // device (an empty rating set, and favourites the user has not touched
  // beyond their own first-run seed).
  expect(await ratingsOf(page)).toEqual({})

  await gotoTab(page, 'Plan')
  await page.getByTestId('auto-plan-button').first().click()
  await expect(page.getByTestId('auto-plan-dialog')).toBeVisible()
  await page.getByTestId('auto-plan-count').fill('4')
  await page.getByTestId('auto-plan-count').blur()
  await page.getByTestId('auto-plan-generate').click()
  await expect(page.getByTestId('auto-plan-confirm')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('auto-plan-household-note')).toContainText(
    'Ranked with your household’s ratings',
  )
  await page.getByTestId('auto-plan-confirm').click()
  await expect(page.getByTestId('auto-plan-dialog')).toBeHidden()

  const ids = await page.evaluate(() => {
    const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
    const entries = pinia?.state?.value?.plan?.plan ?? []
    return entries.map((e: { variantId: number }) => e.variantId)
  })
  expect(ids).toEqual(PINNED_DEFAULT_IDS)
  await expectZeroMealimeRequests(page)
})

test('room: an un-star reaches the other phone and is not resurrected', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)
  await a.goto('/')
  await waitForCatalog(a)
  await planFirstRecipe(a)
  const roomUrl = await startLiveRoom(a)

  // A stars a recipe nobody else has; B (fresh context, no seed) joins.
  const target = unfavouritedCard(a)
  const name = (await target.getByRole('heading').textContent())!.trim()
  const variantId = Number(await target.getAttribute('data-variant-id'))
  await target.getByRole('button', { name: 'Add to favourites' }).click()

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })
  await dismissJoinCongrats(b)
  await gotoTab(b, 'Recipes')
  const cardB = recipeCards(b).filter({ has: b.getByRole('heading', { name, exact: true }) })
  await expect(cardB.getByRole('button', { name: 'Remove from favourites' })).toBeVisible()

  // B un-stars it: A must follow. A's own next push must NOT bring it back
  // (the delete anomaly a bare union would have had).
  await cardB.getByRole('button', { name: 'Remove from favourites' }).click()
  await expect
    .poll(async () => (await favouritesOf(a)).includes(variantId), { timeout: 10_000 })
    .toBe(false)

  // A pushes again (a star on a DIFFERENT recipe) — the un-star must
  // survive the echo. (A tombstoned card still renders "Add to
  // favourites", so the "other" card must be excluded explicitly.)
  const otherCard = recipeCards(a)
    .filter({ has: a.getByRole('button', { name: 'Add to favourites' }) })
    .filter({ hasNot: a.locator(`[data-variant-id="${variantId}"]`) })
    .first()
  await otherCard.getByRole('button', { name: 'Add to favourites' }).click()
  await a.waitForTimeout(1_500)
  expect((await favouritesOf(a)).includes(variantId)).toBe(false)
  await expectZeroMealimeRequests(a)
  await expectZeroMealimeRequests(b)
})
