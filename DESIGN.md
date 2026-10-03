---
version: alpha
name: Mealime Kitchen
description: 'A warm, photo-led kitchen companion: cream and espresso surfaces, confident tomato
  actions, clear food iconography, and generous responsive layouts.'
colors:
  primary: "#B3381F"
  primary-strong: "#8E2C17"
  primary-soft: "#F08A6A"
  primary-tint: "#FBEAE5"
  primary-tint-dark: "#44241D"
  on-primary: "#FFFFFF"
  surface: "#FFF8F0"
  surface-raised: "#FFFFFF"
  surface-sunken: "#FFF0E6"
  border: "#E5D8CB"
  border-strong: "#8C7A6B"
  text: "#292524"
  text-muted: "#63574E"
  surface-dark: "#171310"
  surface-dark-raised: "#241C18"
  surface-dark-sunken: "#32261F"
  border-dark: "#564438"
  border-dark-strong: "#A28E80"
  text-dark: "#FFF8F0"
  text-dark-muted: "#C7B5A6"
  hue-meat: "#B3381F"
  hue-meat-soft: "#F08A6A"
  hue-fish: "#0E7490"
  hue-fish-soft: "#5CC0D8"
  hue-vegetarian: "#137A38"
  hue-vegetarian-soft: "#86EFAC"
  hue-vegan: "#047857"
  hue-vegan-soft: "#6EE7B7"
  meal-breakfast: "#946200"
  meal-breakfast-soft: "#FBBF24"
  meal-dessert: "#A81E6B"
  meal-dessert-soft: "#F472B6"
  meal-snack: "#8C5F33"
  meal-snack-soft: "#EBC49A"
  meal-lunch: "#3730A3"
  meal-lunch-soft: "#A5B4FC"
  meal-dinner: "#571814"
  meal-dinner-soft: "#FDBCBC"
  nutrition-energy: "#B83A0A"
  nutrition-energy-soft: "#FBBF6E"
  nutrition-sodium: "#4F46E5"
  nutrition-sodium-soft: "#A5B4FC"
  nutrition-protein: "#7C4DBE"
  nutrition-protein-soft: "#C4A8F5"
  nutrition-carbs: "#0E7490"
  nutrition-carbs-soft: "#5CC0D8"
  nutrition-fat: "#7A5F0C"
  nutrition-fat-soft: "#E8C86A"
  warning: "#9A3412"
  warning-soft: "#FDBA74"
  success: "#116149"
  success-soft: "#34D399"
  on-success: "#FFFFFF"
  danger: "#B91C1C"
  danger-soft: "#FCA5A5"
  favourite: "#E11D48"
  favourite-soft: "#FB7185"
typography:
  headline-lg:
    fontFamily: system-ui
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.15
  headline-md:
    fontFamily: system-ui
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
  body-md:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label-md:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
  cooking-step:
    fontFamily: system-ui
    fontSize: 20px
    fontWeight: 500
    lineHeight: 1.6
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  container: 1100px
  reading: 672px
  gutter-mobile: 16px
  gutter-desktop: 24px
  touch-target: 44px
