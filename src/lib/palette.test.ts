import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ICON_ROLES,
  ROLE_GLYPHS,
  dietHueClass,
  dietRole,
  hueClass,
  ingredientRole,
  proteinHueClass,
  proteinRole,
  roleGlyph,
  type IconRole,
} from './palette'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const styleCss = readFileSync(resolve(REPO_ROOT, 'src/style.css'), 'utf8')
const designMd = readFileSync(resolve(REPO_ROOT, 'DESIGN.md'), 'utf8')

/**
 * The DESIGN.md colour token -> the `@theme` variable that carries it.
 *
 * The RENAMES are the interesting part and are deliberate: DESIGN.md
 * names the tomato family `primary-*` (it is the one action colour in
 * the product language) while Tailwind's own `primary` scale would
 * shadow the theme variable, so the CSS side calls it `brand-*`. The
 * values are still transcriptions — that is what the value test below
 * asserts.
 */
const COLOR_TOKENS: Record<string, string> = {
  primary: '--color-brand',
  'primary-strong': '--color-brand-strong',
  'primary-soft': '--color-brand-soft',
  'primary-tint': '--color-brand-tint',
  'primary-tint-dark': '--color-brand-tint-dark',
  'on-primary': '--color-on-brand',
  surface: '--color-surface',
  'surface-raised': '--color-surface-raised',
  'surface-sunken': '--color-surface-sunken',
  border: '--color-border',
  'border-strong': '--color-border-strong',
  text: '--color-text',
  'text-muted': '--color-text-muted',
  'surface-dark': '--color-surface-dark',
  'surface-dark-raised': '--color-surface-dark-raised',
  'surface-dark-sunken': '--color-surface-dark-sunken',
  'border-dark': '--color-border-dark',
  'border-dark-strong': '--color-border-dark-strong',
  'text-dark': '--color-text-dark',
  'text-dark-muted': '--color-text-dark-muted',
  'hue-meat': '--color-hue-meat',
  'hue-meat-soft': '--color-hue-meat-soft',
  'hue-fish': '--color-hue-fish',
  'hue-fish-soft': '--color-hue-fish-soft',
  'hue-vegetarian': '--color-hue-vegetarian',
  'hue-vegetarian-soft': '--color-hue-vegetarian-soft',
  'hue-vegan': '--color-hue-vegan',
  // Meal OCCASION (ADR-0043) — its own hue family. Deliberately separate from
  // the four protein hues above: a colour that means "contains meat" must not
  // also mean "Dinner".
  'meal-breakfast': '--color-meal-breakfast',
  'meal-breakfast-soft': '--color-meal-breakfast-soft',
  'meal-dessert': '--color-meal-dessert',
  'meal-dessert-soft': '--color-meal-dessert-soft',
  'meal-snack': '--color-meal-snack',
  'meal-snack-soft': '--color-meal-snack-soft',
  'meal-lunch': '--color-meal-lunch',
  'meal-lunch-soft': '--color-meal-lunch-soft',
  'meal-dinner': '--color-meal-dinner',
  'meal-dinner-soft': '--color-meal-dinner-soft',
  'hue-vegan-soft': '--color-hue-vegan-soft',
  'nutrition-energy': '--color-nutrition-energy',
  'nutrition-energy-soft': '--color-nutrition-energy-soft',
  'nutrition-sodium': '--color-nutrition-sodium',
  'nutrition-sodium-soft': '--color-nutrition-sodium-soft',
  'nutrition-protein': '--color-nutrition-protein',
  'nutrition-protein-soft': '--color-nutrition-protein-soft',
  'nutrition-carbs': '--color-nutrition-carbs',
  'nutrition-carbs-soft': '--color-nutrition-carbs-soft',
  'nutrition-fat': '--color-nutrition-fat',
  'nutrition-fat-soft': '--color-nutrition-fat-soft',
  warning: '--color-warning',
  'warning-soft': '--color-warning-soft',
  success: '--color-success',
  'success-soft': '--color-success-soft',
  // Foreground ON a success fill (the header chip's badge-dot, ADR-0049).
  'on-success': '--color-on-success',
  danger: '--color-danger',
  'danger-soft': '--color-danger-soft',
  favourite: '--color-favourite',
  'favourite-soft': '--color-favourite-soft',
}

/** Non-colour tokens that must also stay in step. */
const DIMENSION_TOKENS: Record<string, string> = {
  'spacing.container': '--container-app',
  'spacing.reading': '--container-reading',
}

