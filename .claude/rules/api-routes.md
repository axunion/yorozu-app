---
paths:
  - "apps/api/src/routes/**"
  - "apps/api/src/middleware.ts"
  - "apps/api/src/auth.ts"
---

# API route conventions

## Router setup

- Create routers as `new Hono<{ Bindings: Env }>()`
- After creating a new router file, mount it in `apps/api/src/app.ts` under the appropriate path

## Request validation

- Validate request bodies with `bodyValidator(ZodSchema)` from `../validator`
- Access validated data via `c.req.valid("json")`

## Database access

- Always create the DB client inline per handler: `const db = createDb(c.env.DB)` from `@yorozu/db`

## Response shape

- Success: `c.json({ data: ... }, status)`
- Error: `errorResponse(code, message, status)` from `@yorozu/core`

## Authentication patterns

| Route type | Auth mechanism |
|---|---|
| Admin (menu, seats, orders, payments) | `session_token` HttpOnly cookie — enforced by `requireStore` middleware |
| Customer order API | `qr_token` URL **path** parameter (`:seatToken`) — enforced by `requireSeat` middleware, applied inline per-route (not global `.use()`) |
| Public (stores, auth) | No auth |

Do not mix auth patterns; check `apps/api/src/app.ts` mount order to confirm which middleware applies.
