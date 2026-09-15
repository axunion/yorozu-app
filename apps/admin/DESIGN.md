# DESIGN.md — yorozu-app / apps/admin

> This file is the single source of truth for the visual specification of
> `apps/admin` (the staff-facing administration SPA). Treat it as the canonical
> reference when generating or implementing UI — both for AI agents and human
> developers.
>
> **Scope:** `apps/admin` only. Design specifications for `apps/order` and
> `apps/signup` are out of scope. For component ownership rules see
> [§10 Component Ownership Policy](#10-component-ownership-policy).

---

## 1. Visual Theme & Atmosphere

- **Design direction:** Professional, high-contrast business tool. Optimised for
  store staff who monitor orders across long shifts. Information density is high
  and glance-readability is the primary goal: the operator must recognise a new
  order at a glance without searching the screen.
- **Density:** Desktop-first, data-dense layout. Multiple order cards fill the
  viewport simultaneously; actions resolve in one click.
- **Keywords:** professional, high-contrast, high-visibility, calm, efficient,
  glance-readable.
- **Signature:** A cool slate canvas (`#EEF1F6`) suppresses glare during
  prolonged use. A deep professional blue (`#1D4ED8`) drives the chrome —
  header, primary CTAs, focus rings — conveying trustworthiness. Vermilion
  orange (`#EA580C`) is the exclusive alert colour for incoming and unserved
  orders: it is warm, vivid, and unmistakable against the cool background.
  Amber signals payment-requested seats awaiting checkout. Red is reserved
  strictly for destructive actions (deletion) and must never appear as a status
  colour. Green marks completion states (served, available).

---

## 2. Color Palette & Roles

> **Implementation note:** This palette is admin-specific. Map these hex values
> to the `--color-*` CSS custom properties at app scope inside
> `apps/admin/src/` — do **not** modify the shared `packages/ui/src/styles/tokens.css`.
> Override only the properties that differ from the base tokens, and reference
> them via `var(--color-*)` throughout all admin CSS. The hex values here are
> canonical; the CSS variables are the implementation vehicle.
>
> `apps/order` uses a separate terracotta palette; the two apps must never
> share a primary colour value.

### Primary — Professional Deep Blue

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#1D4ED8` | Header background, primary action buttons |
| Primary Hover | `#1E40AF` | Hovered primary button / header nav link |
| Primary Active | `#1E3A8A` | Pressed/active primary element |
| Primary Foreground | `#FFFFFF` | Text on primary background |
| Primary Subtle | `#EFF4FF` | Muted primary background — secondary buttons, highlights |

### Neutral — Cool Slate

| Role | Hex | Usage |
|------|-----|-------|
| Background (Canvas) | `#EEF1F6` | Page canvas — cool gray-blue suppresses glare |
| Surface | `#FFFFFF` | Cards, modals, section panels |
| Surface Alt | `#F8FAFC` | Table/list header row, zebra stripes |
| Foreground | `#0F172A` | Primary body text — contrast ratio ≈ 17:1 on Surface (AAA) |
| Muted Foreground | `#475569` | Secondary text, labels, timestamps |
| Subtle Foreground | `#94A3B8` | Placeholders, disabled text, empty-state copy |
| Border | `#CBD5E1` | Dividers, card outlines, table cell borders |
| Input Border | `#B8C2D0` | Input field outline in default state |

### Alert — New Order (Signature High-Visibility)

> Reserved **exclusively** for incoming and unserved order states. Never use
> these values for warnings or destructive actions.

| Role | Hex | Usage |
|------|-----|-------|
| Solid | `#EA580C` | Left border stripe on alert cards (4px), pulse dot fill |
| Foreground | `#C2410C` | Alert badge text, icon colour |
| Background | `#FFEDD5` | Alert card background tint |
| Border | `#FB923C` | Alert card border / badge border |

### Warning — Amber (Payment Requested)

| Role | Hex | Usage |
|------|-----|-------|
| Solid | `#D97706` | Checkout card left border stripe |
| Foreground | `#B45309` | Warning badge text |
| Background | `#FFFBEB` | Checkout card background tint |
| Border | `#FCD34D` | Checkout card border / badge border |

### Danger — Red (Destructive Actions Only)

> Used **only** for delete buttons and irreversible action confirmations.
> Always pair with a label and icon — never appear as a status indicator.

| Role | Hex | Usage |
|------|-----|-------|
| Solid | `#DC2626` | Danger button fill |
| Solid Hover | `#B91C1C` | Hovered danger button |
| Foreground | `#DC2626` | Danger text / icon |
| Background | `#FEF2F2` | Danger alert background |
| Border | `#FCA5A5` | Danger alert border |

### Success — Green (Served / Available / Complete)

| Role | Hex | Usage |
|------|-----|-------|
| Solid | `#16A34A` | Success button fill ("提供済み" action) |
| Solid Hover | `#15803D` | Hovered success button |
| Solid Active | `#166534` | Pressed success button |
| Foreground | `#15803D` | Success badge text, "販売中" label |
| Background | `#ECFDF3` | Success badge background |
| Border | `#86EFAC` | Success badge border |

### Colour-role disambiguation

Alert (orange) · Warning (amber) · Danger (red) are neighbouring hues. The
following role mapping keeps them unambiguous:

| Colour | Role | How to tell apart |
|--------|------|-------------------|
| Alert orange | Status: new / unserved order | Appears on cards and status badges only |
| Warning amber | Status: payment requested | Appears on cards and status badges only |
| Danger red | Action: delete / destructive | Appears on buttons and confirm dialogs only |

Always accompany a semantic colour with a label and an icon. Never rely on colour
alone to convey meaning.

---

## 3. Typography Rules

### 3.1 Japanese font stack

- Gothic (sans-serif) only — no mincho/serif typefaces.
- Priority: Hiragino Sans → Hiragino Kaku Gothic ProN → Noto Sans JP → Meiryo.

### 3.2 Latin glyphs

- `system-ui` at the front of the stack picks up the OS native Latin glyphs.
- No web fonts — a business tool must load instantly on any network.

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

### 3.4 Type scale

| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| Screen Title | 24px | 700 | 1.25 | Store name in header |
| Section Heading | 18px | 600 | 1.4 | Section / panel title |
| Card Title (seat name) | 18px | 700 | 1.25 | Order card seat label — must be bold for instant recognition |
| Body | 15px | 400 | 1.6 | Default body copy (slightly tighter than the customer SPA) |
| Table / List Cell | 14px | 400–500 | 1.5 | Menu list items, order item rows |
| Numeric Emphasis (totals) | 18–20px | 700 | tight | Order totals, checkout amounts |
| CTA (button label) | 16px | 600 | tight | "提供済み", "会計完了", etc. |
| Badge | 12px | 600 | 1.4 | Status badges; always uppercase-like in terms of weight |
| Caption | 13px | 400 | 1.5 | Timestamps, supplementary metadata |

### 3.5 Numeric formatting

All prices, quantities, and totals must use tabular figures so columns align
correctly:

```css
font-variant-numeric: tabular-nums;
```

Apply this to any element displaying `¥` amounts or item counts.

### 3.6 Weight tokens

The shared token `--font-bold: 700` is required by admin but not defined in
the shared `tokens.css`. Declare it in the admin app-scope override:

```css
--font-bold: 700;
```

### 3.7 Line height and letter spacing

- Body line height: `1.6` (comfortable for Japanese).
- Heading line height: `1.25–1.4`.
- Letter spacing: `normal` for all roles. No exceptions — admin UI does not
  use decorative letter spacing.

### 3.8 Word breaking

```css
word-break: break-all;
overflow-wrap: break-word;
```

Apply to item name cells and seat name elements to prevent overflow in
narrow columns.

---

## 4. Component Stylings

> **Implementation rule:** Hex values in this section are canonical design
> references for human readability. When writing actual CSS, always use CSS
> custom properties (`var(--color-*)`, `var(--space-*)`, `var(--radius-*)`,
> etc.) — never hardcode hex or px directly. See §2 for the authoritative
> mapping instruction.

### Buttons

Uses `@yorozu/ui` `Button` component. All variants map directly to the existing
`Button` component's `variant` prop; no new variants are needed.

| Variant | Background | Text | Border | Use |
|---------|-----------|------|--------|-----|
| `primary` | `#1D4ED8` | `#FFFFFF` | — | Save, confirm, navigate |
| `secondary` | `#EFF4FF` | `#1D4ED8` | `1px solid #1D4ED8` | Cancel, secondary CTA |
| `ghost` | transparent | `#475569` | `1px solid #CBD5E1` | Low-emphasis actions |
| `danger` | `#FEF2F2` | `#DC2626` | `1px solid #FCA5A5` | Delete — hover fills solid red |
| `success` | `#16A34A` | `#FFFFFF` | — | "提供済み" mark-as-served |

**Sizes**

| Size | Padding | Font Size |
|------|---------|-----------|
| `sm` | 4px 12px | 14px |
| `md` | 8px 16px | 16px |
| `lg` | 12px 24px | 18px |

Base border-radius is `radius-md` (8px). No pill shapes — admin has no category
chip navigation.

---

### Header (`AdminLayout`)

Sticky bar at the top of the viewport. Identifies the store and the current
screen context.

```
┌──────────────────────────────────────────────────────────────┐
│  [Store Name]        [Screen Badge]   [← Back]   [Logout]   │
└──────────────────────────────────────────────────────────────┘
```

- Position: `sticky; top: 0` — `z-index` above scrolling content
- Background: `#1D4ED8` (Primary)
- Text: `#FFFFFF`
- Padding: 16px 24px
- Store Name: 24px / 700 (`<h1>`)
- Screen Badge: 12px / 600 / background `rgba(255,255,255,0.2)` / radius `radius-full`
  — e.g. "注文確認・提供管理"
- Back link: 14px / `rgba(255,255,255,0.8)` — hover: `#FFFFFF`
- Logout button: 14px / ghost style — `border: 1px solid rgba(255,255,255,0.4)` /
  radius `radius-sm` — hover: `border-color #FFFFFF`

---

### Dashboard Navigation (`DashboardPage`)

The dashboard hub presents the main sections (menu, seats, orders,
checkout, sales, reports, staff, settings) as navigation links.

- Container: Surface card / `border-radius: radius-lg` / `padding: space-8` /
  `border: 2px dashed border` — signals "interim" state (scaffold placeholder)
- Links: 16px / 600 / `#1D4ED8` — hover: underline
- Layout: single column, centered
- The "スタッフ管理" (staff management) link renders only when
  `useStoreInfo().role === "owner"` (`<Show>`) — hidden for a `staff`-role
  session. Client-side only; `requireOwner` on the API is the real guard.

---

### Order Card (`OrderBoard`)

The centrepiece of the admin UI. Cards represent active restaurant seats;
their visual state must communicate urgency instantly.

```
┌────────────────────────────────────────────────────────────────┐  ← Alert state
│ ● Table 3    [会計要求中]   ¥4,200   [注文をキャンセル]        │
│ ───────────────────────────────────────────────────────────── │
│  ラーメン         × 2   ¥1,600    [提供済み ✓] [取消]         │
│  餃子             × 1     ¥500    [提供取消]   [取消]         │
│  ビール(取消済み) × 1     ¥600         [取消済み]              │
└────────────────────────────────────────────────────────────────┘
```

**Alert state — new / unserved order** *(primary visual state)*

- Background: `var(--color-alert-bg)` (`#FFEDD5`)
- Left border: `4px solid var(--color-alert-solid)` (`#EA580C`)
- Border radius: `radius-lg` (12px)
- Padding: 20px 24px
- Pulse dot: `8px` circle filled `var(--color-alert-solid)`, positioned before
  the seat name. Animate with `@keyframes alert-pulse`:
  ```css
  @keyframes alert-pulse {
    0%, 100% { transform: scale(1);   opacity: 1; }
    50%       { transform: scale(1.4); opacity: 0.6; }
  }
  .pulseDot { animation: alert-pulse 1.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .pulseDot { animation: none; } }
  ```

**Warning state — payment requested**

- Background: `var(--color-warning-bg)` (`#FFFBEB`)
- Left border: `4px solid var(--color-warning-border)` (`#FCD34D`)
- All other geometry identical to alert state

**New-order alert (on top of Alert/Warning)**

- `box-shadow: 0 0 0 3px var(--color-ring)` ring, applied by JS for ~10s
  when a poll detects an item newer than the watermark; a second alert
  on the same card restarts the window
- Board-level controls (above the card grid): a `🔔/🔕 通知音` toggle
  button (`aria-pressed`), persisted to `localStorage`
  (`order-alert-sound`); `document.title` gains a `(N)` unserved-item
  count

**Card Header**

- Seat name: 18px / 700 / `#0F172A` — immediately identifiable even under glare
- Status badge: see §4 Status Badges
- Age badge: elapsed time since the oldest still-`ordered` item was
  created (e.g. "12分"), clamped to a minimum of 0 so client/server
  clock skew can't display a negative age; an order whose items are
  all `served`/`cancelled` shows none. 14px / 500 /
  `var(--color-muted-foreground)`
  below 10 minutes; ≥ 10 minutes escalates to `var(--color-warning-fg)`
  / 600 weight; ≥ 20 minutes to `var(--color-danger-fg)` / 700 weight.
  Recomputed on every card re-render, so it advances with the existing
  5s poll — no dedicated timer.
  **Deliberate exception to the color-role rule in §2:** the warning/
  danger tokens here signal wait-time severity, a second escalation
  axis independent of the card's own status color (open vs.
  payment_requested). A `payment_requested` card can therefore show a
  warning-amber background *and* a warning-amber age badge at once —
  accepted because the badge's small size, distinct position (header,
  next to the total), and text content ("N分") keep it legible as a
  separate signal rather than a restyled status badge. Revisit if pilot
  feedback shows this reads as confusing in practice.