/**
 * @theme colour variables that are deliberate CSS-side helpers rather
 * than 1:1 transcriptions of a DESIGN.md colour name — each one still
 * carries a documented value and is asserted in the whole-file test.
 */
const EXTRA_THEME_COLORS: string[] = ['--color-brand-text']

/**
 * The typography DESIGN.md declares -> the `@theme` variables that carry
 * it. Tailwind v4 spells a text definition as three variables:
 * `--text-<name>` (size), `--text-<name>--line-height`,
 * `--text-<name>--font-weight`. The CSS side uses the same px/unit
 * values DESIGN.md declares, so the assertion is value equality.
 */
const TYPOGRAPHY_TOKENS: Record<string, string> = {
  'headline-lg': '--text-headline-lg',
  'headline-md': '--text-headline-md',
  title: '--text-title',
  'body-md': '--text-body-md',
  'body-sm': '--text-body-sm',
  'label-md': '--text-label-md',
  'cooking-step': '--text-cooking-step',
}

const FRONTMATTER = designMd.split('---')[1] ?? ''

function designColor(token: string): string | null {
  const m = FRONTMATTER.match(new RegExp(`^\\s{2}${token}:\\s*"([^"]+)"`, 'm'))
  return m ? m[1].toLowerCase() : null
}

function designDimension(token: string): string | null {
  const key = token.split('.')[1]
  const m = FRONTMATTER.match(new RegExp(`^\\s{2}${key}:\\s*"?([\\d.]+px)"?`, 'm'))
  return m ? m[1] : null
}

function themeVar(cssVar: string): string | null {
  const m = styleCss.match(new RegExp(`${cssVar}:\\s*([^;]+);`))
  return m ? m[1].trim().toLowerCase() : null
}

