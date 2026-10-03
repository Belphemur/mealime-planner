import { expect, test, type Page } from '@playwright/test'
import {
  blockExternalRequests,
  gotoTab,
  liveRoomCode,
  openFirstRecipeDetail,
  recipeCards,
  waitForCatalog,
} from './helpers'

/**
 * Live room sync: two separate browser contexts share plan, custom items
 * and grocery checkmarks through the WebSocket relay (proxied at /ws).
 */

async function planARecipe(page: Page): Promise<string> {
  await page.goto('/')
  await waitForCatalog(page)
  const name = await openFirstRecipeDetail(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()
  return name
}

async function addCustomItem(page: Page, text: string) {
  await page.goto('/grocery')
  await page.getByPlaceholder('Add an item not in the recipes…').fill(text)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-test=extra-section]').getByText(text)).toBeVisible()
}

/** Open the n-th (1-based) recipe card detail; returns its heading. */
async function openRecipeDetailNth(page: Page, n: number): Promise<string> {
  await recipeCards(page).nth(n - 1).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  return (await sheet.getByRole('heading', { level: 2 }).textContent())!.trim()
}

/** Start a live room from A's plan tab share sheet; returns the room link. */
async function startLiveRoom(page: Page): Promise<string> {
  await gotoTab(page, 'Plan')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByTestId('start-room').click()
  // The chip's aria-label carries the room code; rebuild the share link.
  const code = await liveRoomCode(page)
  return `${page.url().replace(/\/plan.*$/, '')}/plan?room=${code}`
}

test('room lifecycle: A shares, B joins and both see each other live', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)

  const recipeName = await planARecipe(a)
  await addCustomItem(a, 'Live room olive oil')
  const roomUrl = await startLiveRoom(a)

  // B joins in a FRESH context via the room link.
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })

  // B received A's plan + custom items without any reload.
  await expect(b.getByRole('heading', { level: 3, name: recipeName })).toBeVisible()
  await b.goto('/grocery')
  await expect(b.locator('[data-test=extra-section]').getByText('Live room olive oil')).toBeVisible()

  // B adds a custom item -> appears on A (state-level, no reload).
  await b.getByPlaceholder('Add an item not in the recipes…').fill('B brings dessert')
  await b.keyboard.press('Enter')
  await expect
    .poll(
      () =>
        a.evaluate(() => {
          const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
          return JSON.stringify(pinia?.state?.value?.plan?.customItems)
        }),
      { timeout: 10_000 },
    )
    .toContain('B brings dessert')

  // B checks a grocery line -> checked state appears on A.
  await b.goto('/grocery')
  await b.locator('[data-test=extra-section] li').filter({ hasText: 'B brings dessert' }).click()
  await expect
    .poll(
      () =>
        a.evaluate(() => {
          const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
          return JSON.stringify(pinia?.state?.value?.grocery?.map)
        }),
      { timeout: 10_000 },
    )
    .toContain('custom||b brings dessert')

  // A's plan edits propagate to B too (reverse direction).
  await a.goto('/plan')
  await a.getByRole('button', { name: 'Clear plan' }).click()
  await expect
    .poll(
      () =>
        b.evaluate(() => {
          const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
          return JSON.stringify(pinia?.state?.value?.plan?.plan)
        }),
      { timeout: 10_000 },
    )
    .toBe('[]')

  await ctxA.close()
  await ctxB.close()
})

test('reconnect: reloading B keeps it live in the room', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)

  const recipeName = await planARecipe(a)
  const roomUrl = await startLiveRoom(a)

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })

  // Full page reload: the session-stored room code re-joins automatically.
  await b.reload()
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })
  // Still receiving state: A edits, B sees it.
  await a.goto('/plan')
  await a.getByRole('button', { name: 'Clear plan' }).click()
  await expect
    .poll(
      () =>
        b.evaluate(() => {
          const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
          return JSON.stringify(pinia?.state?.value?.plan?.plan)
        }),
      { timeout: 10_000 },
    )
    .toBe('[]')
  // And B can still render the (now-empty) plan state without errors.
  await b.goto('/plan')
  await expect(b.getByText('Your meal plan is empty')).toBeVisible()
  void recipeName

  await ctxA.close()
  await ctxB.close()
})

test('room sync: A clears the grocery list and B sees it empty', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)

  const recipeName = await planARecipe(a)
  const roomUrl = await startLiveRoom(a)

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })

  // B initially sees the (non-empty) shared grocery list.
  await b.goto('/grocery')
  await expect(b.locator('main label').first()).toBeVisible({ timeout: 10_000 })

  // A clears the list from the Grocery tab…
  await a.goto('/grocery')
  await expect(a.locator('main label').first()).toBeVisible({ timeout: 10_000 })
  await a.locator('main input[type=checkbox]').first().click()
  await a.locator('[data-test=clear-list]').click()
  await a.getByTestId('toast').getByTestId('toast-action-primary').click()
  await expect(a.getByTestId('cleared-empty')).toBeVisible()

  // …and B's list empties live (cleared ingredients are household state).
  await expect(b.getByTestId('cleared-empty')).toBeVisible({ timeout: 10_000 })
  await expect(b.locator('[data-test=shop-row]')).toHaveCount(0)

  // The meal itself stays shared on both plan tabs.
  await b.goto('/plan')
  await expect(b.getByRole('heading', { level: 3, name: recipeName })).toBeVisible()

  void ctxA
  await ctxA.close()
  await ctxB.close()
})

