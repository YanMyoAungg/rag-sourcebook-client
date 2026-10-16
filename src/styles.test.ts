import { describe, expect, it } from 'vitest'
import styles from './styles.css?raw'

/**
 * The palette in src/styles.css was mapped by hand onto shadcn's token names, so
 * it is checked rather than trusted: every text pair has to stay legible, and
 * every border and focus indicator has to stay distinguishable. The theme is
 * dark-only, so there is one set of values and no cascade to worry about.
 */
function token(name: string): string {
  const value = styles.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]

  if (!value) {
    throw new Error(
      `--${name} is not defined as a hex colour in styles.css: ` +
        `read ${styles.length} characters starting "${styles.slice(0, 120)}"`,
    )
  }

  return value
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(one: string, other: string): number {
  const [lighter, darker] = [relativeLuminance(one), relativeLuminance(other)].sort(
    (a, b) => b - a,
  )

  return (lighter + 0.05) / (darker + 0.05)
}

const TEXT_PAIRS: Array<[foreground: string, background: string]> = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['foreground', 'accent'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['destructive', 'card'],
]

/**
 * Boundaries a person needs in order to see that a control exists, and the
 * focus and selection colours, are held to 3:1. The decorative --border that
 * groups cards is not in this list: it is not what identifies a control.
 */
const INDICATOR_PAIRS: Array<[indicator: string, background: string]> = [
  ['input', 'background'],
  ['input', 'card'],
  ['primary', 'background'],
  ['ring', 'card'],
]

describe('styles.css palette', () => {
  it.each(TEXT_PAIRS)('keeps --%s text legible on --%s at 4.5:1', (foreground, background) => {
    expect(contrastRatio(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(INDICATOR_PAIRS)(
    'keeps --%s distinguishable from --%s at 3:1',
    (indicator, background) => {
      expect(contrastRatio(token(indicator), token(background))).toBeGreaterThanOrEqual(3)
    },
  )
})
