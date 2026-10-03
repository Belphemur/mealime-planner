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
import { zipStore } from '../src/lib/zip'

const encoder = new TextEncoder()

/** A minimal VALID backup zip whose settings carry `householdRoom`. */
function backupWithRoom(code: string): Uint8Array {
  return zipStore([
    {
      name: 'meta.json',
      data: encoder.encode(
        JSON.stringify({ app: 'mealime-planner', schema: 1, exportedAt: new Date().toISOString() }),
      ),
    },
    {
      name: 'settings.json',
      data: encoder.encode(
        JSON.stringify({ shareCookedHistory: false, dietFilters: [], householdRoom: code }),
      ),
    },
  ])
}

/**
 * Phase 18 — three-word room codes (ADR-0021).
 *
 * A room code is now `amber-falcon-lantern`: rolled on the CLIENT so the
 * user can read it out before anyone joins, with the legacy 4–12 char
 * alphanumeric code still accepted everywhere (ADR-0019 households
 * already have one persisted).
 */

const WORD_CODE = /^[a-z]{3,10}-[a-z]{3,10}-[a-z]{3,10}$/
const LEGACY_CODE = /^[A-Z0-9]{4,12}$/

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page)
  await page.goto('/')
  await waitForCatalog(page)
})

/** Plan a recipe (the share sheet only renders with a planned meal). */
async function planARecipe(page: Page): Promise<string> {
  const name = await openFirstRecipeDetail(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()
  return name
}

/** Start a live room from the Plan tab's share sheet; returns the code. */
async function startLiveRoom(page: Page): Promise<string> {
  await gotoTab(page, 'Plan')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByTestId('start-room').click()
  const code = await liveRoomCode(page)
  // Close the sheet: it is a full-screen overlay that would swallow the
  // bottom-nav clicks the rest of the test needs.
  await page.getByRole('button', { name: 'Close share sheet' }).click()
  await expect(page.getByRole('dialog', { name: 'Share your meal plan' })).toHaveCount(0)
  return code
}

/** The app shell is up (catalog finished loading, nav clickable). */
async function waitForApp(page: Page) {
  await expect(page.getByText('Loading…')).toBeHidden({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
}

test('a new room gets a three-word code that a second device joins by link', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000)
  const recipeName = await planARecipe(page)
  const code = await startLiveRoom(page)

  // The code rolled client-side is three readable words, not 6 chars.
  expect(code).toMatch(WORD_CODE)

  // A fresh device joins by the ?room= deep link and gets the plan.
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(`/plan?room=${code}`)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })
  // A shared link is CELEBRATED (ADR-0049): acknowledge the modal the way
  // the person who was handed the link would, before using the app.
  await dismissJoinCongrats(b)
  await gotoTab(b, 'Plan')
  await expect(b.getByRole('heading', { level: 3, name: recipeName })).toBeVisible({
    timeout: 20_000,
  })
  await ctxB.close()
  await expectZeroMealimeRequests(page)
})

test('Settings generates a code and a saved one auto-joins after a fresh start', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await planARecipe(page)
  const code = await startLiveRoom(page)

  // "New code" rolls a fresh three-word code AND joins it (ADR-0049) —
  // a rolled code that did nothing until a second press was the dead end
  // the owner asked to close.
  await gotoTab(page, 'Settings')
  await page.getByTestId('household-room-new').click()
  const rolled = await page.getByTestId('household-room-input').inputValue()
  expect(rolled).toMatch(WORD_CODE)
  await expect(page.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })

  // Typing the LIVE room in a sloppy shape still normalizes to the
  // canonical hyphenated code (spaces / upper case / no separators).
  const sloppy = code.toUpperCase().replace(/-/g, ' ')
  await page.getByTestId('household-room-input').fill(sloppy)
  await page.getByTestId('household-room-join').click()
  await expect(page.getByTestId('household-room-status')).toContainText(code, { timeout: 20_000 })
  await expect(page.getByTestId('household-room-input')).toHaveValue(code)

  // Fresh start (new session, no stored room code) → the app re-joins it.
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await waitForApp(page)
  await expect(page.getByTestId('household-toast')).toContainText(code, { timeout: 20_000 })
  await expect(page.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })
  await expectZeroMealimeRequests(page)
})

test('a legacy alphanumeric room code still joins', async ({ page }) => {
  test.setTimeout(90_000)
  await planARecipe(page)
  await startLiveRoom(page)

  // Mint a LEGACY room straight from the relay protocol (what an older
  // client sends: `create` with no code) and join it with the app.
  const legacy = await page.evaluate(async () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${proto}//${location.host}/ws`)
      const timer = setTimeout(() => reject(new Error('relay timeout')), 10_000)
      ws.onopen = () => ws.send(JSON.stringify({ type: 'create' }))
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as { type: string; code?: string }
        if (msg.type === 'created' && msg.code) {
          clearTimeout(timer)
          ws.close()
          resolve(msg.code)
        }
      }
      ws.onerror = () => reject(new Error('relay unreachable'))
    })
  })
  expect(legacy).toMatch(LEGACY_CODE)

  await gotoTab(page, 'Settings')
  await page.getByTestId('household-room-input').fill(legacy.toLowerCase())
  await page.getByTestId('household-room-join').click()
  // Upper-cased on the way in, exactly as before ADR-0021.
  await expect(page.getByTestId('household-room-status')).toContainText(legacy)
  await expect(page.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })
  await expectZeroMealimeRequests(page)
})