components:
  app-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  app-surface-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.text-dark}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    height: 48px
    rounded: "{rounded.lg}"
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.on-primary}"
  button-primary-dark:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    height: 48px
    rounded: "{rounded.lg}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary-strong}"
    height: 44px
    rounded: "{rounded.lg}"
  button-secondary-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.primary-soft}"
    height: 44px
    rounded: "{rounded.lg}"
  chip-idle:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    height: 44px
    rounded: "{rounded.full}"
  chip-idle-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.text-dark}"
    height: 44px
    rounded: "{rounded.full}"
  chip-selected:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary-strong}"
    height: 44px
    rounded: "{rounded.full}"
  chip-selected-dark:
    backgroundColor: "{colors.primary-tint-dark}"
    textColor: "{colors.primary-soft}"
    height: 44px
    rounded: "{rounded.full}"
  recipe-card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
  recipe-card-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.xl}"
  recipe-card-meta:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label-md}"
  recipe-card-meta-dark:
    backgroundColor: "{colors.surface-dark-sunken}"
    textColor: "{colors.text-dark-muted}"
    typography: "{typography.label-md}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  divider-dark:
    backgroundColor: "{colors.border-dark}"
    height: 1px
  control-border:
    backgroundColor: "{colors.border-strong}"
    height: 1px
  control-border-dark:
    backgroundColor: "{colors.border-dark-strong}"
    height: 1px
  nav-bar:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-muted}"
    height: 56px
  nav-bar-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.text-dark-muted}"
    height: 56px
  nav-tab-active:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary-strong}"
  nav-tab-active-dark:
    backgroundColor: "{colors.primary-tint-dark}"
    textColor: "{colors.primary-soft}"
  nav-tab-icon-hover:
    textColor: "{colors.primary}"
  nav-tab-icon-hover-dark:
    textColor: "{colors.primary-soft}"
  badge-warning:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.warning}"
  badge-warning-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.warning-soft}"
  live-room-dot:
    backgroundColor: "{colors.success}"
  live-room-dot-dark:
    backgroundColor: "{colors.success-soft}"
  badge-danger:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.danger}"
  badge-danger-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.danger-soft}"
  favourite-filter:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.favourite}"
  favourite-filter-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.favourite-soft}"
  photo-control:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-primary}"
    size: 44px
    rounded: "{rounded.full}"
  photo-heart-active:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.favourite-soft}"
    size: 44px
    rounded: "{rounded.full}"
  icon-hue-meat:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.hue-meat}"
    size: 18px
  icon-hue-meat-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.hue-meat-soft}"
    size: 18px
  icon-hue-fish:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.hue-fish}"
    size: 18px
  icon-hue-fish-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.hue-fish-soft}"
    size: 18px
  icon-hue-vegetarian:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.hue-vegetarian}"
    size: 18px
  icon-hue-vegetarian-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.hue-vegetarian-soft}"
    size: 18px
  icon-hue-vegan:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.hue-vegan}"
    size: 18px
  icon-hue-vegan-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.hue-vegan-soft}"
    size: 18px
  icon-meal-breakfast:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.meal-breakfast}"
    size: 18px
  icon-meal-breakfast-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.meal-breakfast-soft}"
    size: 18px
  icon-meal-dessert:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.meal-dessert}"
    size: 18px
  icon-meal-dessert-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.meal-dessert-soft}"
    size: 18px
  icon-meal-snack:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.meal-snack}"
    size: 18px
  icon-meal-snack-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.meal-snack-soft}"
    size: 18px
  icon-meal-lunch:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.meal-lunch}"
    size: 18px
  icon-meal-lunch-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.meal-lunch-soft}"
    size: 18px
  icon-meal-dinner:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.meal-dinner}"
    size: 18px
  icon-meal-dinner-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.meal-dinner-soft}"
    size: 18px
  icon-nutrition-energy:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.nutrition-energy}"
    size: 18px
  icon-nutrition-energy-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.nutrition-energy-soft}"
    size: 18px
  icon-nutrition-sodium:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.nutrition-sodium}"
    size: 18px
  icon-nutrition-sodium-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.nutrition-sodium-soft}"
    size: 18px
  donut-protein:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.nutrition-protein}"
  donut-protein-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.nutrition-protein-soft}"
  donut-carbs:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.nutrition-carbs}"
  donut-carbs-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.nutrition-carbs-soft}"
  donut-fat:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.nutrition-fat}"
  donut-fat-dark:
    backgroundColor: "{colors.surface-dark-raised}"
    textColor: "{colors.nutrition-fat-soft}"
---

# Mealime Planner — Design System

## Overview

