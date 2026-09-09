import { z } from "zod";
import { displayName, sortOrderValue } from "./primitives";

// Shift management lives in its own file; re-exported so `@yorozu/core/types`
// stays one import for callers.
export * from "./shift";

// ---------------------------------------------------------------------------
// Shared primitive schemas
// ---------------------------------------------------------------------------

/** Price in JPY (tax-inclusive), > 0. Upper bound is a sanity cap. */
const priceValue = z.number().int().positive().max(1_000_000);

/** JPY delta applied to an item's unit price when an option is selected; may be negative. */
const priceDeltaValue = z.number().int().min(-1_000_000).max(1_000_000);

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export const CreateStoreInput = z.object({
  /** Store display name. Trimmed; must be 1–100 characters after trimming. */
  name: displayName,
  /** Owner email — Magic Link is sent here. */
  email: z.email(),
});
export type CreateStoreInput = z.infer<typeof CreateStoreInput>;

export interface StoreCreatedResponse {
  id: string;
  name: string;
  slug: string;
  /** Magic Link URL. Only present when ENVIRONMENT !== "production". */
  verify_url?: string;
  /** Passcode. Only present when ENVIRONMENT !== "production". */
  code?: string;
}

export const UpdateStoreNameInput = z.object({
  name: displayName,
});
export type UpdateStoreNameInput = z.infer<typeof UpdateStoreNameInput>;

export interface StoreResponse {
  id: string;
  name: string;
  slug: string;
}

export const EmailChangeInput = z.object({
  new_email: z.email(),
});
export type EmailChangeInput = z.infer<typeof EmailChangeInput>;

export const DeleteStoreInput = z.object({
  /** Must exactly match the store's current name — a server-side safeguard
   * against an accidental or scripted delete, independent of client UI.
   * Trimmed so incidental leading/trailing whitespace (e.g. from a
   * copy-paste) doesn't cause a false rejection; the actual authorization
   * boundary is requireStore + requireOwner, not this string comparison. */
  confirm_name: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1)),
});
export type DeleteStoreInput = z.infer<typeof DeleteStoreInput>;

export interface EmailChangeResponse {
  sent: true;
  /** Magic Link URL. Only present when ENVIRONMENT !== "production". */
  verify_url?: string;
  /** Passcode. Only present when ENVIRONMENT !== "production". */
  code?: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const LoginInput = z.object({
  email: z.email(),
});
export type LoginInput = z.infer<typeof LoginInput>;

export interface LoginResponse {
  sent: true;
  /** Magic Link URL. Only present when ENVIRONMENT !== "production" and a token was issued. */
  verify_url?: string;
  /** Passcode. Only present when ENVIRONMENT !== "production" and a code was issued. */
  code?: string;
}

/**
 * A passcode as the user typed it. Japanese IMEs happily produce full-width
 * digits, and people paste codes with the spacing they were displayed with,
 * so normalize before validating rather than rejecting input that is correct
 * to the person who entered it.
 */
const otpCodeValue = z
  .string()
  .transform((s) => s.normalize("NFKC").replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/));

export const VerifyCodeInput = z.object({
  email: z.email(),
  code: otpCodeValue,
  /**
   * Which SPA to land in after verifying. An enum, not a URL: the API maps it
   * to an origin from its own env, so a caller can never redirect somewhere of
   * its choosing.
   */
  app: z.enum(["admin", "shift"]).default("admin"),
});
export type VerifyCodeInput = z.infer<typeof VerifyCodeInput>;

export interface VerifyCodeResponse {
  /**
   * Absolute origin to send the browser to. Resolved server-side from `app`
   * because the signup SPA has to cross to the admin origin and does not carry
   * that URL in its own env.
   */
  redirect_to: string;
}

export const EmailChangeVerifyInput = z.object({
  code: otpCodeValue,
});
export type EmailChangeVerifyInput = z.infer<typeof EmailChangeVerifyInput>;

export interface EmailChangeVerifyResponse {
  /** The address now on the member, so the caller can update what it shows. */
  email: string;
}

// ---------------------------------------------------------------------------
// Staff (members)
// ---------------------------------------------------------------------------

export const StaffInviteInput = z.object({
  email: z.email(),
  role: z.enum(["owner", "staff"]).default("staff"),
});
export type StaffInviteInput = z.infer<typeof StaffInviteInput>;

export interface StaffMemberResponse {
  id: string;
  email: string;
  role: "owner" | "staff";
  status: "pending" | "active";
  created_at: number;
  activated_at: number | null;
  /** Magic Link URL. Only present when ENVIRONMENT !== "production" (POST only). */
  verify_url?: string;
  /** Passcode. Only present when ENVIRONMENT !== "production" (POST only). */
  code?: string;
  /**
   * Where the invitee enters their code. Carries no credential, so unlike the
   * passcode it would be safe to send in any environment; it is dev-gated only
   * because it is useless without the code beside it.
   */
  invite_url?: string;
}

