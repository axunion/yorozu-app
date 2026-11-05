import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { adminOrdersRouter } from "./routes/admin-orders";
import { authRouter } from "./routes/auth";
import { menuRouter } from "./routes/menu";
import { menuImagesRouter } from "./routes/menu-images";
import { menuOptionsRouter } from "./routes/menu-options";
import { orderRouter } from "./routes/order";
import { paymentsRouter } from "./routes/payments";
import { seatsRouter } from "./routes/seats";
import { shiftAvailabilityRouter } from "./routes/shift-availability";
import { shiftMembersRouter } from "./routes/shift-members";
import { shiftPeriodsRouter } from "./routes/shift-periods";
import { shiftPositionsRouter } from "./routes/shift-positions";
import { shiftScheduleRouter, shiftsRouter } from "./routes/shift-schedule";
import { shiftTemplatesRouter } from "./routes/shift-templates";
import { staffRouter } from "./routes/staff";
import { staffCallsRouter } from "./routes/staff-calls";
import { storesRouter } from "./routes/stores";

// ---------------------------------------------------------------------------
// CORS middleware
// ---------------------------------------------------------------------------

// Cross-origin requests from the three SPAs require CORS with credentials.
// The allowed origins are read from env at request time so they can be
// configured per-environment without rebuilding the Worker.
//
// Note: SameSite=None on the session_token cookie + credentials:true CORS is
// the strategy that allows a single API Worker to serve multiple SPA origins
// while keeping the cookie HttpOnly. The "Vary: Origin" header ensures
// downstream caches do not serve one origin's CORS headers to another.
//
// CORS alone only governs whether client-side JS can read a cross-origin
// response — it does not stop the browser from sending the request in the
// first place (e.g. a cross-site form POST), so with SameSite=None cookies
// that would still execute as CSRF. State-changing methods therefore hard-
// reject any request whose Origin header is present but not allowlisted;
// requests with no Origin header (same-origin navigations, non-browser
// clients, tests) are left to the route's own auth checks.
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const allowedOrigins = (env: Env): string[] =>
  [
    env.ADMIN_ORIGIN,
    env.ORDER_ORIGIN,
    env.SIGNUP_ORIGIN,
    env.SHIFT_ORIGIN,
  ].filter(Boolean);

// hono/cors writes through c.res before next(), so its headers survive
// handlers that return a raw Response (errorResponse) — c.header() would not.
const corsMiddleware = cors({
  origin: (origin, c) =>
    allowedOrigins(c.env).includes(origin) ? origin : null,
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type"],
});

const csrfOriginMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const origin = c.req.header("Origin");
    if (
      origin &&
      STATE_CHANGING_METHODS.has(c.req.method) &&
      !allowedOrigins(c.env).includes(origin)
    ) {
      return c.body(null, 403);
    }
    await next();
  },
);

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsMiddleware);
app.use("*", csrfOriginMiddleware);

// Public endpoints
app.route("/api/stores", storesRouter);
app.route("/api/auth", authRouter);
app.route("/api/menu/images", menuImagesRouter);

// Admin-authenticated endpoints (session_token cookie)
app.route("/api/menu", menuRouter);
app.route("/api/menu/option-groups", menuOptionsRouter);
app.route("/api/seats", seatsRouter);
app.route("/api/admin/orders", adminOrdersRouter);
app.route("/api/admin/calls", staffCallsRouter);
app.route("/api/payments", paymentsRouter);
app.route("/api/staff", staffRouter);

// Shift management — same session cookie, additionally gated by
// requireEntitlement("shift") inside each router.
app.route("/api/shift/availability", shiftAvailabilityRouter);
app.route("/api/shift/members", shiftMembersRouter);
app.route("/api/shift/periods", shiftPeriodsRouter);
app.route("/api/shift/positions", shiftPositionsRouter);
app.route("/api/shift/schedule", shiftScheduleRouter);
app.route("/api/shift/shifts", shiftsRouter);
app.route("/api/shift/templates", shiftTemplatesRouter);

// Customer-facing order API — authenticated via qr_token URL parameter
app.route("/api/order", orderRouter);

export { app };
