import { expect, test, type Page } from '@playwright/test'
import {
  blockExternalRequests,
  dismissJoinCongrats,
  expectZeroMealimeRequests,
  gotoTab,
  liveRoomCode,
  openFirstRecipeDetail,
  waitForCatalog,
} from './helpers'

/**
 * Phase 15 bulk add flow (ADR-0014): the typed + row is always FIRST,
 * adding is immediate and the loop never closes; every row carries its
 * live store category; every add confirms with "Added to <Category>".
 */

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page)
  await page.goto('/')
  await waitForCatalog(page)
  await gotoTab(page, 'Grocery')
})

const input = (page: Page) => page.getByTestId('add-bar-input')
const firstRow = (page: Page) => page.locator('[data-test=add-suggestion-first]')
const matchRows = (page: Page) => page.locator('[data-test=add-suggestion-row]')

test('three adds in a row: input clears & refocuses, three toasts with correct categories', async ({ page }) => {
  const box = page.locator('[data-test=ingredient-suggestions]')
  const rows = page.locator('[data-test=extra-section] li')

  // "banana" — exact index match (nameKey "banana" → Produce).
  await input(page).fill('banana')
  await expect(firstRow(page).locator('[data-test=suggestion-category]')).toHaveText('Produce')
  await firstRow(page).click()
  await expect(page.getByTestId('added-toast')).toContainText('Added to Produce')
  await expect(input(page)).toHaveValue('')
  await expect(input(page)).toBeFocused()
  await expect(rows.filter({ hasText: 'banana' })).toHaveCount(1)

  // "cottage cheese" — exact index match → Dairy, Cheese & Eggs.
  await input(page).fill('cottage cheese')
  await expect(
    firstRow(page).locator('[data-test=suggestion-category]'),
  ).toHaveText('Dairy, Cheese & Eggs')
  await firstRow(page).click()
  await expect(page.getByTestId('added-toast')).toContainText('Added to Dairy, Cheese & Eggs')
  await expect(input(page)).toHaveValue('')
  await expect(rows.filter({ hasText: 'cottage cheese' })).toHaveCount(1)

  // Unknown name → Other, still addable in the same flow.
  await input(page).fill('ziplock bags')
  await expect(firstRow(page).locator('[data-test=suggestion-category]')).toHaveText('Other')
  await firstRow(page).click()
  await expect(page.getByTestId('added-toast')).toContainText('Added to Other')
  await expect(rows.filter({ hasText: 'ziplock bags' })).toHaveCount(1)

  // The loop is still open: produce → a fourth item without ever
  // re-clicking into the form.
  await expect(input(page)).toBeFocused()
  await expectZeroMealimeRequests(page)
})

test('unknown "milk 2%" adds as Other, gets no category tag, and is remembered with its chosen category', async ({ page }) => {
  // Add it once as Other (no override). "Other" is the UNKNOWN bucket, so the
  // extra row stays plain — no category tag (ADR-0015).
  await input(page).fill('milk 2%')
  await expect(firstRow(page).locator('[data-test=suggestion-category]')).toHaveText('Other')
  await firstRow(page).click()
  await expect(page.getByTestId('added-toast')).toContainText('Added to Other')
  const milkRow = page.locator('[data-test=extra-section] li').filter({ hasText: 'milk 2%' })
  await expect(milkRow).toHaveCount(1)
  await expect(milkRow.locator('[data-test=extra-item-category-tag]')).toHaveCount(0)

  // Re-add later: the remembered custom now suggestion-matches with its
  // stored category — not a fresh Other-guess.
  await input(page).fill('milk 2')
  const mine = matchRows2(page).filter({ hasText: 'milk 2%' })
  await expect(mine).toHaveCount(1)
  await expect(mine.locator('[data-test=suggestion-category]')).toHaveText('Other')
  await expect(mine.locator('[data-test=mine-badge]')).toBeVisible()

  // Confirming with an override corrects the memory without a toast
  // (the item is already on the list — nothing new to confirm).
  await input(page).fill('milk 2%')
  await page.locator('[data-test=ingredient-category]').selectOption('Household')
  await input(page).press('Enter')
  await expect(page.getByTestId('added-toast')).toHaveCount(0)

  await input(page).fill('milk 2')
  const mineUpgraded = matchRows2(page).filter({ hasText: 'milk 2%' }).first()
  await expect(mineUpgraded.locator('[data-test=suggestion-category]')).toHaveText('Household')
  // The corrected memory now shows as a category TAG on the extra row —
  // the item itself stays in EXTRA ITEMS (never routed into Household).
  await expect(
    page.locator('[data-test=extra-section] li').filter({ hasText: 'milk 2%' }).locator('[data-test=extra-item-category-tag]'),
  ).toHaveText('#Household')
  await expect(page.locator('[data-test=grocery-section]').filter({ hasText: 'Household' })).toHaveCount(0)
})

/** Ranked rows below the typed + row (may include mine rows). */
function matchRows2(page: Page) {
  return page.locator('[data-test=add-suggestion-row]')
}

test('keyboard flow: ArrowDown highlights (typed row first), Enter adds it; Escape closes without adding', async ({ page }) => {
  const rows = page.locator('[data-test=extra-section] li')
  const box = page.locator('[data-test=ingredient-suggestions]')

  await input(page).fill('apple')
  await expect(box).toBeVisible()
  await input(page).press('ArrowDown')
  await expect(firstRow(page)).toHaveAttribute('aria-selected', 'true')

  // Enter with the typed row highlighted = adds the raw text immediately.
  await input(page).press('Enter')
  await expect(rows.filter({ hasText: 'apple' })).toHaveCount(1)
  await expect(input(page)).toHaveValue('')

  // Escape closes the dropdown and never adds anything.
  const before = await rows.count()
  await input(page).fill('never-added-item')
  await expect(box).toBeVisible()
  await input(page).press('Escape')
  await expect(box).toHaveCount(0)
  expect(await rows.count()).toBe(before)
})

test('suggestion row mirrors room-synced customs from another context', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)

  // A: plan a recipe (a shared plan is required for the room start) and
  // remember a custom name with a chosen category.
  await a.goto('/')
  await waitForCatalog(a)
  await openFirstRecipeDetail(a)
  await a.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()
  await gotoTab(a, 'Grocery')
  await input(a).fill('Sunshade tent')
  await a.locator('[data-test=ingredient-category]').selectOption('Household')
  await a.locator('[data-test=ingredient-submit]').click()
  await expect(a.getByTestId('added-toast')).toContainText('Added to Household')

  // A starts a live room from the Plan tab share sheet.
  await gotoTab(a, 'Plan')
  await a.getByRole('button', { name: 'Share', exact: true }).click()
  await a.getByTestId('start-room').click()
  const code = await liveRoomCode(a)
  const roomUrl = `${a.url().replace(/\/plan.*$/, '')}/plan?room=${code}`

  // B joins in a FRESH context and gets A's remembered customs.
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })
  await dismissJoinCongrats(b)
  await b.goto('/grocery')

  // B types a prefix — the synced custom shows as a mine row with the
  // remembered Household category.
  await input(b).fill('Sunshade')
  const mine = matchRows2(b).filter({ hasText: 'Sunshade tent' })
  await expect(mine).toHaveCount(1)
  await expect(mine.locator('[data-test=mine-badge]')).toBeVisible()
  await expect(mine.locator('[data-test=suggestion-category]')).toHaveText('Household')
})
