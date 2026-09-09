# Deployment

All five apps deploy to Cloudflare Workers with `wrangler deploy`. Deployment is
**manual** for now — CI (`.github/workflows/ci.yml`) runs `pnpm check` / `test` /
`build` only and does not deploy.

## One-time setup

1. Authenticate: `wrangler login` (or set `CLOUDFLARE_API_TOKEN`).
2. Create the production D1 database:

   ```sh
   wrangler d1 create yorozu-app
   ```

   Copy the returned `database_id` into `apps/api/wrangler.jsonc`
   (`d1_databases[0].database_id` — currently a placeholder UUID).
3. Create the R2 bucket for menu item images:

   ```sh
   wrangler r2 bucket create yorozu-app-images
   ```

   Update `bucket_name` in `apps/api/wrangler.jsonc` (`r2_buckets[0]`) if you
   chose a different name. No `database_id`-style opaque ID to copy — R2
   buckets are addressed by name.
4. Set production values in `apps/api/wrangler.jsonc` `vars`:
   - `ADMIN_ORIGIN` / `ORDER_ORIGIN` / `SIGNUP_ORIGIN` / `SHIFT_ORIGIN` — the
     deployed SPA URLs (currently localhost placeholders). Replace **all four**:
     each is in the credentialed CORS allowlist, so a leftover `localhost`
     value stays allowed in production.
   - `COOKIE_DOMAIN` — e.g. `.example.com` for cross-subdomain cookie sharing.
   - `ENVIRONMENT` — must stay `"production"` (gates dev-only auth conveniences,
     see [auth.md](./auth.md)).
5. Set secrets (never put these in `wrangler.jsonc`):

   ```sh
   wrangler secret put RESEND_API_KEY   # run inside apps/api
   wrangler secret put MAIL_FROM
   wrangler secret put OTP_PEPPER
   ```

   `OTP_PEPPER` keys the HMAC over emailed passcodes. Use a long random
   value; rotating it invalidates every passcode issued so far, which is
   harmless in practice given their short lifetime.
6. **Deploy-blocking — configure per-IP WAF rate limiting** on the API's
   Cloudflare zone before exposing it publicly (see
   [auth.md](./auth.md#magic-link-flow) for the per-store per-hour cap,
   which is enforced in the Worker; this is the complementary per-IP
   layer that only the platform can do well):
   - `POST /api/auth/login` and `POST /api/stores`: e.g. 10 requests /
     10 minutes per IP → block. Configure under **Security → WAF →
     Rate limiting rules** in the Cloudflare dashboard (or `wrangler`
     API) for the zone hosting the API Worker.
   - This is config, not code — no test covers it; verify manually
     against the deployed zone before announcing the pilot publicly.

## Deploying

```sh
# 1. Apply pending migrations to production D1 (from apps/api)
pnpm --filter @yorozu/api exec wrangler d1 migrations apply yorozu-app --remote

# 2. Deploy the API
pnpm --filter @yorozu/api exec wrangler deploy

# 3. Build and deploy each SPA
#    VITE_API_BASE must point at the deployed API origin at build time.
#    @yorozu/admin additionally needs VITE_ORDER_BASE — it is baked into seat QR codes.
VITE_API_BASE=https://api.example.com VITE_ORDER_BASE=https://order.example.com \
  pnpm --filter @yorozu/admin build
pnpm --filter @yorozu/admin exec wrangler deploy
# repeat for @yorozu/order, @yorozu/signup and @yorozu/shift (VITE_API_BASE only)
```

Apply migrations before deploying API code that depends on them.

## Rules

- Never run `wrangler d1 migrations apply --remote` against production while
  untested migrations exist locally — CI must be green on the commit you deploy.
- Local D1 state is separate (`apps/api/.wrangler/state/`); `pnpm db:migrate` /
  `db:reset` only ever touch local state.
