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

## The mark

The Hop: a small dot leaves, an arc carries it, a gap, and a larger dot lands with a flat shadow under it. A click going from a short link to its destination. Keep the dot; an arrowhead in its place turns it into the redo icon.

- **In the interface, use `Logo`** (`src/app/ui/logo.tsx`): the glyph and the word, sized by the font size it sits in. Never retype the name in bold or tracked caps as a brand.
- **No tile next to the word.** The lavender tile belongs to places where the mark stands alone: the favicon (`public/favicon.svg`), the app and connector icon (`public/connector-icon.svg`), the OG image.
- **Colour follows the theme.** In the interface the arc and launch dot take `currentColor`, the landing dot `fill-accent` and the shadow `fill-border`. On the tile the ink is `#140f1f` on `#cdb9f5`, shadow `#9283b1`.
- **At 24px and below use the small cut**: a thicker arc, bigger dots, no shadow. `favicon.svg` is that cut. The full mark turns to mush at 16px.
- **The wordmark** in the static files (`public/logo.svg`, `public/email-logo.png`) is Figtree 700 at −3.5% tracking, converted to outlines so it renders without the font. In the app it is live text in the same face.

## Components

The kit is `src/app/ui/`. Use what is there before adding anything.

`Button` (`primary` | `outline` | `ghost` | `danger`, sizes `sm` | `md`), `IconButton`, `buttonClass()` for anchors that look like buttons, `Field` / `Input` / `Select`, `OtpInput`, `CopyButton`, `Spinner` / `BusyContent`, `Badge`, `Slug` / `SlugLink`, `Card`, `PageHeader`, `Table` / `Th` / `Td` / `SortTh`, `EmptyState`, `Skeleton` / `SkeletonStatus` / `TableSkeleton`, `Menu` / `MenuItem` / `MenuSeparator` / `MenuSelect`, `Dialog`, `ConfirmDialog`, `Tooltip`, `CursorPager` / `Pager`, `toast`.

Rules that come up every time:

- **A form error marks the field and says why in its label row.** On submit, every bad field gets the danger outline, a short reason sits on the right of that field's label line ("Needs https://", "Already taken", "Required"), the field carries `aria-invalid="true"` and `aria-describedby` pointing at the reason, and focus moves to the first bad field. Nothing below the field, so nothing shifts. A reason too long for the label row goes in the description for screen readers and a tooltip. Not a toast: a form error is about a field, and a toast can be missed or time out.
- **Toasts are for outcomes, not for form errors.** "Link created", "Copied", a request that failed for a reason no field owns. Routine ones use `role="status"`; only an urgent failure uses `role="alert"`.
- **Submit stays enabled.** Validate on submit, then mark the fields. A greyed-out button that never says why is a dead end.
- **Loading**: a page-level skeleton that mirrors the route's layout (`components/skeletons.tsx`), never a spinner. `Spinner` is for an in-flight button, and a button never says `…`.
- **A `<button>` never nests in an `<a>`.** Give the anchor `buttonClass()` instead; there is one control or there are two tab stops fighting.
- **Badges encode state**, not metadata. `Active`, `Pending DNS`, `banned`, `suspended`, `blocked` earn a pill because losing it loses the scan. A plan or a role is an attribute of a row: set it as plain text. The test is whether removing the pill costs meaning.
- **Icons** come from `lucide-react`. Never decorative, never in a coloured tile, never mixed styles. Prefer a text label unless the icon makes an action materially faster to recognise.

## The app's surfaces

The app is built from depth and nesting, not lines. These are the decisions behind every screen; the mockups they came from live in the app audit (`rdyrct-app-audit/mocks/evolved.html`).

