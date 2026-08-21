---
name: rdyrct-design
description: rdyrct's design system. Use when building or changing any user interface in this repo: a marketing page, an app screen, an admin screen, a component in src/app/ui, an email, or a mockup. Covers the two type rules, the colour tokens, the component inventory, layout, motion, copy, and the anti-patterns this project rejects. Read it before writing UI, not after.
metadata:
  author: rdyrct
  version: 1.0.0
  homepage: https://rdyrct.com
---

# rdyrct design

Everything a person or an agent needs to build interface in this repo without inventing a parallel style. `AGENTS.md` owns how the project works; this owns how it looks.

The system is small on purpose. One accent, one type split, one set of tokens, two themes. Most decisions are already made, and the ones left are noted where they arise.

## The two type rules

Everything below follows from these. If a case is not covered, decide it by asking which of the two applies.

**1. Monospace is for identifiers.** JetBrains Mono carries slugs, domains, email addresses, API keys, tokens, CNAME targets, file paths, code, and timestamps. The test: would a person copy this, or type it, and does a wrong character cost them something?

Quantities are not identifiers. Click counts, percentages, deltas, quota figures, prices, human dates and durations are Figtree with `font-variant-numeric: tabular-nums`. Nobody types `1,284`. Tabular figures keep a column aligned without a monospaced face.

Set only the identifier in mono, never its sentence or its whole table. In a links row the label is Figtree, the slug is mono and the count is tabular Figtree, which is what lets the eye find the slug without a rule between the columns.

**2. No all-caps tracked eyebrows.** Not above a heading, not above a stat, not on a table header, not anywhere.

This kills the device, not the label. A bare `1,284` with nothing naming it is unusable, so a label that names a value survives as plain sentence-case Figtree at roughly 12px in `--muted`. Quiet, not shouted. A label above a section heading earns nothing, because the heading already says what the section is: delete it.

Together these two say the same thing twice. A device survives where it carries information and goes where it was habit.

## Typefaces

| Role | Face | Notes |
| --- | --- | --- |
| Everything you read | **Figtree** | 300 to 900. Headings, prose, labels, buttons, quantities. |
| Identifiers | **JetBrains Mono** | 400 and 700 only. |

Both are self-hosted through Fontsource and subset to latin. The CSP allows no remote fonts, so a Google Fonts link will silently fail in production. The two above-the-fold weights are preloaded by the `preloadFonts` plugin in `vite.config.ts`, which names its files by hand: add new weights there or they will not be preloaded.

Sentence case everywhere: headings, buttons, labels, navigation. Never title case. Never uppercase as a style.

Headings take `text-wrap: balance`. Keep prose near 60 to 68 characters a line; rewrite before shrinking. Emphasis is scarce.

## Colour

Warm paper with one muted violet. Both are load-bearing: warm cream is what keeps the product legible to a marketer rather than reading as a terminal, and the violet is the least saturated in its family precisely so it can sit on cream.

Tokens live in `src/app/styles.css` and are the only way to name a colour. Never write a hex in a component.

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--bg` | `#f7f4ef` | `#17151f` | the page |
| `--surface` | `#ffffff` | `#1f1c2b` | cards, inputs, menus |
| `--surface-2` | `#efeae2` | `#262336` | wells, hovers, table heads |
| `--border` | `#ddd5c8` | `#34304a` | every hairline |
| `--text` | `#2a2733` | `#eae7f2` | body |
| `--muted` | `#544f61` | `#c6c2d3` | labels, secondary |
| `--accent` | `#745ab8` | `#cdb9f5` | one job: the primary action, links, focus |
| `--accent-2` / mint | `#35875e` | `#b9e6c9` | success |
| `--danger` | `#c2607f` | `#f5b8c8` | destructive, errors |
| `--butter` | `#a8842c` | `#f2e3b3` | caution, pending |

The accent has one job. It is not a decoration, a background wash, or a section divider. If a screen has two accent-coloured things competing, one of them is wrong.

Semantic colour never carries meaning alone. Pair it with a word or a shape, and hold everything to WCAG AA on all three grounds (`--bg`, `--surface`, `--surface-2`). Several tokens carry a comment in `styles.css` recording the contrast measurement that set their value: do not adjust one without redoing that.

Both themes are equal. Neither is the afterthought. Style through tokens only, so a colour is never defined solely inside a media query or a `[data-theme]` block.

## Components

The kit is `src/app/ui/`. Use what is there before adding anything.

`Button` (`primary` | `outline` | `ghost` | `danger`, sizes `sm` | `md`), `IconButton`, `buttonClass()` for anchors that look like buttons, `Field` / `Input` / `Select`, `OtpInput`, `CopyButton`, `Spinner` / `BusyContent`, `Badge`, `Slug` / `SlugLink`, `Card`, `PageHeader`, `Table` / `Th` / `Td` / `SortTh`, `EmptyState`, `Skeleton` / `SkeletonStatus` / `TableSkeleton`, `Menu` / `MenuItem` / `MenuSeparator` / `MenuSelect`, `Dialog`, `ConfirmDialog`, `Tooltip`, `CursorPager` / `Pager`, `toast`.

Rules that come up every time:

