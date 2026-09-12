/// <reference types="@cloudflare/workers-types" />

// Global Env type for the API Worker.
// Bindings are resolved from wrangler.jsonc; secrets from .dev.vars (local) or
// Cloudflare dashboard (production).
interface Env {
  DB: D1Database;
  /** Menu item images. Keys: menu/{store_id}/{item_id}/{random}.{ext}. */
  IMAGES: R2Bucket;
  /** Origin of the admin SPA, e.g. "https://admin.example.com" */
  ADMIN_ORIGIN: string;
  /** Origin of the customer order SPA, e.g. "https://order.example.com" */
  ORDER_ORIGIN: string;
  /** Origin of the store signup SPA, e.g. "https://signup.example.com" */
  SIGNUP_ORIGIN: string;
  /** Origin of the shift-management SPA, e.g. "https://shift.example.com" */
  SHIFT_ORIGIN: string;
  /**
   * Parent domain for cross-subdomain cookie sharing, e.g. ".example.com".
   * Leave empty in local dev so the cookie is scoped to localhost only.
   */
  COOKIE_DOMAIN: string;
  /** Resend API key for passcode email delivery. Omit in local dev → console fallback. */
  RESEND_API_KEY: string;
  /** Sender address used in outgoing emails. */
  MAIL_FROM: string;
  /**
   * "production" in deployed environments; set to "development" in local
   * `.dev.vars` to echo the passcode directly in API responses
   * instead of requiring email delivery.
   */
  ENVIRONMENT: string;
  /**
   * HMAC key for emailed passcodes (`hashOtpCode`). A 6-digit code has only
   * 10^6 possibilities, so an unkeyed digest of one is reversible from a
   * database read; keeping this key outside D1 is what makes the stored
   * digests useless on their own. Required — issuance throws without it.
   */
  OTP_PEPPER: string;
}

// Augment Cloudflare.Env for `import { env } from "cloudflare:workers"` in tests.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    IMAGES: R2Bucket;
    ADMIN_ORIGIN: string;
    ORDER_ORIGIN: string;
    SIGNUP_ORIGIN: string;
    SHIFT_ORIGIN: string;
    COOKIE_DOMAIN: string;
    RESEND_API_KEY: string;
    MAIL_FROM: string;
    ENVIRONMENT: string;
    OTP_PEPPER: string;
  }
}