- **One raised sheet.** The sidebar and the phone's top bar sit on the paper (`--bg`). The page sits on one raised `--surface` sheet with a 14px radius and the standard shadow. Nothing else in the page is raised as high.
- **Depth from layered shadows, not borders.** A card, an input, a menu or a selected tab is lifted by a ring-plus-blur shadow (`smooth-shadow-ring-*`). Dividers inside a surface are hairlines drawn as inset shadows, never a border that adds to the box.
- **Radii nest.** Outer radius equals inner radius plus the padding between them: a 12px panel with 4px padding holds 8px items; a menu is 12 / 4 / 8; a segmented control is 9 / 2 / 7. A nested corner that does not follow this looks wrong before anyone can say why.
- **Settings are rows, not cards with footers.** The label (and at most one short line) on the left, the control on the right, in one card per group under a small muted group heading. No grey footer strip, no description paragraphs. Settings, Organization, Billing and Domains sit in a ~760px column so the label and its control stay close.
- **Panels hold lists behind tabs.** Analytics and the dashboard group related lists in one card with underline tabs ("Top links · Decaying · Dead"), the way Plausible and Umami do, rather than a separate card per list.
- **Bar lists put the label inside the bar.** A 30px row, the tinted bar sized to the value behind the label, the count and its share in aligned columns to the right, column headings above. One shared scale per list.
- **Stats and the chart share a card.** A compact strip of figures above the chart, the selected one shaded because it is what the chart plots, each figure with its change beside it.
- **Charts are smooth and honest.** A monotone cubic curve (it never overshoots a point, so it never dips below zero between two empty days), a faint fill to a zero baseline, direct labels, dates as "Oct 5". A hover guide and a small tooltip instead of a legend.
- **Tables earn two lines.** The name in bold over its identifier in mono, the number right-aligned and tabular, row actions in a fixed column that appears on hover. A filter row with counts above a long table.
- **Creating is a dialog.** "New link" is a header button with the `C` shortcut, not a form parked on the page. The form is one column with UTM tags inline; the QR preview, the short link and the full destination sit in a side column with "Customize QR", which opens the QR editor in the same dialog. QR defaults on Organization use the same editor rows.
- **⌘K finds and does.** Recent links, pages and actions in one list, the match in the accent, the keys shown in the footer.
- **One primary button per screen.** A second action is secondary or quiet.
- **Over the plan is one notice.** A single line of facts ("Links 184 of 30 · Members 23 of 3 · Domain stops Nov 6") with one action, above the page title. Never stacked banners.
- **On a phone** the same markup stacks: columns become one, dialogs and ⌘K open as bottom sheets with a handle, the drawer floats over a dimmed page, and every target is at least 40px.

## Layout

The app is a fixed 240px sidebar over a `max-w-5xl` main column. Public pages sit in `page-column` (styles.css: 84rem, `px-6`), wide as the best pages in this category run; long text inside keeps its own measure (`max-w-3xl` or narrower). Change the column in that one utility, never per page: the stand-in shown while a page loads (main.tsx) uses it too, so the header does not jump.

Lay siblings out with flex or grid and `gap`, never per-element margins that collapse or double. Give every gap one owner. Wide content (tables, code, diagrams) scrolls inside its own `overflow-x: auto` container so the body never scrolls sideways.

Hierarchy comes from typography before surfaces. Do not wrap every section in a card, do not nest panels, and do not use a border to repair a weak structure.

**Marketing pages alternate their silhouette.** Ten sections that are each a centred heading over a card grid read as one long band. Split, full-width, numbered sequence, quiet band and centred each exist; nothing should repeat more than twice in a row. Centred is still correct for a parallel set (features, pricing tiers) and for a single call to action. Alternating for its own sake is the same mistake in the other direction.

**Structure is information.** Numbered markers belong on a real sequence and nowhere else.

**The marketing header is part of the page at the top and a frosted pill once it scrolls** (`components/landing-header.tsx`), modelled on getopen.so. At the top it is transparent and `max-w-5xl`: the logo and the nav together on the left, the nav as plain muted text links (the current page in `--text`, no well, no tab), the actions on the right. Past 8px it shrinks to a `max-w-3xl` pill 12px below the edge, shorter, with a translucent `bg-surface/70`, `backdrop-blur-xl backdrop-saturate-150`, a faint edge, a light inset rim and a soft shadow; width, spacing and surface ease together over 700ms on `cubic-bezier(0.32,0.72,0,1)`, so the logo moves only with the shrink. "Product" opens a panel of the deeper pages, kept open on the way to it by `useSafeHover`. On a phone the same pill grows down into a full-width card holding every page, Log in and Get started (`components/phone-menu.tsx`); the current page carries the mark's accent dot. Add a page to `components/marketing-nav.ts` and both get it. Do not add a second glass surface on the strength of this one.

