import { expect, test, type Page } from '@playwright/test'
import {
  blockExternalRequests,
  expectZeroMealimeRequests,
  gotoTab,
  liveRoomCode,
  openFirstRecipeDetail,
  waitForCatalog,
} from './helpers'

/**
 * Phase 18 — one-tap "Share room" (ADR-0023).
 *
 * The action's only job is to put `<origin>/plan?room=<code>` on the
 * clipboard in one tap (no picker, no `navigator.share`: plain-HTTP LAN
 * origins have no Web Share). It lives on the Settings household card and
 * on the toast that confirms joining.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await waitForCatalog(page)
})

/** The clipboard text, read through the API the app wrote with. */
async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

test('Settings copies the room join link in one tap', async ({ page }) => {
  test.setTimeout(90_000)
  await openFirstRecipeDetail(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()

  await gotoTab(page, 'Plan')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByTestId('start-room').click()
  const code = await liveRoomCode(page)
  await page.getByRole('button', { name: 'Close share sheet' }).click()

  // One tap in Settings → the link is on the clipboard.
  await gotoTab(page, 'Settings')
  await page.getByTestId('share-room').click()
  await expect(page.getByTestId('share-room-toast')).toContainText('Copied!')

  const link = await clipboardText(page)
  expect(link).toBe(`${page.url().replace(/\/settings.*$/, '')}/plan?room=${code}`)
  expect(link).toContain(code)
  await expectZeroMealimeRequests(page)
})

test('the copy is never silent when the clipboard refuses', async ({ page }) => {
  await gotoTab(page, 'Settings')
  // Nothing to share yet → an explicit message, never a no-op.
  await expect(page.getByTestId('share-room')).toBeDisabled()

  // `New code` rolls AND joins (ADR-0049), so there is something to share
  // and something to report as active the moment it is pressed.
  await page.getByTestId('household-room-new').click()
  const code = await page.getByTestId('household-room-input').inputValue()
  await expect(page.getByTestId('household-room-status')).toContainText(code, { timeout: 20_000 })

  // Simulate a clipboard that accepts the call but keeps its old content
  // (another app grabbing the clipboard mid-write): the app must notice
  // the read-back mismatch and say so.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async () => undefined,
        writeText: async () => undefined,
        read: async () => [{ text: async () => 'stale' }],
        readText: async () => 'stale',
      },
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => true })
  })
  await page.getByTestId('share-room').click()
  const toast = page.getByTestId('toast')
  await expect(toast).toContainText("Couldn't copy automatically")
  // The fallback still carries the link so it can be copied by hand.
  await expect(toast).toContainText(`/plan?room=${code}`)
  await expectZeroMealimeRequests(page)
})

test('the join toast shares the link without a second tap', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await openFirstRecipeDetail(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()

  // The room is CREATED by a different device, so the join below is a real
  // join rather than the already-live confirmation (ADR-0049): this page
  // has never been in that room, which is the two-phone flow the toast's
  // share action exists for.
  const ctxSeed = await browser.newContext()
  const seed = await ctxSeed.newPage()
  await blockExternalRequests(seed)
  await seed.goto('/')
  await waitForCatalog(seed)
  await openFirstRecipeDetail(seed)
  await seed.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click()
  await gotoTab(seed, 'Plan')
  await seed.getByRole('button', { name: 'Share', exact: true }).click()
  await seed.getByTestId('start-room').click()
  const code = await liveRoomCode(seed)

  // Settings → "Join now" carries a Share link action on its toast.
  await gotoTab(page, 'Settings')
  await page.getByTestId('household-room-input').fill(code)
  await page.getByTestId('household-room-join').click()
  const toast = page.getByTestId('household-toast')
  await expect(toast).toContainText(code)
  await toast.getByTestId('toast-action-primary').click()
  await expect(page.getByTestId('share-room-toast')).toContainText('Copied!')
  expect(await clipboardText(page)).toContain(`/plan?room=${code}`)

  // And the shared link really joins the room on another device.
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await blockExternalRequests(b)
  await b.goto(`/?room=${code}`)
  await expect(b.getByTestId('room-chip')).toHaveAttribute('aria-label', /^Live room /, { timeout: 20_000 })
  await ctxB.close()
  await ctxSeed.close()
  await expectZeroMealimeRequests(page)
})
