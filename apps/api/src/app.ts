import { Hono } from "hono";
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

const corsMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const allowed = [
    c.env.ADMIN_ORIGIN,
    c.env.ORDER_ORIGIN,
    c.env.SIGNUP_ORIGIN,
    c.env.SHIFT_ORIGIN,
  ].filter(Boolean);

  const origin = c.req.header("Origin") ?? "";
  const isAllowedOrigin = allowed.includes(origin);

  const corsHeaders: Record<string, string> = isAllowedOrigin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods":
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
      }
    : {};

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204, corsHeaders);
  }

  if (origin && !isAllowedOrigin && STATE_CHANGING_METHODS.has(c.req.method)) {
    return c.body(null, 403);
  }

  await next();

  // Applied to the final response rather than via c.header() before next():
  // handlers that return a raw Response (errorResponse) bypass Hono's prepared
  // headers, which left every 4xx unreadable to the cross-origin SPAs.
  for (const [name, value] of Object.entries(corsHeaders)) {
    if (name === "Vary") c.res.headers.append(name, value);
    else c.res.headers.set(name, value);
  }
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsMiddleware);

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