// ---------------------------------------------------------------------------
// Menu — categories
// ---------------------------------------------------------------------------

export const CreateCategoryInput = z.object({
  name: displayName,
  sort_order: sortOrderValue.default(0),
});
export type CreateCategoryInput = z.infer<typeof CreateCategoryInput>;

export const UpdateCategoryInput = z.object({
  name: displayName,
  sort_order: sortOrderValue.default(0),
});
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInput>;

export interface CategoryResponse {
  id: string;
  store_id: string;
  name: string;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Menu — items
// ---------------------------------------------------------------------------

/** Trimmed description, ≤ 500 chars; empty after trimming normalizes to null. */
const itemDescription = z
  .string()
  .nullable()
  .transform((s) => {
    if (s === null) return null;
    const trimmed = s.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .pipe(z.string().max(500).nullable());

export const CreateItemInput = z.object({
  name: displayName,
  /** Price in JPY (tax-inclusive). Must be > 0. */
  price: priceValue,
  is_available: z.boolean().default(true),
  category_id: z.string().nullable().default(null),
  sort_order: sortOrderValue.default(0),
  description: itemDescription.optional().default(null),
});
export type CreateItemInput = z.infer<typeof CreateItemInput>;

export const UpdateItemInput = z.object({
  name: displayName,
  price: priceValue,
  is_available: z.boolean(),
  // optional: omitting preserves the current DB value; null clears it.
  category_id: z.string().nullable().optional(),
  sort_order: sortOrderValue.optional(),
  description: itemDescription.optional(),
  // optional: omitting preserves current attachments; [] detaches all groups.
  option_group_ids: z.array(z.string()).optional(),
});
export type UpdateItemInput = z.infer<typeof UpdateItemInput>;

export interface MenuItemResponse {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  price: number;
  is_available: boolean;
  sort_order: number;
  description: string | null;
  image_key: string | null;
  /** Option groups currently attached to this item, for pre-filling the edit form. */
  option_group_ids: string[];
}

// ---------------------------------------------------------------------------
// Menu — option groups & options
// ---------------------------------------------------------------------------

const optionGroupSelectFields = {
  /** Minimum selections required from this group at order time. */
  min_select: z.number().int().min(0).default(0),
  /** Maximum selections allowed from this group at order time. */
  max_select: z.number().int().positive().default(1),
};

const optionGroupSelectRefinement = {
  message: "min_select must be <= max_select",
  path: ["min_select"],
};

export const CreateOptionGroupInput = z
  .object({
    name: displayName,
    sort_order: sortOrderValue.default(0),
    ...optionGroupSelectFields,
  })
  .refine(
    (data) => data.min_select <= data.max_select,
    optionGroupSelectRefinement,
  );
export type CreateOptionGroupInput = z.infer<typeof CreateOptionGroupInput>;

// Full-replace, not partial: mirrors UpdateCategoryInput's convention where
// every field is required on PATCH, unlike UpdateItemInput's omit-preserves
// fields. min_select/max_select must always be resent together.
export const UpdateOptionGroupInput = z
  .object({
    name: displayName,
    sort_order: sortOrderValue.default(0),
    ...optionGroupSelectFields,
  })
  .refine(
    (data) => data.min_select <= data.max_select,
    optionGroupSelectRefinement,
  );
export type UpdateOptionGroupInput = z.infer<typeof UpdateOptionGroupInput>;

export interface OptionGroupResponse {
  id: string;
  store_id: string;
  name: string;
  min_select: number;
  max_select: number;
  sort_order: number;
}

export const CreateOptionInput = z.object({
  name: displayName,
  /** JPY delta applied to the item's unit price when selected; may be negative. */
  price_delta: priceDeltaValue,
  sort_order: sortOrderValue.default(0),
});
export type CreateOptionInput = z.infer<typeof CreateOptionInput>;

export const UpdateOptionInput = z.object({
  name: displayName,
  price_delta: priceDeltaValue,
  sort_order: sortOrderValue.default(0),
});
export type UpdateOptionInput = z.infer<typeof UpdateOptionInput>;

export interface OptionResponse {
  id: string;
  store_id: string;
  group_id: string;
  name: string;
  price_delta: number;
  sort_order: number;
}

/** An option group with its options, as embedded per-item in bootstrap. */
export interface MenuItemOptionGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: {
    id: string;
    name: string;
    price_delta: number;
    sort_order: number;
  }[];
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

export const CreateSeatInput = z.object({
  name: displayName,
});
export type CreateSeatInput = z.infer<typeof CreateSeatInput>;

export const UpdateSeatInput = z.object({
  name: displayName,
});
export type UpdateSeatInput = z.infer<typeof UpdateSeatInput>;

export interface SeatResponse {
  id: string;
  store_id: string;
  name: string;
  qr_token: string;
  is_active: boolean;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Order (customer screen)
// ---------------------------------------------------------------------------

/** Trimmed customer note, ≤ 200 chars; empty after trimming normalizes to null. */
const orderItemNote = z
  .string()
  .nullable()
  .transform((s) => {
    if (s === null) return null;
    const trimmed = s.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .pipe(z.string().max(200).nullable());

export const AddOrderItemsInput = z.object({
  items: z
    .array(
      z.object({
        menu_item_id: z
          .string()
          .transform((s) => s.trim())
          .pipe(z.string().min(1).max(64)),
        quantity: z.number().int().min(1).max(99),
        option_ids: z.array(z.string().max(64)).max(20).default([]),
        note: orderItemNote.optional().default(null),
      }),
    )
    .min(1)
    .max(50),
});
export type AddOrderItemsInput = z.infer<typeof AddOrderItemsInput>;

export interface OrderItemOptionResponse {
  id: string;
  name_snapshot: string;
  group_name_snapshot: string;
  price_delta_snapshot: number;
}

export interface OrderItemResponse {
  id: string;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  status: "ordered" | "served" | "cancelled";
  created_at: number;
  options: OrderItemOptionResponse[];
  note: string | null;
  tax_rate_snapshot: number;
}

export interface OrderResponse {
  id: string;
  status: "open" | "payment_requested" | "paid" | "cancelled";
  items: OrderItemResponse[];
  total: number;
}

export interface BootstrapResponse {
  seat: { name: string };
  menu: {
    categories: { id: string; name: string; sort_order: number }[];
    items: {
      id: string;
      category_id: string | null;
      name: string;
      price: number;
      sort_order: number;
      description: string | null;
      image_key: string | null;
      option_groups: MenuItemOptionGroup[];
    }[];
  };
  order: OrderResponse | null;
  /** The seat's open call-staff request, if any (null once resolved). */
  call: CallResponse | null;
}

// ---------------------------------------------------------------------------
// Admin orders
// ---------------------------------------------------------------------------

export interface AdminOrderItemResponse {
  id: string;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  options: OrderItemOptionResponse[];
  note: string | null;
  status: "ordered" | "served" | "cancelled";
  created_at: number;
}

export interface AdminOrderResponse {
  id: string;
  seat_name: string;
  status: "open" | "payment_requested";
  items: AdminOrderItemResponse[];
  total: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** Trimmed discount reason, ≤ 200 chars; empty after trimming normalizes to null. */
const discountReason = z
  .string()
  .nullable()
  .transform((s) => {
    if (s === null) return null;
    const trimmed = s.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .pipe(z.string().max(200).nullable());

export const CreatePaymentInput = z
  .object({
    order_id: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1).max(64)),
    /** Recorded at a staff-operated terminal; no processor integration. */
    method: z.enum(["cash", "card", "qr"]).default("cash"),
    /** Whole-check discount; server bounds it to [0, items total]. */
    discount_amount: z.number().int().min(0).default(0),
    /** Required when discount_amount > 0. */
    discount_reason: discountReason.optional().default(null),
  })
  .refine(
    (data) => data.discount_amount === 0 || data.discount_reason !== null,
    {
      message: "discount_reason is required when discount_amount > 0",
      path: ["discount_reason"],
    },
  );
export type CreatePaymentInput = z.infer<typeof CreatePaymentInput>;

export type PaymentMethod = "cash" | "card" | "qr";

export interface PaymentResponse {
  id: string;
  order_id: string;
  total_amount: number;
  method: PaymentMethod;
  discount_amount: number;
  discount_reason: string | null;
  paid_at: number;
  voided_at: number | null;
  void_reason: string | null;
}

export const CreateVoidInput = z.object({
  void_reason: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(200)),
});
export type CreateVoidInput = z.infer<typeof CreateVoidInput>;

export interface ReceiptTaxBucketResponse {
  /** Whole percent, e.g. 10 for standard rate. */
  rate: number;
  taxable_amount: number;
  tax_amount: number;
}

/** Digital receipt for a paid order — see GET /api/order/:seatToken/receipt/:orderId. */
export interface ReceiptResponse {
  order_id: string;
  store_name: string;
  seat_name: string;
  items: OrderItemResponse[];
  /** Pre-discount items total. */
  items_total: number;
  discount_amount: number;
  discount_reason: string | null;
  /** Charged amount: items_total - discount_amount. */
  total_amount: number;
  tax_breakdown: ReceiptTaxBucketResponse[];
  method: PaymentMethod;
  paid_at: number;
}

// ---------------------------------------------------------------------------
// Staff calls
// ---------------------------------------------------------------------------

export interface CallResponse {
  id: string;
  status: "open" | "resolved";
  created_at: number;
}

export interface AdminCallResponse {
  id: string;
  seat_name: string;
  status: "open" | "resolved";
  created_at: number;
  resolved_at: number | null;
}