test('a nonsense code is refused rather than silently coerced', async ({ page }) => {
  await gotoTab(page, 'Settings')
  const input = page.getByTestId('household-room-input')
  const join = page.getByTestId('household-room-join')

  // An EMPTY field is joinable — it will roll a fresh code (ADR-0049), so
  // the button must not be a dead end before anything is typed.
  await expect(input).toHaveValue('')
  await expect(join).toBeEnabled()

  await input.fill('not-a-real-code')
  // Two tokens: neither a word code nor a legacy code.
  await expect(join).toBeDisabled()
  await input.fill('amber-falcon')
  await expect(join).toBeDisabled()
  await input.fill('amber falcon lantern')
  await expect(join).toBeEnabled()
  // Pressing it on a partial code is impossible while it is disabled, so
  // nothing was ever joined behind the user's back.
  await expect(page.getByTestId('household-room-status')).toHaveCount(0)
})

test('Join now on an EMPTY field rolls a code and CREATES its room (ADR-0049)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await planARecipe(page)

  await gotoTab(page, 'Settings')
  await expect(page.getByTestId('household-room-input')).toHaveValue('')
  await page.getByTestId('household-room-join').click()

  // The code is minted into the field so the user can see (and share) it.
  const rolled = await page.getByTestId('household-room-input').inputValue()
  expect(rolled).toMatch(WORD_CODE)

  // Join now: the code is fresh — the relay must CREATE the room, not
  // answer not_found (the old join-first path). "Room not found" would
  // also poison every later auto-join.
  await expect(page.getByTestId('household-toast')).toContainText(rolled, { timeout: 20_000 })
  await expect(page.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })
  await expect(page.getByTestId('household-room-status')).toContainText(rolled, { timeout: 20_000 })
  await expectZeroMealimeRequests(page)
})

test('a newly rolled code CREATES its room (qodo 4128519644)', async ({ page }) => {
  test.setTimeout(90_000)
  await planARecipe(page)

  await gotoTab(page, 'Settings')
  await page.getByTestId('household-room-new').click()
  const rolled = await page.getByTestId('household-room-input').inputValue()
  expect(rolled).toMatch(WORD_CODE)

  // "New code" joins the room it just rolled, so the chip is live in
  // `rolled` — a second press is not required to make the code real.
  await expect(page.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })
  await expect(page.getByTestId('household-room-status')).toContainText(rolled, { timeout: 20_000 })
  await expect(page.getByTestId('room-chip')).toHaveAttribute(
    'aria-label',
    new RegExp(`^Live room ${rolled}`),
  )
  await expectZeroMealimeRequests(page)
})

test('Leave drops the saved code, so the household does not rejoin next launch (ADR-0049)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await planARecipe(page)
  const code = await startLiveRoom(page)

  await gotoTab(page, 'Settings')
  await page.getByTestId('household-room-input').fill(code)
  await page.getByTestId('household-room-join').click()
  await expect(page.getByTestId('household-room-status')).toContainText(code, { timeout: 20_000 })

  await page.getByTestId('household-room-clear').click()
  // The socket is gone…
  await expect(page.getByTestId('room-chip')).toHaveCount(0)
  // …the SETTING is gone, which is the half that used to survive: leaving
  // with the code still saved meant the household silently rejoined on the
  // next launch.
  await expect(page.getByTestId('household-room-input')).toHaveValue('')
  await expect(page.getByTestId('toast')).toContainText('will not rejoin next launch')

  // A fresh session must NOT announce a room: the setting that drives the
  // ADR-0019 auto-join was cleared, so there is nothing to rejoin.
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await waitForApp(page)
  await expect(page.getByTestId('room-chip')).toHaveCount(0)
  await expect(page.getByTestId('household-room-input')).toHaveValue('')
  await expect(page.getByTestId('household-room-status')).toHaveCount(0)
  await expectZeroMealimeRequests(page)
})

test('a backup restore re-syncs the room draft; Join keeps the restored code (qodo 4128519632)', async ({
  page,
}) => {
  await gotoTab(page, 'Settings')

  // Start with room A joined through the UI (types into the field first).
  await page.getByTestId('household-room-input').fill('amber-falcon-lantern')
  await page.getByTestId('household-room-join').click()
  await expect(page.getByTestId('household-room-status')).toContainText('amber-falcon-lantern', {
    timeout: 20_000,
  })

  // Restore a backup carrying a DIFFERENT household room — no remount
  // happens (KeepAlive), so the draft must follow the store.
  await page.setInputFiles('[data-test=import-settings-input]', {
    name: 'backup.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(backupWithRoom('pine-otter-meadow')),
  })
  await page.getByTestId('import-settings-confirm').click()
  await expect(page.getByTestId('toast')).toContainText('Backup restored', { timeout: 10_000 })

  // The field shows the restored code — not the stale draft.
  await expect(page.getByTestId('household-room-input')).toHaveValue('pine-otter-meadow')

  // Joining keeps the restored code (the old bug wrote the stale draft back).
  await page.getByTestId('household-room-join').click()
  await expect(page.getByTestId('household-room-status')).toContainText('pine-otter-meadow', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('household-room-input')).toHaveValue('pine-otter-meadow')
  await expectZeroMealimeRequests(page)
})
