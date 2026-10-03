import { expect, test, type Page } from '@playwright/test'
import {
  blockExternalRequests,
  dietIdSet,
  dismissJoinCongrats,
  expectZeroMealimeRequests,
  gotoTab,
  liveRoomCode,
  openFirstRecipeDetail,
  recipeCards,
  visibleVariantIds,
  waitForCatalog,
} from './helpers'

/**
 * Phase 17 spec: waste-aware container units (ADR-0017), diet filter chips
 * (ADR-0018) and the persistent household room (ADR-0019).
 *
 * Every test runs fully offline: no mealime.com request is ever allowed,
 * and the expectations are computed from the same frozen data + the same
 * pure libs the app uses, so they cannot drift.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page)
  await page.goto('/')
  await waitForCatalog(page)
})

/** The "N recipes" paragraph on the Recipes tab (the filtered result count). */
function resultCount(page: Page) {
  return page.locator('p', { hasText: /\d+ recipes?/ })
}

/** Wait until the Recipes tab shows exactly `n` matching recipes. */
async function expectResultCount(page: Page, n: number) {
  await expect(resultCount(page)).toContainText(`${n} recipes`, { timeout: 15_000 })
}

/** The app shell is up: the catalog finished loading, the nav is clickable. */
async function waitForApp(page: Page) {
  await expect(page.getByText('Loading…')).toBeHidden({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
}

/* ------------------------------------------------------------------ *
 * Feature B — diet filter (ADR-0018)
 * ------------------------------------------------------------------ */

test.describe('diet filter chips', () => {
  test('no-pork chip excludes pork recipes and keeps the clean ones', async ({ page }) => {
    const chip = page.getByTestId('diet-chip-no-pork')
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('aria-pressed', 'false')

    const porkFree = dietIdSet('no-pork')
    // Read the catalog size rather than pinning a literal: a catalog sync adds
    // recipes (2,730 -> 2,759), and a stale constant would rot silently.
    const total = Number(
      (await page.evaluate(async () => {
        const data = await fetch('/data/builder_data.json').then((r) => r.json())
        return (data.feasible_variants as number[]).length
      }))
    )
    const porkRecipes = total - porkFree.size
    expect(porkRecipes).toBeGreaterThan(0) // the rule has teeth

    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expectResultCount(page, porkFree.size)

    const shown = await visibleVariantIds(page)
    expect(shown.length).toBeGreaterThan(0)
    for (const id of shown) expect(porkFree.has(id), `variant ${id} must be pork-free`).toBe(true)
    await expectZeroMealimeRequests(page)
  })

  test('vegan chip has a non-zero count and lists only vegan recipes', async ({ page }) => {
    const chip = page.getByTestId('diet-chip-vegan')
    await expect(chip).toBeVisible()

    // The chip count comes from the same classifier (ADR-0018).
    const label = (await chip.textContent()) ?? ''
    const vegan = dietIdSet('vegan')
    const count = Number(label.replace(/[^\d]/g, ''))
    expect(count).toBeGreaterThan(0)
    expect(count).toBe(vegan.size)

    await chip.click()
    await expectResultCount(page, vegan.size)
    const shown = await visibleVariantIds(page)
    expect(shown.length).toBeGreaterThan(0)
    for (const id of shown) expect(vegan.has(id), `variant ${id} must be vegan`).toBe(true)
    await expectZeroMealimeRequests(page)
  })

  test('multi-select is an intersection and survives a reload', async ({ page }) => {
    const shellfishFree = dietIdSet('no-shellfish')
    const veg = dietIdSet('vegetarian')
    const intersection = [...shellfishFree].filter((id) => veg.has(id))
    expect(intersection.length).toBeGreaterThan(0)

    await page.getByTestId('diet-chip-no-shellfish').click()
    await expectResultCount(page, shellfishFree.size)
    await page.getByTestId('diet-chip-vegetarian').click()
    await expectResultCount(page, intersection.length)

    const shown = await visibleVariantIds(page)
    for (const id of shown) {
      expect(intersection.includes(id), `variant ${id} must satisfy both rules`).toBe(true)
    }

    // Persisted in the ui slice (ADR-0013 registry) — both chips come back.
    await page.reload()
    await waitForCatalog(page)
    await expect(page.getByTestId('diet-chip-no-shellfish')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('diet-chip-vegetarian')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('diet-chip-vegan')).toHaveAttribute('aria-pressed', 'false')
    await expectResultCount(page, intersection.length)
    const after = await visibleVariantIds(page)
    for (const id of after) expect(intersection.includes(id)).toBe(true)
    await expectZeroMealimeRequests(page)
  })

  test('clear filters resets the chips', async ({ page }) => {
    await page.getByTestId('diet-chip-vegan').click()
    await expect(page.getByTestId('diet-chip-vegan')).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.getByTestId('diet-chip-vegan')).toHaveAttribute('aria-pressed', 'false')
  })

  test('a filtered recipe detail still opens offline', async ({ page }) => {
    await page.getByTestId('diet-chip-vegan').click()
    await expectResultCount(page, dietIdSet('vegan').size)
    const name = await openFirstRecipeDetail(page)
    expect(name.length).toBeGreaterThan(0)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectZeroMealimeRequests(page)
  })
})

/* ------------------------------------------------------------------ *
 * Feature A — waste-aware container quantities (ADR-0017)
 * ------------------------------------------------------------------ */

/**
 * Two frozen recipes that each ask for `½ small bunch cilantro` — the
 * exact case the ADR is about. Neither has a second cilantro-ish line, so
 * the grocery row is unambiguous.
 */
const HALF_BUNCH_A = 38322
const HALF_BUNCH_B = 30774

/** Deep-link to a recipe, add it to the plan, return to the Recipes tab. */
async function addVariantToPlan(page: Page, variantId: number) {
  await page.goto(`/recipe/${variantId}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Add to plan' }).click()
  await page.goto('/')
  await waitForCatalog(page)
}

function cilantroRow(page: Page) {
  // Match the ingredient NAME span exactly: a shared ingredient's
  // provenance pill quotes the recipe titles, which contain "Cilantro".
  return page.getByTestId('grocery-row').filter({
    has: page.getByText('cilantro', { exact: true }),
  })
}

test.describe('container units in the grocery list', () => {
  test('a single meal keeps the authored package fraction', async ({ page }) => {
    await addVariantToPlan(page, HALF_BUNCH_A)
    await gotoTab(page, 'Grocery')

    const row = cilantroRow(page)
    await expect(row).toHaveCount(1, { timeout: 15_000 })
    // Verbatim authored text, not a flattened 0.5 (ADR-0017).
    await expect(row).toContainText('½ small bunch')
    await expect(row).not.toContainText('0.5')
    await expectZeroMealimeRequests(page)
  })

  test('two half-bunches merge into one purchasable bunch', async ({ page }) => {
    await addVariantToPlan(page, HALF_BUNCH_A)
    await addVariantToPlan(page, HALF_BUNCH_B)
    await gotoTab(page, 'Grocery')

    const row = cilantroRow(page)
    await expect(row).toHaveCount(1, { timeout: 15_000 })
    await expect(row).toContainText('1 small bunch')
    await expect(row).not.toContainText('½')

    // No container line anywhere in the list carries a decimal amount:
    // packages are whole, or explicitly fractional (ADR-0017).
    const list = page.locator('main')
    await expect(list).not.toHaveText(/\d+\.\d+\s*\(?[\d\s]*\)?\s*(pkg|can|head|block|bag|bunch|jar|loaf)/i)
    await expectZeroMealimeRequests(page)
  })
})

/* ------------------------------------------------------------------ *
 * Feature C — household auto-sync (ADR-0019)
 * ------------------------------------------------------------------ */

/** Create a live room from the Plan tab's share sheet; returns the code. */
async function startLiveRoom(page: Page): Promise<string> {
  await gotoTab(page, 'Plan')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByTestId('start-room').click()
  return liveRoomCode(page)
}

/** Simulate a fresh app start: same profile, new session (no room code). */
async function restartFresh(page: Page) {
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await waitForApp(page)
}

test.describe('household room', () => {
  test('a saved room auto-joins on every start and syncs plan edits', async ({ page, browser }) => {
    test.setTimeout(90_000)
    // The live-room controls live in the plan's share sheet, which only
    // renders with a planned meal.
    const recipeName = await openFirstRecipeDetail(page)
    await page.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()
    const code = await startLiveRoom(page)

    // Settings: point the persistent setting at the live room this device
    // is already in. The `Adopt` button is gone (ADR-0049): typing the
    // code and pressing Join now covers it, and takes the no-reconnect
    // branch because the room is already live.
    await page.goto('/settings')
    await page.getByTestId('household-room-input').fill(code)
    await page.getByTestId('household-room-join').click()
    await expect(page.getByTestId('household-toast')).toContainText(
      `Household sync active — ${code}`,
      { timeout: 20_000 },
    )
    await expect(page.getByTestId('household-room-status')).toContainText(code)
    await page.reload()
    await expect(page.getByTestId('household-room-status')).toContainText(code, {
      timeout: 20_000,
    })

    // Fresh start → the app re-joins by itself, no share link involved.
    await restartFresh(page)
    await expect(page.getByTestId('household-toast')).toContainText(code, { timeout: 20_000 })
    await expect(page.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })

    // The second phone joins the same code and receives the plan.
    const ctxB = await browser.newContext()
    const b = await ctxB.newPage()
    await blockExternalRequests(b)
    await b.goto(`/?room=${code}`)
    await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })
    await dismissJoinCongrats(b)
    await gotoTab(b, 'Plan')
    await expect(b.getByRole('heading', { level: 3, name: recipeName })).toBeVisible({
      timeout: 20_000,
    })

    // …and an edit on the second phone lands here without a reload.
    await b.goto('/grocery')
    await b.getByPlaceholder('Add an item not in the recipes…').fill('Household sync check')
    await b.keyboard.press('Enter')
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
            return JSON.stringify(pinia?.state?.value?.plan?.customItems)
          }),
        { timeout: 20_000 },
      )
      .toContain('Household sync check')

    await ctxB.close()
    await expectZeroMealimeRequests(page)
  })

  test('a household code the relay does not know yet CREATES the room (ADR-0026)', async ({ page }) => {
    test.setTimeout(90_000)
    // The owner's dead end: a saved household code, a relay that never saw
    // it (fresh process / restarted container), and "Room not found". A join
    // now establishes the room instead.
    await page.goto('/settings')
    await waitForApp(page)
    const code = 'jade-otter-lantern'
    await page.getByTestId('household-room-input').fill(code)
    await page.getByTestId('household-room-join').click()
    await expect(page.getByTestId('household-room-status')).toContainText(code, {
      timeout: 20_000,
    })

    await restartFresh(page)
    await expect(page.getByTestId('household-toast')).toContainText(code, { timeout: 20_000 })
    await expect(page.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })
    await expect(page.getByTestId('room-chip')).toHaveAttribute('aria-label', new RegExp(`^Live room ${code}`))
    await expectZeroMealimeRequests(page)
  })

  test('an unusable code only warns and never blocks the app', async ({ page }) => {
    await page.goto('/settings')
    await waitForApp(page)
    // A PARTIAL word code never normalizes (ADR-0021 refuses to coerce it),
    // so Join now is disabled and nothing is ever joined. (An EMPTY field
    // is enabled — it rolls a fresh code instead; see room-words.spec.)
    await page.getByTestId('household-room-input').fill('mauve-peacock')
    await expect(page.getByTestId('household-room-join')).toBeDisabled()
    await expect(page.getByTestId('household-room-status')).toHaveCount(0)

    // The app stays fully usable: browse, plan, groceries.
    await gotoTab(page, 'Recipes')
    await waitForCatalog(page)
    await expect(recipeCards(page).first()).toBeVisible()
    const name = await openFirstRecipeDetail(page)
    await page.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()
    await gotoTab(page, 'Grocery')
    await expect(page.getByTestId('grocery-row').first()).toBeVisible({ timeout: 15_000 })
    expect(name.length).toBeGreaterThan(0)
    await expectZeroMealimeRequests(page)
  })
})
