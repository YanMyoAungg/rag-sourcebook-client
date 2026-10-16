# 8. Dark theme and design tokens

> One palette, one live region, one font pair — and a test that checks the
> contrast of the colours rather than trusting the eye that chose them.

## What it does

Defines every colour the app uses, in one place, as shadcn's token names. The
theme is dark-only: there is one set of values and no cascade to reason about.
It also fixes the typography (Geist and Geist Mono), the radius scale, and the
`color-scheme` that makes native controls match.

## How it works

### One palette, in `:root`

```css
/*
 * One theme, and it is the dark one: near-black canvas, surfaces a step above
 * it, borders as a low-alpha white, and a single functional blue for focus.
 * The app ships no light mode, so these live in :root and nothing overrides
 * them. Every pair is checked in src/styles.test.ts.
 */
:root {
    --background: #0a0a0a;
    --foreground: #ededed;
    --card: #111111;
    --card-foreground: #ededed;
    --popover: #111111;
    --popover-foreground: #ededed;
    --primary: #ededed;
    --primary-foreground: #0a0a0a;
    --secondary: #1a1a1a;
    --secondary-foreground: #ededed;
    --muted: #171717;
    --muted-foreground: #a1a1a1;
    --accent: #1f1f1f;
    --accent-foreground: #ededed;
    --destructive: #ff6166;
    /* Decorative only: it groups cards, and nothing depends on seeing it. */
    --border: #ffffff1a;
    /* Control boundaries (file input, textarea) are the only thing identifying
       those fields, so this is lighter than the decorative --border: 3.7:1 on
       the page background, comfortably above the 3:1 that WCAG 1.4.11 asks
       for. It is written as a solid colour rather than a white alpha so the
       contrast it actually has is the contrast it has. */
    --input: #6c6c6c;
    --ring: #006bff;
    …
    --radius: 0.375rem;
}
```

Read as layers:

| Layer | Token | Value | Role |
| --- | --- | --- | --- |
| Canvas | `--background` | `#0a0a0a` | the page |
| Surface | `--card`, `--popover` | `#111111` | cards, tool rows, disclosures |
| Raised | `--secondary`, `--muted`, `--accent` | `#1a1a1a`, `#171717`, `#1f1f1f` | badges, hover, muted panels |
| Text | `--foreground` | `#ededed` | body text |
| Text, quieter | `--muted-foreground` | `#a1a1a1` | labels, durations, scores |
| Boundary | `--border` | `#ffffff1a` | decorative grouping only |
| Boundary, functional | `--input` | `#6c6c6c` | the outline that identifies a control |
| Focus | `--ring` | `#006bff` | focus rings |
| Failure | `--destructive` | `#ff6166` | error text |

Two subtleties are documented in the file itself and are worth restating:

- **`--border` is decorative and low-contrast on purpose.** It groups cards; no
  control's existence depends on seeing it. It is therefore excluded from the
  contrast test ([below](#the-contrast-test)).
- **`--input` is a solid grey, not a white alpha.** A white alpha's effective
  contrast depends on what is behind it, so the colour that is checked would not
  be the colour that is seen. Written solid, it measures 3.7:1 against the page —
  above the 3:1 WCAG 1.4.11 asks for non-text boundaries.

### Tokens become Tailwind utilities

```css
@theme inline {
    --font-heading: var(--font-sans);
    --font-sans: 'Geist Variable', sans-serif;
    /* Tool names, filenames, durations, and scores: the monospace registers
       Vercel uses for anything you might compare character by character. */
    --font-mono: 'Geist Mono Variable', ui-monospace, SFMono-Regular, monospace;
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    /* …every token, one line each… */
    --radius-sm: calc(var(--radius) * 0.6);
    --radius-md: calc(var(--radius) * 0.8);
    --radius-lg: var(--radius);
    /* …up to --radius-4xl… */
}
```

`@theme inline` is the Tailwind v4 mechanism: each `--color-*` entry generates
`bg-*`, `text-*`, `border-*` utilities, and using `inline` keeps the values as
`var(--background)` references rather than inlining them. That is what lets a
component write `bg-card` and `text-muted-foreground` and get the tokens above.

The radius scale is derived from a single `--radius: 0.375rem`, so changing one
number rescales every rounded corner (the tool rows are `rounded-md`, the evidence
disclosure `rounded-lg`).

### Why `class="dark"` on an app with no light mode

```css
@custom-variant dark (&:is(.dark *));
```

```html
<html lang="en" class="dark">
```

The app ships one palette, so nothing needs to switch. The class is there because
the shadcn components in `src/components/ui/` carry their own `dark:` variants —
that is how they were generated. Without `class="dark"` on the root, every one of
those variants would resolve to its light branch, and the vendored components
would disagree with the palette around them.

### Fonts

```css
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";
```

Both come from Fontsource as packages, so they are served from the app's own
origin — no third-party font request, no layout shift from a late-loading
stylesheet, and no external dependency at runtime.

- **Geist Variable** for everything read as prose, including `--font-heading`
  (which is just the sans stack).
- **Geist Mono Variable** for anything you might compare character by character:
  the tool name, filenames, chunk numbers, durations, relevance scores. The sizing
  utility `tabular-nums` is applied alongside it wherever numbers line up in a
  column.

### Native controls follow the theme

```css
@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground antialiased; }
  html {
    @apply font-sans;
    /* Native scrollbars, form controls, and the caret follow the theme. */
    color-scheme: dark;
  }
}
```

and in `index.html`, before the stylesheet loads:

```html
<meta name="color-scheme" content="dark" />
<meta name="theme-color" content="#0a0a0a" />
```

`color-scheme: dark` is what makes the scrollbar, the file input's button, and
the text caret dark without a single line of custom CSS. The metas are declared
before the stylesheet so the first paint is already dark — and `theme-color` is
what mobile browser chrome uses for the address bar.

### The contrast test

The palette was mapped onto shadcn's token names by hand, so it is checked rather
than trusted. `src/styles.test.ts` reads the stylesheet with a `?raw` import,
extracts the hex values, and computes WCAG contrast ratios:

```ts
const TEXT_PAIRS: Array<[foreground: string, background: string]> = [
  ['foreground', 'background'], ['foreground', 'card'], ['foreground', 'accent'],
  ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'], ['secondary-foreground', 'secondary'], ['destructive', 'card'],
]

/**
 * Boundaries a person needs in order to see that a control exists, and the
 * focus and selection colours, are held to 3:1. The decorative --border that
 * groups cards is not in this list: it is not what identifies a control.
 */
const INDICATOR_PAIRS: Array<[indicator: string, background: string]> = [
  ['input', 'background'], ['input', 'card'], ['primary', 'background'], ['ring', 'card'],
]

describe('styles.css palette', () => {
  it.each(TEXT_PAIRS)('keeps --%s text legible on --%s at 4.5:1', (foreground, background) => {
    expect(contrastRatio(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(INDICATOR_PAIRS)('keeps --%s distinguishable from --%s at 3:1', (indicator, background) => {
    expect(contrastRatio(token(indicator), token(background))).toBeGreaterThanOrEqual(3)
  })
})
```

Nine text pairs at 4.5:1 (WCAG AA for body text) and four indicator pairs at 3:1
(non-text contrast, WCAG 1.4.11) — thirteen assertions, each named after the two
tokens it compares, so a failure says exactly which pair broke and by how much.
The maths is WCAG's own relative-luminance formula, implemented in the test file
rather than pulled from a library.

### The other accessibility rules the UI follows

None of these are a single feature, but they are the theme's contract with the
rest of the app:

- **`role="status"` on the one live region.** The status line is announced; the
  streaming answer is not read out word by word
  ([Tool trace UI](06-tool-trace-ui.md)).
- **`role="alert"` for problems** — upload refusals, library failures, turn
  errors — and `role="status"` for progress, because the two have different
  urgency.
- **`motion-safe:` on every animation.** With `prefers-reduced-motion: reduce`
  there are zero pulsing elements (verified in the browser).
- **A visible focus ring at 3:1 against its background** (`--ring` on `--card` is
  in the indicator list), and a keyboard walk reaches every control — the tool
  row toggles with Enter alone and flips `aria-expanded`.
- **Status is words as well as colour,** so nothing is communicated by hue alone
  ([Tool trace UI](06-tool-trace-ui.md)).
- **`text-balance` on headings**, so a two-word heading does not leave one word
  on its own line at narrow widths.

## Decisions and rejected alternatives

- **Dark-only, one palette.** shadcn ships light and dark token sets; the
  requirement was a black theme. Keeping one set means one place to change a
  colour, no cascade, and no chance of a light/dark mismatch — at the cost of no
  light mode, which is a deliberate product choice here.
- **Keep `class="dark"` anyway.** Explained above: the vendored components carry
  `dark:` variants, and the class is what selects them.
- **Tokens mapped onto shadcn's names** rather than a bespoke set. Every copied
  component then themes itself, and the app never has to override a component's
  colours.
- **The palette is tested, not eyeballed.** Contrast is arithmetic; a hand-picked
  grey is exactly the kind of value that quietly fails for someone. The test also
  documents which pairs the design *intends* to keep legible.
- **`--input` solid rather than alpha.** So the tested value is the rendered
  value.
- **Geist and Geist Mono via Fontsource.** Same-origin fonts, no request to a
  third party, and the mono register is what makes the trace read as a developer
  tool — the one place the design deliberately adopts that vocabulary.
- **No component library beyond the vendored shadcn pieces.** No colour system,
  no theme provider, no CSS-in-JS runtime.

## Where it can bite you

- **`token()` requires a six-digit hex.** A token changed to `#fff`, `rgba(…)`,
  or `oklch(…)` makes the test throw *"—x is not defined as a hex colour in
  styles.css"*, which reads like a missing token rather than a changed format.
  The chart tokens are already `oklch(…)` and pass only because the test never
  reads them.
- **Alpha tokens cannot be measured.** `--border` and `--sidebar-border` are
  `#ffffff1a`; their effective contrast depends on what is behind them. Anything
  that starts relying on a border to identify a control would need a solid token
  and a test entry, not the decorative one.
- **A new token is not tested until it is listed.** The test iterates explicit
  pairs, so a new text colour on a new background is only proven once someone
  adds the pair. Failing to add it is silent.
- **The light-mode trap.** Adding a `light` class or removing `dark` from
  `<html>` would not break the palette (which lives in `:root`) but would flip
  every vendored component to its light branch, producing a half-styled UI.
- **`color-scheme: dark` is the only thing theming native controls.** A page
  rendered without the stylesheet (a build error) shows light native controls on
  a white page — the meta tag helps the chrome, not the form controls.
- **`class="dark"` lives in `index.html`, not in React.** Nothing in the app can
  toggle it; the theme is a property of the document.

## Questions this invites

**Why is the palette in `:root` if the class is `dark`?**
Because there is only one palette. `:root` is the natural place for values that
apply always; the class exists solely to satisfy the vendored components'
`dark:` variants. Putting the values under `.dark` would add a selector for no
behavioural difference.

**Why test colours instead of using a design system that enforces them?**
The colours were chosen by hand and mapped onto someone else's token names —
exactly the situation where a check pays for itself. The test is 75 lines and
catches the one class of mistake (a grey that is too dark on a dark card) that is
invisible to the person who picked it on a good monitor.

**What would adding a light mode cost?**
A second token block (probably `.light`), a toggle that sets the class, a decision
about persistence, and a doubling of the contrast pairs. The palette would stay
the source of truth; the work is in the pairs and the toggle, not the colours.

**Why `tabular-nums` in a chat UI?**
Because durations and relevance scores appear in columns (inside a tool row, and
in the evidence list). Without tabular figures, changing digits shift the layout
slightly as an answer streams.

**How do you know the reduced-motion path works?**
It was checked in the browser with `prefers-reduced-motion: reduce` emulated:
zero elements report a running animation. The mechanism is Tailwind's
`motion-safe:` variant on every `animate-pulse`, so the media query is what
decides, not JavaScript.

## Related

- [Tool trace UI](06-tool-trace-ui.md) — the component that relies on the mono
  register, the status-chip contrast, and the reduced-motion rules.
- [Scaffold and configuration](01-scaffold-and-configuration.md) — `css: true` in
  the Vitest config, without which this test cannot read the stylesheet.
- `src/styles.test.ts` — the thirteen contrast assertions in full.