- Order total: `margin-left: auto` / 18px / 700 / `#0F172A` / `tabular-nums`
- "注文をキャンセル" — `ConfirmDialog` (`danger` variant / `sm` size), placed
  last in the header. Cascades to cancel every non-cancelled item.

**Order Item Row** (inside card)

- Background: `#FFFFFF` (slightly lighter than `#FFEDD5` card for contrast)
- Padding: 8px 12px — Border Radius: `radius-sm` (6px)
- Item name: 14px / 500 / `#0F172A` — `flex: 1`
- Quantity (`× N`): 14px / `#475569` / `tabular-nums`
- Line price: 14px / 600 / `#0F172A` / `tabular-nums` / `text-align: right`
- `ordered` state: "提供済み" button (`success` variant / `sm` size) +
  "取消" `ConfirmDialog` (`danger` variant / `sm` size)
- **Served state:** `opacity: 0.5` on the entire item row; "提供済み"
  replaced by "提供取消" (`secondary` variant / `sm` size) + "取消"
  `ConfirmDialog`
- **Cancelled state:** `opacity: 0.5` plus `text-decoration: line-through`
  on name/qty/price; action buttons replaced by a single 取消済み
  Status Badge (`danger` tone)

**Order list layout**

A responsive grid is preferred to show multiple seats simultaneously:

```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
gap: var(--space-5);
```

---

### Checkout Card (`CheckoutPanel`)

Mirrors the Order Card structure but uses Warning colours to signal "payment
pending" exclusively.

- Background: `#FFFBEB`
- Left border: `4px solid #D97706`
- Card header badge: Warning "会計要求中"
- Total amount: 20px / 700 / `#0F172A` / `tabular-nums`
- Footer: `border-top: 1px solid #FCD34D` / flex-end / `gap: space-3` /
  "席に戻す" (`secondary` variant, plain `Button` — reversible, no
  `ConfirmDialog`) then "会計完了" (`primary` variant)
- Item rows: same geometry as Order Card rows; no served/unserved distinction

---

### Sales History (`SalesHistory`)

Retrospective view, not a live monitor — no polling; the date navigation
itself is the refresh action.

- Date nav: prev/next-day `Button` (`secondary` variant, `sm` size) either
  side of a native `<input type="date">`, defaulting to today (JST)
- Header stats: three `Surface` cards in a `repeat(auto-fit, minmax(160px, 1fr))`
  grid — 売上合計 (total revenue), 会計件数 (check count), 平均単価
  (average per check)
- Check list: each row is a full-width toggle button (seat name, paid
  time, total); clicking expands an item list below it (same
  strikethrough treatment for cancelled lines as Order Card / customer
  `OrderSummary`)