- **Errors go to toasts.** Never inline red field text.
- **Loading**: a page-level skeleton that mirrors the route's layout (`components/skeletons.tsx`), never a spinner. `Spinner` is for an in-flight button, and a button never says `…`.
- **A `<button>` never nests in an `<a>`.** Give the anchor `buttonClass()` instead; there is one control or there are two tab stops fighting.
- **Badges encode state**, not metadata. `Active`, `Pending DNS`, `banned`, `suspended`, `blocked` earn a pill because losing it loses the scan. A plan or a role is an attribute of a row: set it as plain text. The test is whether removing the pill costs meaning.
- **Icons** come from `lucide-react`. Never decorative, never in a coloured tile, never mixed styles. Prefer a text label unless the icon makes an action materially faster to recognise.

## Layout

The app is a fixed 240px sidebar over a `max-w-5xl` main column. Public pages are `max-w-5xl px-6`. Do not widen either without changing every public page: an e2e test asserts the footer comes out the same width across all of them.

Lay siblings out with flex or grid and `gap`, never per-element margins that collapse or double. Give every gap one owner. Wide content (tables, code, diagrams) scrolls inside its own `overflow-x: auto` container so the body never scrolls sideways.

Hierarchy comes from typography before surfaces. Do not wrap every section in a card, do not nest panels, and do not use a border to repair a weak structure.

**Marketing pages alternate their silhouette.** Ten sections that are each a centred heading over a card grid read as one long band. Split, full-width, numbered sequence, quiet band and centred each exist; nothing should repeat more than twice in a row. Centred is still correct for a parallel set (features, pricing tiers) and for a single call to action. Alternating for its own sake is the same mistake in the other direction.

**Structure is information.** Numbered markers belong on a real sequence and nowhere else.

## Data and evidence

The analytics screens are the product's proof, so they get the strictest treatment.

- Every peer bar shares one documented scale. A bar's length must encode its value, or use aligned text instead.
- Zero baselines unless a delta view is explicitly marked.
- Size a set of bars as one layout: one shared label lane, one plot lane, one lane for values. A long label must not change the plot width. Use a parent grid or subgrid, not content-sized columns resolved inside each row.
- Direct labels beat a legend. Emphasise the endpoint of a line.
- Right-align numeric columns and their headers together; left-align text columns and theirs.
- Show units, periods and comparison bases near the evidence they qualify.
- Never invent data to fill a chart. An empty state that names what will appear is stronger than a populated screenshot of somebody else's numbers.

## Empty states

The first screen a new account meets. Each one names what will appear and offers exactly one action.

> "No data" tells you nothing. "Country, referrer and device appear here the moment someone follows one of your links" explains the feature and names the next step in one sentence.

## Motion

Default to stillness. Motion explains a state change, preserves continuity, or confirms an action. Never gate reading behind an animation, reveal every section on scroll, or add parallax, marquees, typing cursors or pulsing indicators.

The base experience is complete without motion, and `prefers-reduced-motion` is honoured everywhere (`MotionConfig reducedMotion="user"` is already in place on the landing page).

Marketing navigation swaps the content in place and then rides the new page to its top. Use `MarketingLink` for any link between public pages, and call `useMarketingScroll` in any new public page.

## Copy

Orwell's six rules, in `AGENTS.md`, apply to every word that ships. On top of them:

- **No em dashes.** A period, comma, colon or parentheses instead.
- Say **paid** for anything on any paid plan. Name **Pro** only for what only Pro has.
- Write from the reader's side of the screen. A person manages notifications, not webhook config.
- A control says what happens: "Publish", then a toast that says "Published".
- Errors say what went wrong and how to fix it. No apologies, no vagueness.
- Concrete numbers are trust signals. Prefer "30 links, 3 members" to "generous limits".

## Accessibility

Not optional and not a later pass. Landmarks, one descriptive `h1` per page, ordered headings, native controls, semantic tables, accessible names, visible focus, text alternatives. WCAG AA. Colour never carries meaning alone. Source order is reading order.

## Anti-patterns

Do not ship these, whoever asked:

- All-caps or tracked eyebrows, kickers and overlines.
- Em dashes.
- Decorative gradients, gradient text, glows, blobs, glass, noise textures or fake depth. A gradient is acceptable only as a labelled continuous data scale.
- A centred hero over a card grid, repeated down the page.
- A badge or pill for ordinary metadata.
- Cards inside cards, or a border repairing weak hierarchy.
- Monospace on a heading, a sentence, or a whole table.
- Tiny muted prose used to make density fit. Rewrite instead.
- Arbitrary font sizes or numeric weights outside the scale.
- Stock imagery, decorative illustration, or a fake product screenshot. The anonymous shortener is a working demo; use the real thing.
- Remote fonts, images, scripts or fetches. The CSP forbids them and the failure is silent.

Restraint here is precise hierarchy, good typography, clear evidence and strong alignment. It is not merely cream, thin rules and empty margins.

## Where this applies

Every surface, with no exception for the ones users see less: the marketing pages, the app, **the admin screens** (`src/app/routes/admin/`), the auth and invite cards, the error and not-found pages, and emails.

Admin is not a place where the rules relax. It is dense, table-heavy and numeric, which makes it the surface where the identifier and quantity split does the most work.