**Direction: a warm, photo-led kitchen companion, not a grey utility with coloured icons.**
**Product promise: choose meals together, buy what you need, and cook without
friction.** This is a household meal-planning tool with a recipe library, not a
recipe-content feed or a calorie-tracking app. Its distinctive value is the path
from appetising choices to a practical, waste-aware plan and one usable grocery list.

The entry surface is **Explore** (find food). Plan and grocery are **Operate**
(assemble meals, adjust servings, shop together); cooking is **Command / Inspect**
(one step, ingredients and timers at arm's length). Settings is **Configure**.
Compose for the job of each surface, not one repeated card template. No marketing
hero, weekday calendar, engagement streaks, invented savings dashboard or AI branding.

### Product basis and precedence

- [README](README.md), Features: browse → plan → derived grocery → shopping →
  cooking, local catalog/images, adjustable servings, backup and household sync.
- [ADR-0024](docs/design/ADR-0024-auto-plan-pack-builder.md): the differentiator is
  assembling a useful set of meals with fewer extra packages, not merely showing
  recipes. Plans are explicitly unscheduled lists, never day-assigned calendars.
- [ADR-0033](docs/design/ADR-0033-auto-plan-regenerate-seed.md): Auto-Plan is
  deterministic for its inputs including generation; Regenerate offers another
  pack. Preserve preview, add/replace choice, confirmation and undo.
- [ADR-0032](docs/design/ADR-0032-cooked-history-shared-by-default.md): household
  history sharing is on by default with an explicit send-side opt-out. Do not copy
  the README's stale personal-by-default wording into new UI.
- [ADR-0034](docs/design/ADR-0034-cook-anytime.md): any recipe can be cooked now;
  cooking need not wait for planning. History retains plan identity, creation date
  and individual cook events, including ad-hoc single-recipe plans.
- [AGENTS](AGENTS.md): local assets, bundled Lucide, shared filters, derived
  grocery, existing state/room rules and five labelled navigation tabs.

Newer accepted behaviour ADRs and tested implementation outrank old README prose;
this visual specification does not authorise business-logic changes. No new accounts,
onboarding requirement, external service, runtime AI or mandatory room connection.
Household sharing improves the workflow but offline/local use remains complete.

This revision replaces the previous accent-only direction. The owner permits a
complete visual rethink. Typography, surfaces, layout and component hierarchy can
change on desktop AND mobile. Preserve behaviour, routes, data and accessibility,
not accidental old CSS. Use the existing Vue/Tailwind/Lucide stack; no new runtime
library, external font request, invented dietary classification or storage migration.

**Character:** cream paper, white recipe cards, espresso dark mode, ripe tomato
primary actions, fresh greens and ocean-blue food cues. Colour should be visible
in meaningful areas (selection, action panels, navigation), not only tiny glyphs.
Real recipe photographs remain the focal point. Avoid gradients, glass effects,
fake metrics, ornamental icons and rainbow panels.

**Authority:** the YAML defines token values; the sections below define their use.
`src/style.css` must mirror the tokens, not redefine them. `DESIGN.tokens.json` is
a generated DTCG export, never a second source. [ADR-0036](docs/design/ADR-0036-kitchen-companion-redesign.md)
supersedes ADR-0035's accent-only, frozen-mobile and five-column decisions. This
document specifies the target; it is NOT a claim that existing components conform.

## Colors

### Roles and theme pairing

| Role | Light | Dark | Intended use |
| --- | --- | --- | --- |
| Page | `surface` cream | `surface-dark` espresso | Background around content |
| Card / nav / dialog | `surface-raised` white | `surface-dark-raised` warm charcoal | A clear raised surface, never transparent by accident |
| Metadata / grouped controls | `surface-sunken` peach-cream | `surface-dark-sunken` cocoa | Secondary bands, not primary actions |
| Main text | `text` | `text-dark` | Headlines, paragraphs, values |
| Secondary text | `text-muted` | `text-dark-muted` | Metadata, hints, idle navigation; still readable |
| Main action | `primary` with `on-primary` | SAME pairing | Filled tomato buttons, including Start cooking |
| Action hover / pressed | `primary-strong` with `on-primary` | SAME pairing | A darker tomato, not an opacity fade |
| Action text / selection | `primary-strong` on `primary-tint` | `primary-soft` on `primary-tint-dark` | Secondary actions, selected chips, active nav |
| Control boundary | `border-strong` | `border-dark-strong` | Inputs and controls whose outlines carry meaning |
| Decorative divider | `border` | `border-dark` | Grouping only, never the sole affordance |

The dark `primary-soft` is for text, icon tints and keylines, NOT a pale button
fill with white text. In dark mode add a `primary-soft` keyline to the filled
primary action: white text on tomato is readable, but the tomato fill alone is
not a sufficiently clear boundary against every dark panel. Secondary buttons
use a real surface and a visible outline in both themes.

### Food and nutrition identities

| Meaning | Glyph (Lucide) | Light / dark | Where it belongs |
| --- | --- | --- | --- |
| Meat | Beef | `hue-meat` / `hue-meat-soft` | Catalog category and matching filters |
| Fish | Fish | `hue-fish` / `hue-fish-soft` | Catalog category and matching filters |
| Vegetarian | Salad | `hue-vegetarian` / `hue-vegetarian-soft` | Green salad bowl; NEVER the vegan glyph |
| Vegan | Sprout | `hue-vegan` / `hue-vegan-soft` | Distinct mint-green sprout in the existing vegan diet filter |
| Energy / calories | Flame | `nutrition-energy` / `nutrition-energy-soft` | Card metadata and recipe nutrition |
| Sodium | Droplet | `nutrition-sodium` / `nutrition-sodium-soft` | Recipe nutrition only; NOT browse cards |
| Protein (calories) | — (no glyph) | `nutrition-protein` / `nutrition-protein-soft` | Nutrition-facts macro donut arc + legend only |
| Carbohydrates (calories) | — (no glyph) | `nutrition-carbs` / `nutrition-carbs-soft` | Nutrition-facts macro donut arc + legend only |
| Fat (calories) | — (no glyph) | `nutrition-fat` / `nutrition-fat-soft` | Nutrition-facts macro donut arc + legend only |

The three macro tokens are ARC/LEGEND identities, not food identities: a
recipe is never "the violet one", so they appear nowhere outside the nutrition
facts modal. They carry NO glyph and NO `IconRole` — the legend word beside the
arc is the name, exactly as a labelled control's word is.

Vegetarian is fresh green, not the old yellow/olive. Vegan is a separate green
and a different silhouette. Glyph + accessible name carry the distinction even
when colour is indistinguishable. Do not use an arbitrary hue-angle threshold as
proof of accessibility. ONE role-to-glyph-and-token mapping drives all call sites;
no hand-written competing glyphs in filter chips, cards, details or plan previews.
An exclusion filter keeps its explicit wording/strike treatment: a red meat icon
alone must not mean "no meat". Do not claim a recipe is vegan from a vegetarian
category; the published categories and existing diet heuristics stay unchanged.

**Measured palette, not blanket accessibility claims.** WCAG sRGB calculations
for the values above give white on tomato **6.00:1** (hover **8.32:1**). Across
all four allowed light backgrounds (page, card, band, selected tint), the six
food/nutrition foregrounds are at least **4.59:1**; their dark counterparts are
at least **5.64:1** across the four dark equivalents. The three macro tokens
(`nutrition-protein` **4.92:1**, `nutrition-carbs` **4.59:1**,
`nutrition-fat` **5.19:1** light; **6.77 / 6.59 / 8.51:1** dark) are measured
against the same four surfaces. Muted text is at least
**5.99:1** light / **6.99:1** dark. These are token-pair checks; rendered states,
opacity, imagery, inheritance and focus must still be tested in the browser.

Status is not food identity: warnings use `warning` / `warning-soft`, destructive
controls use `danger` / `danger-soft`, favourites remain rose hearts, and a live
household room is signalled with `success` / `success-soft` (ADR-0049). The
success pair is deliberately a **different green** from `hue-vegetarian`
(`#137A38`) and `hue-vegan` (`#047857`) — a "connected" dot must never be
mistaken for a dietary cue. It is also never attached to an `IconRole`, so it
cannot leak into the food-hue registry; it measures **6.66:1** light and
**7.62:1** dark against `surface-sunken`, the chip it actually sits on.
`on-success` is the foreground for a headcount printed ON a `success` fill
(the chip's badge-dot): white on the deep light-mode green, dark green-black
on the light dark-mode green, where white would be ~1.9:1. These foregrounds use raised surfaces; do not assume every status tint works on every
coloured panel. Keep labels or shapes as a second signal. No raw colour literals
in components, ad-hoc Tailwind palette substitutions or undocumented gradients.

## Typography

Use a deliberate **system-ui sans stack** (system-ui, -apple-system, Segoe UI,
Roboto, sans-serif). The app is offline-first; do not claim Inter is available
without shipping it, and do not introduce a network font. Hierarchy, size and
measure provide the editorial character, not an extra typeface.

- Main recipe title: 24px on phones, 32px at desktop; 700, compact line height.
- Page/section hierarchy: 24px / 18px, with sentence case rather than an entire
  screen of small uppercase headings.
- Card title: 14px on compact two-column phones, 16px desktop, 600; reserve two
  lines so metadata aligns. Never reduce it to fit a five-column desktop grid.
- Reading body: 16px / 1.55. Cooking step text: 20px / 1.6 where space allows,
  never less than 18px. Metadata: 12px minimum; secondary prose: 14px.
- Use tabular numerals for servings, minutes, nutrition and timers. Units remain
  visible (`kcal`, `min`, `mg sodium`) and do not disappear to save a row.
- Support 200% zoom and long titles without clipped controls or horizontal scroll.

## Layout

### Shared frame

One fluid `container` token caps the app at **1100px border-box**. Header, main
content and bottom-navigation alignment share it. Use 16px mobile / 24px desktop
internal gutters without adding another narrower container inside the recipe grid.
The bottom bar may have a full-window background; its tabs align with the shell.
At 1440px and 1920px desktop widths the app remains centred and actually uses the
1100px allowance. At narrower widths it fits the viewport without horizontal scroll.

Recipe grid: **one column below 360px, two from 360px, three from 720px, four from
1024px**. There is no five-column stage at this cap: the earlier layout made cards
narrower just when their metadata grew. Use 12px gaps on compact phones and 20px
on desktop. Keep food photography at 4:3, larger titles and comfortable padding
(12px mobile / 16px desktop). Do not replace a dense phone grid with giant tiles.

### Recipe detail and task views

At desktop, compose the recipe introduction as photo beside title, key facts and
action panel; stop stretching the photograph into a shallow, screen-wide ribbon.
Below it, ingredients and instructions form an approximately 1:1.5 two-column
reading layout. On phones stack photo, introduction, actions and sections in that
order. Nutrition belongs after the action area, not ahead of the next useful action.

Start cooking is the single primary action. Servings and Add/Update in plan stay
available but are visually secondary. On desktop place actions near the recipe
introduction; on phones use a full-width cooking button and compact secondary
row. A sticky action area is allowed only if it clears the actual app-header
height, does not cover content/focus, and does not consume most of a short screen.
It must reflow for zoom/landscape rather than overlap the navigation.

### One visual language, different jobs

| Surface | Composition and priority | Preserve / avoid |
| --- | --- | --- |
| Recipes | Clear search, compact labelled filters, result count and food grid. Filter groups can breathe without hiding active choices. | Keep sorting, favourites, load-more and a useful zero-results reset. No promotional hero above the controls. |
| Plan | A working list of meal rows with thumbnails, titles and servings; compact summary of existing totals. Auto-Plan is a prominent route to building/completing a plan and carries the ONE filled tomato on this surface. | Never introduce weekday slots. Keep add/replace and plan editing distinct from cooking now. Destructive clear is secondary and confirmed, and Share stays an outline. |
| Auto-Plan dialog | Preferences → generate/regenerate → food preview → confirm. Group controls separately from preview; wider two-zone layout on desktop, logical single column on phones. | Show real pending/busy/error state; a visible old preview is not a finished regeneration. No invented waste percentages or AI sparkles. Preserve undo. |
| Grocery | Store-section headings, strong ingredient names and quantities, provenance beside rather than inside truncated text, real completion progress; Start shopping is the primary action. | Preserve Extra items first, checked/clear semantics and accessible provenance. Amounts come from existing aggregation; never make up savings or quantities. |
| Shopping | Large, high-contrast checkable rows, lightweight section headers, reachable Exit and honest progress. | Keep auto-collapse behaviour, not recipe tiles; no ornamental chrome in a supermarket. |
| Cooking | A focused step reader with measured amounts, visible timers and reachable previous/next/mark/finish controls. | Keep **672px reading measure**, not a narrow browse shell. Never obscure an active timer or add two final completion actions. |
| History | A legible chronological log grouped by plan with plan-created date, recipe thumbnails and individual cook dates/counts. | Preserve ad-hoc and legacy groups. No streak gamification and no invented plan names. |
| Settings | Labelled sections for household sync/privacy, preferences and backup/restore; explicit destructive confirmations. | Local use never requires joining a room. Keep the history-sharing opt-out and backup accessible. |

A live-room status chip is a calm status, not a persistent alarm banner; loss of
sync must never block finding a recipe or checking groceries. Empty states name
one useful next action (browse/add meals or generate a plan), without fake data.
Loading/error states use the same surfaces and retain retry affordances.
Keep the existing five labelled bottom tabs and full-screen cooking/shopping
modes. Do not change cooking/history/undo/timer/room/backup semantics.

## Elevation & Depth

Use a small shadow and a quiet border for recipe cards, solid contrasting surfaces
for dialogs and toolbars, and tonal grouping for metadata. Do not wrap every
paragraph in its own card. Hover can strengthen a card's shadow without moving
the grid. Photo controls use a **solid espresso disc** so the contrast does not
depend on photograph brightness; favourite is an outline heart when idle and a
filled `favourite-soft` heart when selected in BOTH themes. No orange favourite.
Avoid global backdrop blur or translucent text/control surfaces.

## Shapes

16px recipe cards and dialogs; 12px buttons/inputs; fully rounded filter chips and
photo-control discs; 6px small badges. Related elements share radii and alignment.
Controls have a minimum **44 × 44px hit target**, even where the visible glyph is
18–22px. Five nav tabs remain at least 56px high and fit a 412px Pixel 7 without
label clipping or requiring horizontal navigation scrolling.

## Components

### Cards and icon labels

A recipe card has photograph, favourite control, title, compact facts and rating.
Facts are category icon, calories and minutes; use the same hierarchy on phone
and desktop with more breathing room on desktop. Sodium is absent from EVERY
browse card and card-like preview that reuses that compact fact row.

Do not print "Vegetarian", "Meat" or "Fish" beside an already informative type
icon in cards or recipe headers. Keep `role="img"` and an accessible name. Provide
an optional category tooltip on hover/keyboard focus without turning the icon
into a separate action; preserve the full recipe title as the card link name.
Filter buttons KEEP their visible labels because they name a choice. Nutrition
values KEEP units and sodium wording. Decorative icons beside labels are hidden
from assistive technology, so nothing is announced twice.

The whole card must be keyboard navigable with visible focus. Favourite and
rating remain separate real controls, not nested interactive elements inside a
link/button. Touching them must never accidentally open the detail. Preserve
existing load-more and empty/error/loading behaviours.

### Selection and actions

Selected filters use a tinted surface, brand outline/check and pressed semantics,
NOT solid tomato behind category-coloured icons. Food icons therefore keep their
identity and remain legible in both states. Apply the same selected treatment to
diet, protein, favourite and other filters; it must not imply all filter values
are food categories. No ambiguous colour-only state and no pill width jump.

Start cooking uses a filled tomato surface, white ChefHat + label, 48px minimum
height, and the dark-mode keyline described above. Add/Update in plan uses the
secondary outlined surface. Loading/disabled/focus/hover/pressed states are explicit;
disabled must not look clickable and loading must not collapse the control.
Back and favourite controls stay visible over any photo.

### Navigation and motion

Keep five icons plus visible labels. An active tab has a modest rounded tinted
icon backplate, brand foreground and `aria-current`, not only a text-colour change.
Idle labels use the readable muted token. Tab sizing and hit area stay stable.

Within `@media (hover: hover)` ONLY, hovering the whole tab lifts its icon by
**2px** and tints it to the theme's brand foreground over **150ms ease**. Do not
move its label/backplate, resize its hit area or animate a whole navigation bar.
`prefers-reduced-motion: reduce` removes the transform; tint may remain. Apply
hover-only affordances only to enabled controls. Keyboard focus has a clear
2px ring with separation from the component in either theme even on devices
without hover. Review other active-scale/pulse transitions for reduced motion.

### Verification and implementation contract

1. Read ADR-0036 before new semantic implementation; it records why this revision
   supersedes the accent-only, frozen-mobile and five-column constraints. Keep
   ADR-0035 as history with a superseded-by pointer, not a rewritten decision.
2. Mirror ALL used design tokens (including surfaces/text/borders) into Tailwind;
   use static complete class strings for roles so dark CSS is emitted. Document
   the small `primary` → `brand` naming translation once. Update the generated
   DTCG export and deterministic token-parity checks together.
3. Use one role registry for glyph, accessible name and colours. Test vegetarian
   and vegan as distinct roles/glyphs and exclusion labels as exclusions, not as
   guessed ingredients. Test actual computed SVG styles, not source strings alone.
4. Cover light AND dark browser states at 360px/412px phones, 768px tablet and
   1440px/1920px desktop, plus a narrow 320px viewport and 200% zoom. Check grid
   columns, full-shell width, wrapping, overlays, labels, hit areas and navigation.
5. Add regressions for readable Start cooking background/foreground/keyline;
   primary-vs-secondary hierarchy; no repeated type labels; sodium absent from
   cards but present when supplied in nutrition; consistent icons; hover lift,
   keyboard focus and reduced motion. Check pressed filters, not only idle icons.
6. Capture and REVIEW before/after screenshots in both themes (browse, detail,
   representative plan/grocery/history/settings and cooking). A screenshot saved
   but not inspected is not visual verification. Do not bless blank/loading pages.
7. Run document lint, build, unit tests and the complete Playwright suite serially
   against the built bundle. No previously passing result proves the new revision.
   Report actual counts/skips/failures; never weaken a behavioural test just to
   match new markup. Use existing offline request guards and `data-test` hooks.

## Do's and Don'ts

- Do rethink composition and hierarchy where it helps cooking or choosing food.
- Do keep a warm coherent light theme AND a fully legible dark theme.
- Do colour meaningful actions and selections as well as icons; several semantic
  icon colours may coexist in a metadata row without making the whole card rainbow.
- Do preserve data, quantities, dietary-filter semantics and existing workflows.
- Don't restore the old grey-only or forced-dark card treatment in light mode.
- Don't shrink desktop cards to five columns or body text to squeeze in more facts.
- Don't duplicate category words, put sodium back on browse cards, or reuse the
  vegan sprout as the vegetarian icon.
- Don't confuse a token lint pass with rendered accessibility or implementation
  completion. Verify real surfaces and all entry points before making that claim.
