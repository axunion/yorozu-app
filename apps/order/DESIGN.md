# DESIGN.md — yorozu-app / apps/order

> This file is the single source of truth for the visual specification of
> `apps/order` (the customer-facing self-order SPA). Treat it as the canonical
> reference when generating or implementing UI — both for AI agents and human
> developers.
>
> **Scope:** `apps/order` only. For `apps/admin` see `apps/admin/DESIGN.md`.
> Design specifications for `apps/signup` are out of scope. For component
> ownership rules see [§10 Component Ownership Policy](#10-component-ownership-policy).

---

## 1. Visual Theme & Atmosphere

- **Design direction:** Premium, warm, natural earth tones. Conveys craftsmanship
  and calm trust while delivering a self-order experience that completes entirely
  within a single mobile screen.
- **Density:** Relaxed mobile-first layout. Item names and prices are large and
  legible; ordering actions resolve in one tap.
- **Keywords:** terracotta, sand, premium, intuitive, warmth, simple.
- **Signature:** Terracotta (fired-clay red-brown) drives all primary CTAs.
  Honey ochre accents supplementary emphasis. Base tones are warm ivory and
  white for cleanliness; espresso-brown text adds refinement. No vivid green
  or red — only earth-shifted olive/sage is permitted for semantic success
  states; saturated brand greens and reds are excluded entirely.

---

## 2. Color Palette & Roles

> **Implementation note:** Map these hex values to the `--color-*` CSS custom
> properties in `packages/ui/src/styles/tokens.css`. The hex values here are
> canonical; the CSS variables are the implementation vehicle.

### Primary — Terracotta

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#C0552F` | Main brand color. Per-item order CTAs ("Order") |
| Primary Hover | `#A2441F` | Hovered primary button |
| Primary Active | `#88381A` | Pressed/active primary button |
| Primary Foreground | `#FFFFFF` | Text on terracotta background |
| Sand (Subtle) | `#F7ECE4` | Muted primary background — secondary buttons, form highlights |

### Accent — Honey Ochre

| Role | Hex | Usage |
|------|-----|-------|
| Accent | `#D89A4E` | Supplementary emphasis and promotional actions (badges, hints) |
| Accent Hover | `#C6862F` | Hovered accent element |
| Accent Subtle | `#FBF1E0` | Muted accent background surface |

### Neutral — Warm Sand / Taupe

| Role | Hex | Usage |
|------|-----|-------|
| Background (Warm Ivory) | `#FAF6F1` | Page background |
| Surface | `#FFFFFF` | Cards, sections, input backgrounds |
| Foreground (Espresso) | `#2B221C` | Primary text — warmer than pure black |
| Muted Foreground (Warm Taupe) | `#6E6258` | Descriptions, secondary information |
| Subtle Foreground (Stone) | `#9A8E82` | Input placeholders, disabled states |
| Border | `#E7DED4` | Dividers, card outlines |
| Input Border | `#D8CCBE` | Input field outlines |

### Semantic — Earth-Shifted (no green or red)

> Primary (terracotta) and Danger (deep rust) are adjacent on the hue wheel.
> Always pair them with icons or labels to disambiguate meaning.

**Success — Olive / Sage** (order confirmed, service completed)

| Role | Hex |
|------|-----|
| Foreground | `#5C6B2E` |
| Background | `#F2F3E6` |
| Border | `#C2C98F` |
| Solid (success button fill) | `#6E7F35` |

**Danger — Deep Rust** (errors, warnings requiring action)

| Role | Hex |
|------|-----|
| Foreground | `#9E3318` |
| Background | `#FBEDE7` |
| Border | `#E8B79F` |

**Warning — Mustard / Amber** (soft cautions)

| Role | Hex |
|------|-----|
| Foreground | `#8A5A12` |
| Background | `#FBF1DC` |
| Border | `#E6C277` |

---

## 3. Typography Rules

### 3.1 Japanese font stack

- Gothic (sans-serif) only — no mincho/serif typefaces.
- Priority: Hiragino Sans → Hiragino Kaku Gothic ProN → Noto Sans JP → Meiryo.

### 3.2 Latin glyphs

- `system-ui` at the front of the stack picks up the OS native Latin glyphs.
- No web fonts — adding them degrades mobile load time without meaningful gain.

### 3.3 font-family declaration

```css
font-family:
  system-ui,
  "Hiragino Sans",
  "Hiragino Kaku Gothic ProN",
  "Noto Sans JP",
  Meiryo,
  sans-serif;
```

Fallback rationale: `system-ui` covers modern browsers; macOS falls back to
Hiragino Sans; Android/Linux to Noto Sans JP; Windows to Meiryo.

### 3.4 Type scale

| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| Screen Title | 20px | 600 | 1.25 | Header seat name / screen title |
| Section Heading | 16px | 600 | 1.5 | "Menu", "Your order", etc. |
| Category Label | 12px | 600 | 1.4 | Category divider label; uppercase + letter-spacing |
| Item Name | 16px | 500 | 1.4 | Product name — the visual anchor of each row |
| Item Price | 14px | 600 | 1.4 | Price; terracotta color for visual hierarchy |
| Body | 16px | 400 | 1.6 | Body copy; 16px minimum prevents iOS Safari auto-zoom |
| CTA (button label) | 16px | 600 | tight | "Order", "Request payment", etc. |
| Small / Tag | 12px | 400–600 | 1.4 | Badges, supplementary info |
| Caption | 13px | 400 | 1.5 | Status text, footnotes |

### 3.5 Line height and letter spacing

- Body line height: `1.6` (16px → 25.6px). Standard comfortable reading for Japanese.
- Heading line height: `1.25–1.5`.
- Letter spacing: `normal` (0) for all roles except Category Label.
- Category Label exception: `letter-spacing: 0.05em` to complement the uppercase treatment.

### 3.6 Word breaking

```css
word-break: break-all;
overflow-wrap: break-word;
```

### 3.7 OpenType features

```css
font-feature-settings: normal;
```

Neither `palt` nor `kern` are used. No manual kerning applied.

---

## 4. Component Stylings

> **Implementation rule:** Hex values in this section are canonical design
> references for human readability. When writing actual CSS, always use CSS
> custom properties (`var(--color-*)`, `var(--space-*)`, `var(--radius-*)`,
> etc.) — never hardcode hex or px directly. This is required for the Phase 3
> store-theme override mechanism (`tokens.css` comment, lines 6–8) to work
> correctly. The §2 implementation note gives the authoritative mapping
> instruction.

### Buttons

Base border-radius is `radius-md` (8px). Pill shape (`radius-full`) is reserved
exclusively for category nav chips.

**Primary (order actions)**
- Background: `#C0552F` / Hover: `#A2441F` / Active: `#88381A`
- Text: `#FFFFFF`
- Padding: 8px 16px — Border Radius: 8px — Font: 16px / 600

**Secondary (supporting actions)**
- Background: `#F7ECE4` (Sand) — Text: `#C0552F` — Border: `1px solid #C0552F`
- Hover: background `#C0552F` / text `#FFFFFF`
- Padding: 8px 16px — Border Radius: 8px

**Ghost (low-emphasis actions)**
- Background: transparent — Text: `#6E6258` — Border: `1px solid #E7DED4`
- Hover: background `#FAF6F1` / text `#2B221C`

**Danger (destructive / cancel)**
- Background: `#FBEDE7` — Text: `#9E3318` — Border: `1px solid #E8B79F`
- Hover: background `#9E3318` / text `#FFFFFF`

**Success (payment request / confirmed completion)**
- Background: `#6E7F35` — Text: `#FFFFFF`
- Hover: background `#5C6B2E`
- Use for: the "Request payment" CTA in the Sticky Checkout Bar. This is a
  completion action (not a per-item order action), so the success variant
  applies — not primary/terracotta.

**Sizes**

| Size | Padding | Font Size |
|------|---------|-----------|
| sm | 4px 12px | 14px |
| md | 8px 16px | 16px |
| lg | 12px 24px | 18px |

---

### Header

Sticky bar at the top of the viewport. Identifies the seat and screen context.

- Position: `sticky; top: 0` — `z-index` above scrolling content
- Background: `#C0552F` (Terracotta primary)
- Text: `#FFFFFF`
- Padding: 16px 24px
- Screen Title: 20px / 600 — seat name (e.g. "Table 3")
- Subtitle: 12px / 400 / opacity 0.8 — "Self Order" label

---

### Category Nav Chips

The primary mechanism for menu legibility on mobile. Sticky at the top of the
scroll area so the user can jump between categories without scrolling back up.

- Layout: horizontally scrollable flex row (`overflow-x: auto; -webkit-overflow-scrolling: touch`)
- Scrollbar hidden: `::-webkit-scrollbar { display: none }`
- Position: `sticky; top: <header height>`; background: `#FAF6F1` (matches page background for seamless blending)
- Scroll shadow: `0 2px 6px rgba(43, 34, 28, 0.06)` when content is scrolled beneath

**Chip — inactive**
- Background: `#FFFFFF` — Text: `#2B221C` — Border: `1px solid #E7DED4`
- Border Radius: `9999px` (pill) — Padding: 6px 16px — Font: 13px

**Chip — active**
- Background: `#C0552F` — Text: `#FFFFFF` — Border: none
- Same radius, padding, and font as inactive

---

### Menu Item Row

One row per menu item — combines product info and order action in a compact
mobile-optimized layout.

```
┌──────────────────────────────────────────────┐
│ [photo]  Item name                ¥1,200     │
│          Description (optional)               │
│                      [−][ 1 ][＋]  [Order]  │
└──────────────────────────────────────────────┘
```

- Background: `#FFFFFF`
- Separator: `border-bottom: 1px solid #FAF6F1` (matches page bg — soft visual divider)
- Padding: 12px 0
- Photo thumbnail (only rendered when the item has one — items without a
  photo keep the compact two-column layout, no reserved space): 72×72px
  (`calc(space-8 + space-10)`), `aspect-ratio: 1/1`, `radius-sm` (6px),
  `object-fit: cover`, `background: #FAF6F1` (matches page bg — fills the
  box while the image loads, so there is no shift once it resolves),
  `flex-shrink: 0`, placed before the info column. `loading="lazy"`.
  `alt` carries the item name (the description doesn't describe what the
  dish looks like, so it can't stand in for alt text).
- Item name: 16px / 500 / `#2B221C`
- Description (only when set): 12px / `#9A8E82` (Subtle Foreground),
  `white-space: normal` — sits between name and price
- Price: 14px / 600 / `#C0552F` (terracotta draws the eye to the price)
- Stepper + button: flex row, right-aligned

---

### Quantity Stepper

```
[−][ 1 ][＋]
```

- Touch target for each button: minimum 44 × 44px (WCAG 2.1)
- Container: `border: 1px solid #D8CCBE` / `border-radius: 6px` / `overflow: hidden`
- Decrease / Increase button: background `#FAF6F1` / text `#2B221C` / `min-width: 2rem`
- Count display: 14px / 600 / `#2B221C` / `min-width: 1.5rem` / `text-align: center`
- Disabled state: `opacity: 0.4`

---

### Order Summary / Cart

```
┌──────────────────────────────────────────────┐
│  Your order                                  │
│  ──────────────────────────────────────      │
│  Item name A              × 2      ¥2,400   │
│  Item name B              × 1        ¥900   │
│  ──────────────────────────────────────      │
│  Total                             ¥3,300   │
└──────────────────────────────────────────────┘
```

- Background: `#FFFFFF` — Border Radius: 12px — Padding: 20px
- Section heading: 16px / 600 / `#2B221C`
- Item row: `justify-content: space-between` / `padding: 8px 0` / `border-bottom: 1px solid #FAF6F1`
- Quantity indicator (`× N`): 14px / `#6E6258`
- Line subtotal: 14px / 600 / `#2B221C`
- Total label: 16px / 600 / `#2B221C`
- Total amount: 16px / 600 / `#C0552F` (terracotta emphasis)

---

### Sticky Checkout Bar

Permanently visible at the bottom of the viewport to make the payment step
instantly reachable regardless of scroll position.

- Position: `sticky; bottom: 0`
- Background: `#FFFFFF` — Border Top: `1px solid #E7DED4`
- Padding: `12px 16px` — top shadow: `0 -2px 8px rgba(43, 34, 28, 0.06)`
- Safe area: `padding-bottom: env(safe-area-inset-bottom)` for iPhone notch/Dynamic Island
- Button: success variant / full width / height 52px / 16px font

**States:**
- `open` (order in progress): success button "Request payment"
- `payment_requested` (awaiting staff): text message "Your payment request has been received. A staff member will be with you shortly."

---

### Cards

- Background: `#FFFFFF`
- Border: `1px solid #E7DED4` — Border Radius: 12px — Padding: 16px 20px
- Shadow: `0 2px 8px rgba(43, 34, 28, 0.06)`

---

### Inputs / Field

- Background: `#FFFFFF`
- Border: `1px solid #D8CCBE`
- Border (focus): `1px solid #C0552F`
- Border Radius: 8px — Padding: 10px 14px
- Font Size: **16px minimum** (prevents iOS Safari auto-zoom on focus)
- Height: 48px (touch target)
- Placeholder color: `#9A8E82`

---

### Alerts

**Error**
- Background: `#FBEDE7` — Border: `1px solid #E8B79F` — Text: `#9E3318`
- Border Radius: 6px — Padding: 8px 12px — Font Size: 14px

**Success**
- Background: `#F2F3E6` — Border: `1px solid #C2C98F` — Text: `#5C6B2E`
- Border Radius: 6px — Padding: 8px 12px — Font Size: 14px

---

## 5. Layout Principles

### Spacing scale (aligns with existing tokens)

| Token | Value | Example usage |
|-------|-------|---------------|
| `--space-1` | 4px | Icon-to-label gap |
| `--space-2` | 8px | Inline gap, compact padding |
| `--space-3` | 12px | Inter-item gap within a list |
| `--space-4` | 16px | Base section padding unit |
| `--space-5` | 20px | Card padding |
| `--space-6` | 24px | Section separator |
| `--space-8` | 32px | Large section gap |
| `--space-10` | 40px | Page-level margin |

### Container

- Mobile max width: `420px` (`--container-mobile`)
- Tablet / Desktop: single centered column at the same max width — no multi-column grid
- Horizontal padding: 16px

### Page structure

```
┌─────────────────────────────────────────┐
│  Header (sticky top)                    │
│  Seat name / Self-order                 │
├─────────────────────────────────────────┤
│  Category Nav Chips (sticky)            │
├─────────────────────────────────────────┤
│                                         │
│  Menu Section                           │
│  (category group × N)                  │
│                                         │
│  Order Summary Section                  │
│                                         │
├─────────────────────────────────────────┤
│  Sticky Checkout Bar (sticky bottom)    │
└─────────────────────────────────────────┘
```

---

## 6. Depth & Elevation

Shadow color uses a warm espresso base (`rgba(43, 34, 28, …)`) instead of pure
black to keep elevation consistent with the earth-tone palette.

| Level | Shadow | Usage |
|-------|--------|-------|
| 0 | none | Flat elements, list rows |
| 1 | `0 2px 8px rgba(43, 34, 28, 0.06)` | Cards, checkout bar top separator |
| 2 | `0 4px 16px rgba(43, 34, 28, 0.10)` | Hovered cards, popovers |
| 3 | `0 8px 24px rgba(43, 34, 28, 0.14)` | Modals, bottom sheets |

---

## 7. Do's and Don'ts

### Do

- **Use terracotta (`#C0552F`) for per-item order CTAs.** The "Order" button
  on each menu item row must always use the primary/terracotta color.
  The "Request payment" button is a completion action and uses the success
  variant (`#6E7F35`) — see §4 Sticky Checkout Bar.
- **Keep touch targets at 44 × 44px or larger.** Applies to stepper buttons and
  all interactive elements.
- **Keep input font size at 16px or above.** Prevents iOS Safari from
  auto-zooming on focus.
- **Reserve pill shape (`border-radius: 9999px`) for category nav chips only.**
  All other buttons use `border-radius: 8px`.
- **Disambiguate primary and danger with a background surface and icon.** Because
  they are hue-adjacent, context (color fill + icon/label) is required for clear
  meaning.
- **Use olive/sage for success states.** "Order confirmed" and "Payment requested"
  confirmations always use the `#5C6B2E` / `#F2F3E6` pair.
- **Maintain body text at 16px / line-height: 1.6.** This is the minimum
  comfortable reading baseline for Japanese on mobile.
- **Use only the system font stack.** Do not add web fonts.

### Don't

- **Never use green or red hex values.** `#00a728`, `#006436`, `#e90000`,
  `#ff0000`, and similar values are prohibited. Use olive/sage for success and
  deep rust for danger instead.
- **Do not apply pill shape to general buttons.** Uniform pills flatten the
  hierarchy; `radius-md` (8px) is the default for all button variants.
- **Do not use accent color (honey ochre) for primary CTAs.** It is a
  supplementary emphasis color only. Main CTAs are always terracotta.
- **Do not place primary (terracotta) and danger (deep rust) adjacent without
  separation.** Insert whitespace or a border between them.
- **Do not set input font below 16px.** Causes iOS Safari auto-zoom regression.
- **Do not add `letter-spacing` to body or headings.** Only category labels
  permit `0.05em`.
- **Do not add web fonts.** The system font stack provides sufficient quality
  without the network cost.

---

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Description |
|------|-------|-------------|
| Mobile | ≤ 767px | Primary target. Full-width single column |
| Tablet / Desktop | ≥ 768px | Single centered column (max-width 420px). Layout unchanged from mobile |

This app is designed for table-mounted mobile devices. Responsive logic is
intentionally minimal — no multi-column grids.

### Touch targets

- Minimum size: 44 × 44px (WCAG 2.1 criterion 2.5.5)
- Stepper buttons: `min-height: 44px`
- Input height: 48px

### Font size adjustments

- Body 16px: unchanged on all screen sizes
- Screen Title (20px): may reduce to 18px on very narrow viewports
- Category Label (12px): unchanged

### Safe area insets

Apply `padding-bottom: env(safe-area-inset-bottom)` to the Sticky Checkout Bar
to avoid overlap with the iPhone home indicator.

---

## 9. Agent Prompt Guide

> **Note:** Hex values below are for specification reference only. In actual
> CSS implementation, use CSS custom properties (`var(--color-*)`, etc.) as
> instructed in §2 and §4 — never hardcode hex. This prompt guide is a
> communication aid, not a CSS template.

### Quick reference

```
Primary:          #C0552F  (Terracotta)
Primary Hover:    #A2441F
Primary Subtle:   #F7ECE4  (Sand)
Accent:           #D89A4E  (Honey Ochre)
Background:       #FAF6F1  (Warm Ivory)
Surface:          #FFFFFF
Text Primary:     #2B221C  (Espresso)
Text Muted:       #6E6258  (Warm Taupe)
Border:           #E7DED4
Success FG:       #5C6B2E  (Olive)
Success BG:       #F2F3E6
Danger FG:        #9E3318  (Deep Rust)
Danger BG:        #FBEDE7
Warning FG:       #8A5A12  (Mustard)
Warning BG:       #FBF1DC

Font stack: system-ui, "Hiragino Sans", "Hiragino Kaku Gothic ProN",
            "Noto Sans JP", Meiryo, sans-serif
Body:        16px / line-height 1.6
Button radius: 8px (md) — pill (9999px) for category chips only
Touch target:  44px minimum
```

### Prompt template

```
Implement a UI screen following the yorozu-app apps/order design system.

Colors:
  Primary CTA:   #C0552F (terracotta)
  Accent:        #D89A4E (honey ochre)
  Text:          #2B221C (espresso)
  Page BG:       #FAF6F1 (warm ivory)
  Success:       fg #5C6B2E / bg #F2F3E6 (olive/sage)
  Danger:        fg #9E3318 / bg #FBEDE7 (deep rust)
  — No green or red hex values anywhere —

Font: system-ui, "Hiragino Sans", "Hiragino Kaku Gothic ProN",
      "Noto Sans JP", Meiryo, sans-serif
Body: 16px / line-height: 1.6

Button radius: border-radius: 8px (category chips only: 9999px)
Touch targets: 44px minimum (stepper buttons included)
Input font: 16px minimum (prevents iOS Safari auto-zoom)

Card: background #FFFFFF / border 1px solid #E7DED4 / radius 12px /
      shadow 0 2px 8px rgba(43,34,28,0.06)
Sticky header: background #C0552F / text #FFFFFF
Category chip (active):   background #C0552F / text #FFFFFF / radius 9999px
Category chip (inactive): background #FFFFFF / border 1px solid #E7DED4 / radius 9999px
```

---

## 10. Component Ownership Policy

### Policy

**`apps/order` and `apps/admin` each own their UI components independently.**
The two apps serve different users (customers vs. store staff) and have distinct
design requirements. Sharing components between them risks constraining either
app's design flexibility.

### Role of `@yorozu/ui`

`packages/ui` (`@yorozu/ui`) provides **design tokens and minimal primitives
only** — it is not a shared component library.

**What belongs in `@yorozu/ui`:**
- Design tokens (CSS custom properties in `packages/ui/src/styles/tokens.css`)
- Truly generic primitives that every app can reuse unchanged (e.g. `Button`,
  `Field`, `Select` — kept intentionally generic with no app-specific variants)

**What does not belong in `@yorozu/ui`:**
- Components that embed app-specific layout or domain logic (e.g. `MenuList`,
  `OrderSummary`, `OrderBoard`)
- App-specific visual decisions (e.g. the order app header color, the admin
  dashboard layout)

### Implementation guidelines

- New components start inside the app's own `src/components/`.
- Consider promoting to `@yorozu/ui` only when three or more apps need
  near-identical logic and structure.
- When promoting, keep the API generic and lean on design tokens rather than
  hardcoded values.
- Existing `@yorozu/ui` primitives (`Button`, `Card`, `Field`, `Select`,
  `ConfirmDialog`, `ErrorAlert`) remain as general-purpose building blocks. If
  the apps/order design spec diverges from a primitive's defaults, wrap it
  locally rather than modifying the primitive.