## Light on the marketing pages

The public pages are allowed a small, named set of effects that the app is not. Use these and nothing else; each is a utility in `styles.css` and follows both themes through the tokens.

- **The frame.** Below the hero, sections sit between two hairline rails (`border-x border-border/70`), each row opened by a hairline with a small cross where it meets a rail (`FrameRow` in `components/marketing-kit.tsx`). The crosses are drawn from 1px bars centred on the exact pixel where the lines meet, never a typed `+`, whose position depends on the font. Close every frame with an empty `<FrameRow />` so its bottom corners are crossed too. The 404 (`components/not-found-view.tsx`) wears the same frame, with no brand in it because custom domains show it.
- **Feature cards** (`landing-pillars.tsx`). Under each landing section's heading, its three details sit in a row of cards of their own (`--surface-2`, a hairline, `rounded-2xl`), one column on a phone. Each card has a short loop of the product doing that one thing over the soft light, then the icon in the accent, a bold title and one line. No tabs and no timers: every detail is on screen at once.
- **Pages end on a band.** The landing closes on an `ink-band` call to action as wide as the column, with a dot field and the mesh glow; the footer runs to the same edges.
- **Two-tone headings.** The claim in ink, the reason muted, in one `h2` (`SplitHeading` in `components/landing-pillars.tsx`). This replaces a heading plus a subtitle; it is not an eyebrow.
- **`lit`**: a panel lit from above, a hairline of light on its top edge and a long soft shadow. For the product shown over sample data, and the cards of the dark band.
- **`landing-mesh`**: one blurred field of the accent, the mint and the butter behind a product panel. Decoration, `aria-hidden`, never behind text.
- **`ink-band`**: the one dark band on a page. It redefines the tokens inside it, so ordinary components work in it unchanged.
- **`text-metal`**: the closing line only, ink fading to muted.
- **`PageHero`** (`components/marketing-kit.tsx`): how every public page but the landing opens, title large and left over a field of dots inside the frame. `MarketingPage` and `LegalPageLayout` use it; a new page uses one of those two.
- **The footer wordmark**: the name as wide as the page, fading out and cut by the bottom edge, on every public page. Decoration, `aria-hidden`.

The product in a card is the app's own UI over sample data, never a screenshot. Benefits on the landing; redirects, data centres and competitors' prices on the docs and comparison pages.

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

Default to stillness. Motion explains a state change, preserves continuity, or confirms an action. Never gate reading behind an animation, reveal every section on scroll, or add parallax, marquees, blinking cursors or pulsing indicators.

The base experience is complete without motion, and `prefers-reduced-motion` is honoured everywhere (`MotionConfig reducedMotion="user"` is already in place on the landing page).

The interface rules, from interfaces.dev's cheat sheet:

- **Frequent menus open instantly.** The org switcher, the account menu and row menus appear at once and animate only on close: a short fade with a 4px blur, from the trigger (`transform-origin` at the trigger's corner).
- **Exits are subtler than entrances.** Shorter travel, plus opacity and a small blur.
- **Name the properties.** `transition: scale 200ms ease-out, opacity 150ms`, never `transition: all`.
- **Buttons give on press:** `scale: 0.97` over 200ms.
- **Icon swaps crossfade:** the new icon from scale 0.25, opacity 0 and 4px blur to rest, the old one the reverse.
- **CSS transitions for interactions** (they can reverse mid-way); keyframes only for one-time sequences. Transitions are off while the theme switches (already done in `lib/theme.ts`).
- **Hover only where there is hover:** wrap hover styles in `@media (hover: hover)`.
- **Frequent interactions are instant or very fast;** nothing animates on page load unless it is the point.

**The landing's feature cards loop** (`FeatureCard` in `components/landing-pillars.tsx`): each plays the product doing what its title says, a step every 700ms, with CSS transitions between steps (reversible, opacity, scale, a little blur). They start in their finished state, which is what the prerendered page and reduced motion show, play only while half on screen, and are `aria-hidden` because the title and line say the same thing. A new card is a list of steps whose last one is finished.

**The other exception is the landing hero's globe** (`components/hero-globe.tsx`): clicks hopping between cities, drawn the way the mark is drawn (a small dot leaves, an arc, the accent dot lands on a flat shadow). It is allowed to move because it says what the product does, and it keeps these terms. Do not add a second ambient animation on the strength of it.

- Decoration, not evidence: `aria-hidden`, example links, no counters, nothing that claims to be live. A link the visitor makes in the hero's shortener is the only real one, and it is outlined in the accent.
- Not in the prerendered HTML. It loads after hydration into a box the hero reserves, so the heading is the first paint and nothing shifts.
- cobe draws the sphere and land in WebGL; the hops, landings and labels are a 2D canvas over it that projects with cobe's own rotation. Colours come from the tokens at runtime and follow the theme.
- Paused off screen and in a background tab; one still frame under reduced motion.

Marketing navigation swaps the content in place and then rides the new page to its top. Use `MarketingLink` for any link between public pages, and call `useMarketingScroll` in any new public page.

## Copy

Orwell's six rules, in `AGENTS.md`, apply to every word that ships. On top of them:

- **No em dashes.** A period, comma, colon or parentheses instead.
- Say **paid** for anything on any paid plan. Name **Pro** only for what only Pro has.
- Write from the reader's side of the screen. A person manages notifications, not webhook config.
- A control says what happens: "Publish", then a toast that says "Published".
- Errors say what went wrong and how to fix it. No apologies, no vagueness.
- Concrete numbers are trust signals. Prefer "30 links, 3 members" to "generous limits".
- Buttons start with a verb, and a confirm button names the action: "Delete link" beside "Cancel", never "OK".
- One label for moving forward through a flow.
- A toggle is named for its on state: "Product news", not "Disable emails".
- Link text names the destination.
- Curly quotes and a real ellipsis (…). The em dash stays banned.
- Address the reader as "you".

## Accessibility

Not optional and not a later pass. Landmarks, one descriptive `h1` per page, ordered headings, native controls, semantic tables, accessible names, visible focus, text alternatives. WCAG AA. Colour never carries meaning alone. Source order is reading order.

- Style `:focus-visible`, and never remove an outline without a replacement.
- Hit areas at least 24px everywhere, 40px on desktop controls and 44px on touch, never overlapping.
- `tabindex` is only ever `0` or `-1`. Icon-only buttons have an `aria-label`; nothing focusable is `aria-hidden`.
- Every input has a visible label and the right `type` and `inputmode`. Never block paste.
- Decorative layers take `pointer-events: none`.
- Truncated text shows in full on hover or when expanded. Identifiers and URLs wrap with `overflow-wrap: anywhere`; labels and badges do not wrap.
- Images and avatars carry a 1px outline at 8% (black in light, white in dark), inset by 1px, so a light image does not melt into the surface.
- Icon strokes match the weight of the text beside them; an icon-and-text button has slightly less padding on the icon side.

## Anti-patterns

Do not ship these, whoever asked:

- All-caps or tracked eyebrows, kickers and overlines.
- Em dashes.
- Decorative gradients, gradient text, glows, blobs, glass, noise textures or fake depth, beyond the named set in "Light on the marketing pages". A gradient is otherwise acceptable only as a labelled continuous data scale.
- A centred hero over a card grid, repeated down the page.
- A badge or pill for ordinary metadata.
- Cards inside cards, or a border repairing weak hierarchy.
- Monospace on a heading, a sentence, or a whole table.
- Tiny muted prose used to make density fit. Rewrite instead.
- Arbitrary font sizes or numeric weights outside the scale.
- Stock imagery, decorative illustration, or a fake product screenshot. The anonymous shortener is a working demo; use the real thing.
- Remote fonts, images, scripts or fetches. The CSP forbids them and the failure is silent. The one exception is Fazier's launch badge in the landing footer (`FazierBadge` in `ui/footer.tsx`), allowed in img-src for rdyrct.com's build only, because their verifier needs their own image.

Restraint here is precise hierarchy, good typography, clear evidence and strong alignment. It is not merely cream, thin rules and empty margins.

## Where this applies

Every surface, with no exception for the ones users see less: the marketing pages, the app, **the admin screens** (`src/app/routes/admin/`), the auth and invite cards, the error and not-found pages, and emails.

Admin is not a place where the rules relax. It is dense, table-heavy and numeric, which makes it the surface where the identifier and quantity split does the most work.