test('room sync: remembered custom ingredients (customs) sync as household state', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)

  const recipeName = await planARecipe(a)
  const roomUrl = await startLiveRoom(a)

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })

  // A adds an UNKNOWN custom ingredient on the grocery tab…
  await a.goto('/grocery')
  const unknown = 'Qoruvva jelly strips'
  await a.getByLabel('Add a custom grocery item').fill(unknown)
  await a.keyboard.press('Enter')
  await expect(a.getByTestId('extra-section')).toContainText(unknown)

  // …B's remembered-names store receives it right away (ADR-0012: the
  // memory is now HOUSEHOLD state, room payload `customs`).
  await expect
    .poll(
      () =>
        b.evaluate(() => {
          const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
          return JSON.stringify(pinia?.state?.value?.customIngredients?.list)
        }),
      { timeout: 10_000 },
    )
    .toContain('Qoruvva')

  // …and retyping the prefix shows it as a "mine"-badge suggestion.
  await b.goto('/grocery')
  await b.getByLabel('Add a custom grocery item').fill('Qoruvva')
  await expect(
    b.locator('[data-test=add-suggestion-row]').filter({ has: b.locator('[data-test=mine-badge]') }),
  ).toContainText(unknown)

  await ctxA.close()
  await ctxB.close()
})

// ADR-0032 flipped this default: cooked history is shared BY DEFAULT and the
// toggle is a permanent opt-out. The case used to assert the old opt-in
// contract ("OFF by default, ON streams"), so it is deliberately inverted
// here: unchecked + not sharing, then checked + sharing.
test('share-history toggle: ON by default, the opt-out keeps events off the wire', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await blockExternalRequests(a)
  const name = await planARecipe(a)
  // planARecipe leaves the detail dialog open — close it, then keep the
  // plan non-empty after the cook (the Share button lives in the
  // non-empty branch): plan a SECOND recipe cooked later.
  await a.getByRole('button', { name: 'Back' }).click()
  const cooked = await openRecipeDetailNth(a, 2)
  await a.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()
  await a.getByRole('button', { name: 'Back' }).click()
  const roomUrl = await startLiveRoom(a)

  // Opt OUT before the room exists: unchecked, and a deliberate choice.
  const toggle = a.getByTestId('share-history-toggle')
  await expect(toggle).toBeChecked() // ADR-0032: on by default
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await a.getByRole('button', { name: 'Close share sheet' }).click()
  await expect(a.getByRole('dialog', { name: 'Share your meal plan' })).toHaveCount(0)

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(roomUrl)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })

  // A cooks recipe 2 while sharing is OFF (opted out).
  await gotoTab(a, 'Plan')
  await a.getByRole('button', { name: `Mark ${cooked} as cooked` }).click()
  await expect
    .poll(
      () =>
        b.evaluate(() => {
          const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
          return JSON.stringify(pinia?.state?.value?.plan?.cookedHistory)
        }),
      { timeout: 10_000 },
    )
    .toBe('[]') // OFF: never crosses the wire

  // Flip the toggle back ON (in the share sheet's room panel) → retroactive
  // push within the debounced push window carries the history.
  await gotoTab(a, 'Plan')
  await a.getByRole('button', { name: 'Share', exact: true }).click()
  await a.getByTestId('share-history-toggle').click()
  await expect(a.getByTestId('share-history-toggle')).toBeChecked()
  // Close the sheet: the toggling triggers the retroactive push even with
  // the sheet dismissed (flush: 'sync' watcher on ui.shareCookedHistory).
  await a.getByRole('button', { name: 'Close share sheet' }).click()

  await expect
    .poll(
      () =>
        b.evaluate(() => {
          const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
          return JSON.stringify(pinia?.state?.value?.plan?.cookedHistory)
        }),
      { timeout: 10_000 },
    )
    .toContain(`"variantId":`)

  // B's /history UI reflects the shared event.
  await b.goto('/history')
  await expect(b.getByTestId('history-row').first()).toContainText(cooked, { timeout: 10_000 })

  await ctxA.close()
  await ctxB.close()
})

test('joining a code the relay does not know yet CREATES the room (ADR-0026)', async ({ page }) => {
  // This is the reported bug verbatim: `join` used to be a lookup and
  // answered not_found, so a share link / household code was a dead end
  // after any relay restart. Whoever arrives first now establishes it.
  await blockExternalRequests(page)
  await page.goto('/plan?room=ember-willow-quartz')
  const chip = page.getByTestId('room-chip')
  await expect(chip).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })
  // The chip states the room in its aria-label, which the tooltip
  // repeats verbatim (ADR-0049). This device is the room's first peer.
  await expect(chip).toHaveAttribute(
    'aria-label',
    /^Live room ember-willow-quartz, 1 in room$/,
  )

  // A second device joining that same code lands in the same live room.
  const ctxB = await page.context().browser()!.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto('/plan?room=ember-willow-quartz')
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 10_000 })
  await ctxB.close()
})