/** Every colour NAME declared in DESIGN.md's `colors:` front-matter. */
function designColorNames(): string[] {
  const colorsBlock = designMd.slice(designMd.indexOf('colors:'), designMd.indexOf('typography:'))
  return Array.from(colorsBlock.matchAll(/^  ([a-z-]+):\s*"#/gm), (m) => m[1])
}

/** Every DEFINITION name under DESIGN.md's `typography:` front-matter. */
function designTypeNames(): string[] {
  const typeBlock = designMd.slice(designMd.indexOf('typography:'), designMd.indexOf('rounded:'))
  return Array.from(typeBlock.matchAll(/^  ([a-z-]+):$/gm), (m) => m[1])
}

/** One DESIGN.md typography definition: `fontSize`/`lineHeight`/
 *  `fontWeight` under `typography.<name>`. Returns lowercase values. */
function designType(name: string, prop: 'fontSize' | 'lineHeight' | 'fontWeight'): string | null {
  const m = designMd.match(
    new RegExp(`^  ${name}:\\n(?:    .*\\n)*?    ${prop}:\\s*([^\\n]+)$`, 'm'),
  )
  return m ? m[1].trim().toLowerCase() : null
}

/** Every `--text-*` variable name defined in the light `@theme` block,
 *  parsed line-wise (a naive regex cannot separate `--text-x` from its
 *  `--text-x--line-height` companions). */
function themeTypeVars(): string[] {
  const start = styleCss.indexOf('@theme {')
  const end = styleCss.indexOf('\n}', start)
  return Array.from(
    new Set(Array.from(styleCss.slice(start, end).matchAll(/^\s*(--text-[a-z-]+):/gm), (m) => m[1])),
  )
}

/** Every `--color-*` variable name defined in the light `@theme` block. */
function themeColorVars(): string[] {
  const start = styleCss.indexOf('@theme {')
  const end = styleCss.indexOf('\n}', start)
  return Array.from(
    new Set(Array.from(styleCss.slice(start, end).matchAll(/--color-[a-z-]+/g), (m) => m[0])),
  )
}

const ALL_ROLES = Object.keys(ICON_ROLES) as IconRole[]

describe('the icon role registry (ADR-0036)', () => {
  test('every role owns a distinct token pair, one literal class and a label', () => {
    const tokens = ALL_ROLES.map((r) => ICON_ROLES[r].token)
    expect(new Set(tokens).size).toBe(tokens.length)
    const classes = ALL_ROLES.map((r) => ICON_ROLES[r].className)
    expect(new Set(classes).size).toBe(classes.length)
    for (const role of ALL_ROLES) {
      const spec = ICON_ROLES[role]
      expect(spec.darkToken).toBe(`${spec.token}-soft`)
      expect(spec.label.length).toBeGreaterThan(0)
      expect(ROLE_GLYPHS[spec.glyph]).toBeDefined()
    }
  })

  test('the class is a LITERAL single utility — dark mode is the theme, not a prefix', () => {
    // Tailwind scans source TEXT for complete class names, so an
    // interpolated `text-${token}` emits no CSS at all and the icon ships
    // uncoloured. A `dark:` variant here would be dead weight AND would
    // re-introduce the per-component dark-mode forgetting the theme flip
    // exists to prevent.
    for (const role of ALL_ROLES) {
      const cls = hueClass(role)
      expect(cls).toBe(`text-${ICON_ROLES[role].token}`)
      expect(cls.split(' ')).toHaveLength(1)
      expect(cls).not.toContain('dark:')
      expect(cls).not.toContain('${')
      // …and the literal really is in the source, which is what makes
      // Tailwind emit the utility at all.
      expect(styleCss.includes(`--color-${ICON_ROLES[role].token}:`)).toBe(true)
    }
  })

  test('every role maps to a distinct glyph, and vegetarian ≠ vegan', () => {
    const glyphs = ALL_ROLES.map((r) => ICON_ROLES[r].glyph)
    expect(new Set(glyphs).size).toBe(glyphs.length)
    // Owner decision (ADR-0036): the two greens must read apart in
    // MONOCHROME too, so a shared glyph is not allowed even if the hues
    // were close.
    expect(ICON_ROLES.vegetarian.glyph).not.toBe(ICON_ROLES.vegan.glyph)
    expect(ICON_ROLES.vegetarian.token).not.toBe(ICON_ROLES.vegan.token)
    expect(ICON_ROLES.vegetarian.label).toBe('Vegetarian')
    expect(ICON_ROLES.vegan.label).toBe('Vegan')
  })

  test('categorical roles are food types, semantic roles are nutrition facts', () => {
    expect(ICON_ROLES.meat.kind).toBe('categorical')
    expect(ICON_ROLES.fish.kind).toBe('categorical')
    expect(ICON_ROLES.vegetarian.kind).toBe('categorical')
    expect(ICON_ROLES.vegan.kind).toBe('categorical')
    expect(ICON_ROLES.energy.kind).toBe('semantic')
    expect(ICON_ROLES.sodium.kind).toBe('semantic')
  })

  test('every mapped token VALUE matches between DESIGN.md and @theme', () => {
    // Name-only checks would let a colour drift silently: the whole point
    // of the mirror is that the CSS var carries the documented value.
    for (const [token, cssVar] of Object.entries(COLOR_TOKENS)) {
      const declared = designColor(token)
      expect(declared, `${token} missing from DESIGN.md`).not.toBeNull()
      expect(themeVar(cssVar), `${cssVar} missing from src/style.css`).not.toBeNull()
      expect(themeVar(cssVar)).toBe(declared)
    }
    for (const [token, cssVar] of Object.entries(DIMENSION_TOKENS)) {
      expect(designDimension(token), `${token} missing from DESIGN.md`).not.toBeNull()
      expect(themeVar(cssVar)).toBe(designDimension(token))
    }
  })

  test('the mirror is WHOLE-FILE: every DESIGN.md colour is mapped, none stray', () => {
    // The value test above walks the ALLOWLIST, which can only prove the
    // listed pairs match. A newly added DESIGN.md colour (or a leftover
    // @theme variable) would silently escape it, so this test parses BOTH
    // files' key sets and demands full coverage in each direction.
    const designKeys = designColorNames()
    expect(designKeys.length).toBeGreaterThan(0)
    for (const key of designKeys) {
      expect(COLOR_TOKENS[key], `DESIGN.md colour '${key}' is not in COLOR_TOKENS`).toBeDefined()
    }
    // The reverse: a mapping for a colour DESIGN.md no longer declares is
    // a dead entry that would let a rename hide.
    expect(Object.keys(COLOR_TOKENS).sort()).toEqual(designKeys.sort())
    // …and no @theme colour may exist outside the declared mappings (the
    // one deliberate helper, --color-brand-text, is the dark-flipping
    // carrier of `primary-strong`-as-text and is value-checked below).
    for (const cssVar of themeColorVars()) {
      expect(
        [...Object.values(COLOR_TOKENS), ...EXTRA_THEME_COLORS],
        `@theme colour '${cssVar}' is not mapped from DESIGN.md`,
      ).toContain(cssVar)
    }
    for (const cssVar of EXTRA_THEME_COLORS) {
      // Each helper must still carry a DOCUMENTED value.
      expect(themeVar(cssVar)).toBe(designColor('primary-strong'))
    }
  })

  test('the typography transcriptions match DESIGN.md, size + leading + weight', () => {
    // Same contract as the colours: DESIGN.md's `typography:` block is the
    // source; each definition becomes three `@theme` variables.
    const declared = designTypeNames()
    expect(declared.length).toBeGreaterThan(0)
    // Key-set parity both ways: a NEW typography definition in DESIGN.md
    // must be added here, and a removed one must not leave a dead entry.
    for (const name of declared) {
      expect(TYPOGRAPHY_TOKENS[name], `DESIGN.md typography '${name}' is not in TYPOGRAPHY_TOKENS`).toBeDefined()
    }
    expect(Object.keys(TYPOGRAPHY_TOKENS).sort()).toEqual(declared.sort())
    for (const [name, cssVar] of Object.entries(TYPOGRAPHY_TOKENS)) {
      for (const [prop, suffix] of [
        ['fontSize', ''],
        ['lineHeight', '--line-height'],
        ['fontWeight', '--font-weight'],
      ] as const) {
        const declared = designType(name, prop)
        expect(declared, `${name}.${prop} missing from DESIGN.md`).not.toBeNull()
        const carried = themeVar(`${cssVar}${suffix}`)
        expect(carried, `${cssVar}${suffix} missing from src/style.css`).not.toBeNull()
        expect(carried).toBe(declared)
      }
    }
    // Reverse direction: a size variable outside the declared set is a
    // stray transcription (companion vars carry their parent's name).
    for (const v of themeTypeVars()) {
      const isCompanion = /--(line-height|font-weight)$/.test(v)
      if (!isCompanion) expect(Object.values(TYPOGRAPHY_TOKENS)).toContain(v)
    }
  })

  test('the dark theme RE-POINTS each role at its -soft token', () => {
    // The structural guarantee behind "dark mode cannot be forgotten per
    // component": under `.dark` the same variable name resolves to the
    // soft value, so a component written once is correct in both themes.
    for (const role of ALL_ROLES) {
      const spec = ICON_ROLES[role]
      const flip = styleCss.match(
        new RegExp(`\\.dark[^{]*\\{[^}]*--color-${spec.token}:\\s*var\\(--color-${spec.darkToken}\\s*(,[^)]*)?\\)`),
      )
      expect(flip, `${spec.token} is not flipped to ${spec.darkToken} under .dark`).not.toBeNull()
    }
  })

  test('roleGlyph returns the very glyph the registry names', () => {
    for (const role of ALL_ROLES) {
      expect(roleGlyph(role)).toBe(ROLE_GLYPHS[ICON_ROLES[role].glyph])
    }
  })
})

describe('ingredient, protein and diet roles', () => {
  test('the catalog categories map to their own hue', () => {
    expect(ingredientRole('meat')).toBe('meat')
    expect(ingredientRole('fish')).toBe('fish')
    expect(ingredientRole('vegetarian')).toBe('vegetarian')
  })

  test('an unknown or absent category gets NO icon rather than a wrong hue', () => {
    // The catalog publishes exactly three category names; anything else
    // is a data change, and a wrong hue is worse than no icon.
    expect(ingredientRole('vegan')).toBeNull()
    expect(ingredientRole('dessert')).toBeNull()
    expect(ingredientRole('')).toBeNull()
    expect(ingredientRole(null)).toBeNull()
    expect(ingredientRole(undefined)).toBeNull()
  })

  test('the protein filter reuses the same map, and "any" is no icon', () => {
    expect(proteinRole('meat')).toBe('meat')
    expect(proteinRole('vegetarian')).toBe('vegetarian')
    expect(proteinRole('')).toBeNull()
    expect(proteinHueClass('vegetarian')).toBe(hueClass('vegetarian'))
  })

  test('exclusion diets borrow the protein role; positive diets keep their own', () => {
    expect(dietRole('no-pork')).toBe('meat')
    expect(dietRole('no-meat')).toBe('meat')
    expect(dietRole('no-shellfish')).toBe('fish')
    expect(dietRole('vegetarian')).toBe('vegetarian')
    expect(dietRole('vegan')).toBe('vegan')
    expect(dietHueClass('no-shellfish')).toBe(hueClass('fish'))
    expect(dietHueClass('vegan')).toBe(hueClass('vegan'))
  })

  test('"any protein" and an unknown diet wear no hue rather than a guessed one', () => {
    expect(proteinHueClass('')).toBe('')
    expect(dietHueClass('no-coriander')).toBe('')
  })
})