- Empty state: same pattern as Order Card's empty state (dashed-border
  placeholder is Dashboard-only; this one mirrors OrderBoard's plain
  Surface-card empty message)

---

### Sales Reports (`ReportsManager`)

Analytical view over a wider range than `SalesHistory` — presets and
tables, not a day-by-day flip.

- Range nav: 今週 / 今月 / カスタム `Button` toggle group (`aria-pressed`
  marks the active mode), custom mode reveals a `from`/`to`
  `<input type="date">` pair
- Item ranking / weekday breakdown: plain `<table>`s; column headers
  that sort are `<button>`s with `aria-sort` on their `<th>`
  (商品ランキング's 数量/売上金額 columns)
- Weekday / hourly breakdown bars: a `<div>` bar sized by `%` of the
  bucket max, same "no charting dependency" bias as `SalesHistory`'s
  header stats — value label rendered alongside, never colour alone
- Each table with a CSV export has a `secondary`/`sm` "CSVダウンロード"
  `Button` in its section header
- Empty state: same plain Surface-card message pattern as
  `SalesHistory`

---

### Status Badges

Pill-shaped inline labels. Always paired with clear text — never colour alone.

| Badge | Text | Background | Foreground | Border |
|-------|------|-----------|-----------|--------|
| New order | 新規注文 | `#FFEDD5` | `#C2410C` | `#FB923C` |
| Payment requested | 会計要求中 | `#FFFBEB` | `#B45309` | `#FCD34D` |
| Served | 提供済み | `#ECFDF3` | `#15803D` | `#86EFAC` |
| Available | 販売中 | `#ECFDF3` | `#15803D` | `#86EFAC` |
| Unavailable | 品切れ | `#FEF2F2` | `#DC2626` | `#FCA5A5` |
| Cancelled | 取消済み | `#FEF2F2` | `#DC2626` | `#FCA5A5` |

All badges: 12px / 600 / `border-radius: radius-full` / padding `4px 8px`.

---

### Menu Manager — Table / List (`MenuManager`)

The menu list is a flat, border-driven layout optimised for scanning.

**Item row**

- Background: `#F8FAFC` (Surface Alt)
- Border radius: `radius-md` (8px)
- Padding: 8px 12px
- Thumbnail (only when a photo exists): 64×64px, `radius-sm`,
  `object-fit: cover`, flex-shrink 0, placed before the info column
- Item name: 14px / 500 / `#0F172A`
- Price: 14px / `#0F172A` / `tabular-nums`
- Category, sort order: 12px / `#94A3B8`
- Description (only when set): 12px / `#94A3B8`, `white-space: pre-wrap`,
  under the header row
- Status badge: see §4 Status Badges
- Unavailable row: `opacity: 0.6`
- Per-row actions (停止/再開, image upload/change, image delete,
  delete): right-aligned action column, `flex-wrap: wrap`

**Inline edit** ("編集" `ghost` Button toggles the header row into a
form): name, price, category `Select`, availability checkbox, sort
order, and a description `textarea`, plus 保存/キャンセル — mirrors
`SeatManager`'s rename-in-place pattern.

**Image upload**: a styled `<label>` wrapping a visually-hidden file
input (`image/jpeg,image/png,image/webp`), reading "画像を追加" /
"画像を変更" / "アップロード中...". Files are downscaled client-side
(canvas, max 1200px long edge, JPEG ~0.8 quality —
`apps/admin/src/lib/downscaleImage.ts`) before upload. "画像を削除" is a
`ConfirmDialog` (`secondary` trigger), shown only when the item has a
photo.

**Add-item form**

- Layout: `flex-wrap: wrap` / `gap: space-3` / `align-items: flex-end`
- Separated from list by `border-bottom: 1px solid border` + `margin-bottom: space-5`
- Field label: 12px / 500 / `#475569`
- Input: see §4 Inputs
- Description: `textarea`, same field styling as inputs, `resize: vertical`

---

### Seat Manager (`SeatManager`)

Per-row actions on active seats: name + inline "編集" (`ghost` Button)
toggling to a rename form (text input + 保存/キャンセル); "URLをコピー"
(`secondary`); "QR再発行" (`ConfirmDialog`, regenerates the displayed QR
image on confirm — old printed codes stop working immediately); "無効化"
(`ConfirmDialog`, `danger` — the row disappears from the active list on
success). A "無効化した座席を表示" checkbox toggle reveals a read-only
retired-seats list (name + a `danger`-tone "無効" Status Badge, no
actions — no un-retire in v1).

---

### Store Settings (`StoreSettings`)

Four independent sections, each a Surface card (`section` / `radius-lg` /
`padding: space-6` / `shadow-sm`), modeled on the existing `LoginForm`
pattern (Field + Button, `<Show>` toggles to a post-submit notice).

- **Name form**: `Field` pre-filled with the current name; inline "保存"
  `Button`; a `savedNote` confirmation (`--color-success-fg`) appears
  next to the button after a successful save, not a page navigation.
- **Email form** ("自分のメールアドレス" — the calling member's own login
  email, not the store's): current email shown as static text above the
  form (`--color-muted-foreground`), stays visible after submit since the
  address hasn't actually changed until the passcode is confirmed. On
  submit the form is replaced (`<Show fallback>`) by `CodeEntryForm`, plus
  the same `[DEV]` code box as `LoginForm` (`--color-warning-bg` /
  `-border` / `-fg`) when the API echoed one. Confirming the code swaps
  that for a success line in place — no redirect, because the caller
  already holds a session.
- **Session section** ("セッション"): one line of explanatory text plus a
  single `secondary` Button ("ログアウト（全端末）") calling
  `POST /api/auth/logout-all`. On click, does a hard
  `window.location.href` redirect to `/login` (not solid-router
  `navigate()` — every session cookie was just invalidated server-side,
  so the app must re-bootstrap rather than continue with stale in-memory
  state; this also sidesteps this component's standalone unit-test
  render, which has no Router context).
- **Danger zone** ("危険な操作", owner-role only — `<Show when={store.role
  === "owner"}>`): a Surface card with a `--color-danger-border` border
  and a `--color-danger-fg` heading, containing two `dangerAction` rows
  (each separated by a `border-top`, first one has none) instead of
  separate cards.
  - **Suspend**: explanatory text + a `secondary`-variant `ConfirmDialog`
    ("一時停止する" trigger, distinct "一時停止を確定する" confirm label to
    avoid an accessible-name collision between the two buttons) calling
    `POST /api/stores/me/suspend`, then the same hard
    `window.location.href` redirect to `/login` as the logout-all button
    above (every session for the store — not just this one — was just
    deleted server-side). Deliberately `secondary`, not `danger`, despite
    living in the danger zone: suspension is reversible (via reactivate
    login), unlike delete.
  - **Delete**: a `Field` asking the owner to type the store's exact name,
    gating a `danger`-variant `ConfirmDialog` ("アカウントを削除する" /
    "完全に削除する") via `triggerDisabled` until the typed value matches
    — mirrors `StaffManager`'s self/last-owner disable pattern (UX
    convenience only; the server's `confirm_name` check is the real
    guard). On confirm, downloads the response's `export` field as a JSON
    file (`Blob` + `URL.createObjectURL`, anchor attached to the document
    before `.click()`) and delays the post-delete redirect briefly so the
    download can't be cancelled by a same-tick navigation, before
    redirecting to `/login`.

---

### Staff Manager (`StaffManager`)

Owner-only page (`/staff`, hidden from the dashboard nav for `staff`-role
sessions). Two Surface cards, same shape as `SeatManager`/`StoreSettings`.

- **Invite form**: `Field` (email, type="email") + `@yorozu/ui` `Select`
  (role: スタッフ / オーナー, defaults to スタッフ) + inline "招待する"
  `Button`, laid out `flex-wrap` / `align-items: flex-end` like
  `SeatManager`'s add-seat form.
- **Member list**: each row shows email (`font-weight: semibold`), a
  plain-text role label (スタッフ/オーナー — not a Status Badge; role
  isn't a state transition), a Status Badge (`success` "有効" /
  `warning` "招待中" for active/pending), and a `danger` `ConfirmDialog`
  ("削除") per row. The remove trigger is `disabled` (not hidden) for the
  caller's own row and for a `role: 'owner'` row when it's the only owner
  left — the API's 400s are the real guard; this is UX only, matching
  `SeatManager`'s no-op-prevention pattern for actions that would
  obviously fail.
- Errors (fetch failure, 403 for a staff-role session that navigates here
  directly, invite conflicts) surface via `ErrorAlert`, same placement
  convention as `SeatManager`.

### Inputs / Field (`@yorozu/ui` Field)

- Background: `#FFFFFF`
- Border: `1px solid #B8C2D0`
- Border (focus): replaced by `outline: 2px solid #1D4ED8; outline-offset: 1px;
  border-color: transparent`
- Border Radius: `radius-sm` (6px)
- Padding: 4px 8px (compact for admin forms)
- Font Size: 14px (desktop context; auto-zoom prevention is less critical than
  on the mobile customer SPA, but 14px minimum is still required)
- Height: auto (no explicit min-height in admin; forms are not touch-primary)
- Placeholder color: `#94A3B8`

---

### Alerts (`@yorozu/ui` ErrorAlert)

**Error**

- Background: `#FEF2F2` — Border: `1px solid #FCA5A5` — Text: `#DC2626`
- Border Radius: 6px — Padding: 8px 12px — Font Size: 14px

**Success** (not currently used as a standalone alert; prefer in-place badge)

- Background: `#ECFDF3` — Border: `1px solid #86EFAC` — Text: `#15803D`
- Border Radius: 6px — Padding: 8px 12px — Font Size: 14px

---

### Empty States

- Background: Surface (`#FFFFFF`)
- Border Radius: `radius-lg` — Padding: `space-10 space-8`
- Text: 14px / `#94A3B8` / centered
- Message: one line; keep concise ("アクティブな注文はありません", etc.)

---

## 5. Layout Principles

### Spacing scale (shared tokens — do not modify)

| Token | Value | Example usage |
|-------|-------|---------------|
| `--space-1` | 4px | Badge padding, icon-to-label gap |
| `--space-2` | 8px | Row gap, tight padding |
| `--space-3` | 12px | Item row padding, form gap |
| `--space-4` | 16px | Card inner padding unit |
| `--space-5` | 20px | Card padding, grid gap |
| `--space-6` | 24px | Section horizontal padding |
| `--space-8` | 32px | Large section gap, header padding |
| `--space-10` | 40px | Empty-state padding |

### Container

- Max width: `960px` (`margin: 0 auto`) — matches the current `AdminLayout.main`.
- Horizontal padding: `24px` (`space-6`).
- No mobile-first single column — desktop layout is the primary target.

### Page structure

```
┌────────────────────────────────────────────────────────────────┐
│  Header (sticky top)                                           │
│  Store name / Screen badge / [Back] / [Logout]                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Main content (max-width: 960px, margin: auto)                 │
│                                                                │
│  ┌─ Single-panel pages ──────────────────────────────────┐    │
│  │  Dashboard nav / Menu form + list / Seat grid         │    │
│  └───────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌─ Multi-card pages ────────────────────────────────────┐    │
│  │  Order Board / Checkout Panel                         │    │
│  │  auto-fill grid (minmax 320px)                        │    │
│  └───────────────────────────────────────────────────────┘    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Order Board / Checkout Panel responsive grid

```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
gap: var(--space-5);
```

On narrower viewports (tablet) this gracefully collapses to a single column.

---

## 6. Depth & Elevation

Shadow colour uses the darkest slate (`rgba(15, 23, 42, …)`) for a cool,
crisp shadow tone consistent with the cool canvas — not a warm espresso shadow.
Elevation is kept minimal; borders carry most of the structural hierarchy.

| Level | Shadow | Usage |
|-------|--------|-------|
| 0 | none | Flat rows, list items, table cells |
| 1 | `0 1px 3px rgba(15,23,42,0.07), 0 1px 2px rgba(15,23,42,0.04)` | Cards, section panels |
| 2 | `0 4px 16px rgba(15,23,42,0.10)` | Focused/hovered cards, dropdowns |
| 3 | `0 10px 24px rgba(15,23,42,0.14)` | Modal dialogs, confirm overlays |

---

## 7. Do's and Don'ts

### Do

- **Maintain colour contrast at WCAG AA minimum; target AAA for body text.**
  `#0F172A` on `#FFFFFF` exceeds AAA (~17:1). Never drop below 4.5:1 for text.
- **Use Alert orange exclusively for new / unserved order states.** No other
  UI element may use the `#EA580C` / `#FFEDD5` / `#FB923C` triad.
- **Pair every semantic colour with a label and icon.** Colour alone is
  insufficient to convey status — always accompany with text.
- **Apply `tabular-nums` to all prices, quantities, and totals.** Misaligned
  numbers in adjacent rows degrade scan speed.
- **Use `font-weight: 700` for seat names in order cards.** The seat identifier
  is the operator's first visual anchor; it must stand out instantly.
- **Use the responsive grid (`auto-fill minmax(320px, 1fr)`) for Order Board
  and Checkout Panel.** This maximises visible seats on large monitors.
- **Suppress pulse animation under `prefers-reduced-motion: reduce`.**
  The alert pulse dot must respect the OS motion preference.
- **Keep the cool slate canvas (`#EEF1F6`) — do not substitute pure white.**
  The slightly tinted background reduces glare during long shifts.
- **Use `radius-sm` (6px) for form inputs and item rows, `radius-lg` (12px)
  for section panels and cards.** Consistent radius keeps density readable.

### Don't

- **Never use Alert orange for destructive actions.** Delete buttons are always
  red (`#DC2626` / `danger` variant). Orange is a status colour, not an action
  colour.
- **Never use the customer SPA's terracotta (`#C0552F`) in admin.** The two
  apps must remain visually distinct. If a shared token resolves to terracotta,
  override it at admin app scope.
- **Do not reduce body text below 14px.** The minimum for comfortable reading in
  a business context where accuracy matters.
- **Do not place Warning amber and Alert orange adjacent without separation.**
  Their hues are close; always insert whitespace or a structural border between
  them.
- **Do not place Danger red and Alert orange adjacent without separation.**
  Same reason — always separate with whitespace or border.
- **Do not add web fonts.** The system stack loads instantly and covers all
  supported locales.
- **Do not use pill shapes (`border-radius: 9999px`) for action buttons.** Pills
  are reserved for status badges only. All buttons use `radius-md` (8px) or
  `radius-sm` (6px) for `sm` size.
- **Do not hardcode hex or px values in CSS files.** Always use
  `var(--color-*)`, `var(--space-*)`, `var(--radius-*)`, etc. Raw values
  belong only in this document and in the app-scoped token override.

---

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Description |
|------|-------|-------------|
| Desktop | ≥ 1024px | Primary target. Multi-column order grid fills viewport |
| Tablet | 768px – 1023px | Single or two-column grid; main content max-width preserved |
| Mobile | ≤ 767px | Not a primary target; single column fallback |

Admin is operated on store desktop / POS terminals and tablets. Mobile layout
is a graceful fallback, not a design priority.

### Click / Touch targets

- Minimum interactive size: 40 × 40px (buttons and icon targets)
- Prefer 44 × 44px for touch-primary controls where space allows
- "提供済み" (mark-as-served) buttons: `sm` size — ensure at least 40px height
  to remain tappable on tablet

### Font size adjustments

- Body 15px: unchanged across all screen sizes.
- Card Title 18px: unchanged.
- Numeric Emphasis 18–20px: unchanged.

### Order Board grid behaviour

```css
grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
```

- Desktop (≥ 1024px): typically 2–3 columns
- Tablet (768–1023px): typically 1–2 columns
- Mobile (≤ 767px): single column

---

## 9. Agent Prompt Guide

> **Note:** Hex values below are for specification reference only. In actual
> CSS implementation, use CSS custom properties (`var(--color-*)`, etc.) as
> instructed in §2 and §4 — never hardcode hex. This prompt guide is a
> communication aid, not a CSS template.

### Quick reference

```
Primary:              #1D4ED8  (Professional Deep Blue)
Primary Hover:        #1E40AF
Primary Subtle:       #EFF4FF

Canvas (Background):  #EEF1F6  (Cool Slate — not pure white)
Surface:              #FFFFFF
Surface Alt:          #F8FAFC
Text Primary:         #0F172A  (Slate-900, ~17:1 AAA)
Text Muted:           #475569
Text Subtle:          #94A3B8
Border:               #CBD5E1
Input Border:         #B8C2D0

Alert (new orders):   solid #EA580C / bg #FFEDD5 / border #FB923C / fg #C2410C
Warning (pay req):    solid #D97706 / bg #FFFBEB / border #FCD34D / fg #B45309
Danger (delete only): solid #DC2626 / hover #B91C1C / bg #FEF2F2 / border #FCA5A5
Success (served):     solid #16A34A / hover #15803D / bg #ECFDF3 / border #86EFAC / fg #15803D

Font stack: system-ui, "Hiragino Sans", "Hiragino Kaku Gothic ProN",
            "Noto Sans JP", Meiryo, sans-serif
Body: 15px / line-height 1.6
Seat name in order card: 18px / font-weight 700 (--font-bold)
Numerics: font-variant-numeric: tabular-nums
Button radius: 8px (md) — badges/pills only: 9999px (radius-full)
```

### Prompt template

```
Implement an admin UI screen following the yorozu-app apps/admin design system.
The admin app uses a professional, high-contrast desktop palette.

Colors (use var(--color-*) in CSS — hex shown for reference only):
  Canvas:      #EEF1F6  (page background — cool gray, not pure white)
  Surface:     #FFFFFF  (cards / panels)
  Text:        #0F172A  (primary body text)
  Primary:     #1D4ED8  (header, primary buttons)

  Alert (new/unserved orders — orange, status only):
    bg #FFEDD5 / border-left 4px solid #EA580C / badge fg #C2410C
  Warning (payment requested — amber, status only):
    bg #FFFBEB / border-left 4px solid #D97706 / badge fg #B45309
  Danger (delete actions — red, never status):
    button bg #FEF2F2 / fg #DC2626 / hover fills solid #B91C1C
  Success (served / available — green):
    button solid #16A34A / badge bg #ECFDF3 / fg #15803D

Font: system-ui, "Hiragino Sans", "Hiragino Kaku Gothic ProN",
      "Noto Sans JP", Meiryo, sans-serif
Body: 15px / line-height 1.6
Seat names: 18px / font-weight 700
Prices/quantities: font-variant-numeric: tabular-nums

Order card (new/unserved):
  background #FFEDD5 / border-left 4px solid #EA580C / radius 12px / padding 20px 24px
  Pulse dot: 8px circle filled #EA580C before seat name (suppress if prefers-reduced-motion)
Order card (payment requested):
  background #FFFBEB / border-left 4px solid #D97706
Order grid: display grid / grid-template-columns repeat(auto-fill, minmax(320px, 1fr))

Button radius: 8px (md) — no pill shapes on buttons
Status badge radius: 9999px (radius-full)
Header: background #1D4ED8 / text #FFFFFF / sticky top / full viewport width
  (inner content wrapper max-width: 960px, margin: auto)
```

---

## 10. Component Ownership Policy

### Policy

**`apps/admin` owns its UI components independently from `apps/order`.**
The two apps serve different users (store staff vs. customers) and have
fundamentally different design requirements and colour systems. Sharing
components between them risks constraining either app's design flexibility
and would force the shared component to accommodate two incompatible palettes.

### Role of `@yorozu/ui`

`packages/ui` (`@yorozu/ui`) provides **design tokens and minimal primitives
only** — it is not a shared component library.

**What belongs in `@yorozu/ui`:**
- Design tokens (CSS custom properties in `packages/ui/src/styles/tokens.css`)
- Truly generic primitives that every app can reuse unchanged: `Button`,
  `Card`, `Field`, `Select`, `ConfirmDialog`, `ErrorAlert`
- `CodeEntryForm` — the passcode step. Admin, shift and signup each need the
  same input, resend affordance and cooldown, which clears the "3+ apps need
  identical logic" bar; it holds no `fetch` of its own (submitting and
  resending are the caller's callbacks), so it stays a primitive rather than a
  piece of the auth flow

**What does not belong in `@yorozu/ui`:**
- Components that embed app-specific layout or domain logic (e.g. `OrderBoard`,
  `CheckoutPanel`, `MenuManager`, `SeatManager`)
- App-specific visual decisions (e.g. the admin palette, the order board grid)

### Admin palette override

`apps/admin` declares a `:root` block in its own global CSS entry point
(e.g. the file imported by `apps/admin/src/main.tsx`) that re-declares
every token that differs from the shared base. Because `:root` matches the
document root, this block must live exclusively in the admin app's CSS
bundle — it must never be imported into `apps/order` or `apps/signup`.
Placing it at `apps/admin/src/styles/admin-tokens.css` (imported only from
`apps/admin/src/main.tsx`) is the recommended approach.

The full list of tokens to override:

```css
/* apps/admin/src/styles/admin-tokens.css
   Import ONLY from apps/admin/src/main.tsx — never from shared packages. */
:root {
  /* ── Primary — Professional Deep Blue ─────────────────────────────── */
  --color-primary:            #1D4ED8;
  --color-primary-hover:      #1E40AF;
  --color-primary-active:     #1E3A8A;
  --color-primary-foreground: #FFFFFF;
  --color-primary-subtle:     #EFF4FF;

  /* ── Neutrals — Cool Slate ─────────────────────────────────────────── */
  --color-background:         #EEF1F6;
  --color-surface-alt:        #F8FAFC;
  --color-foreground:         #0F172A;
  --color-muted-foreground:   #475569;
  --color-subtle-foreground:  #94A3B8;
  --color-border:             #CBD5E1;
  --color-input:              #B8C2D0;
  --color-ring:               #1D4ED8;

  /* ── Alert — New Order (signature high-visibility) ─────────────────── */
  --color-alert-solid:        #EA580C;
  --color-alert-fg:           #C2410C;
  --color-alert-bg:           #FFEDD5;
  --color-alert-border:       #FB923C;

  /* ── Warning — Amber (payment requested) ──────────────────────────── */
  --color-warning-bg:         #FFFBEB;
  --color-warning-border:     #FCD34D;
  --color-warning-fg:         #B45309;

  /* ── Danger — Red (destructive actions only) ───────────────────────── */
  --color-danger-bg:          #FEF2F2;
  --color-danger-border:      #FCA5A5;
  --color-danger-fg:          #DC2626;

  /* ── Success — Green (served / available / complete) ──────────────── */
  --color-success:            #16A34A;
  --color-success-hover:      #15803D;
  --color-success-active:     #166534;
  --color-success-bg:         #ECFDF3;
  --color-success-border:     #86EFAC;
  --color-success-fg:         #15803D;

  /* ── Typography ─────────────────────────────────────────────────────── */
  --font-bold:                700;
}
```

These overrides are declared in `apps/admin` only and never touch
`packages/ui/src/styles/tokens.css`.

### Implementation guidelines

- New components start inside `apps/admin/src/components/`.
- Consider promoting to `@yorozu/ui` only when three or more apps need
  near-identical logic and structure with a generic, token-driven API.
- When promoting, keep the API generic and lean on design tokens rather than
  hardcoded values so both apps can theme it independently.
- Existing `@yorozu/ui` primitives (`Button`, `Card`, `Field`, `Select`,
  `ConfirmDialog`, `ErrorAlert`) are general-purpose building blocks. If the
  admin design spec diverges from a primitive's defaults, wrap it locally
  rather than modifying the shared primitive.
