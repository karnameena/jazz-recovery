# Jazz Recovery Website

React 18 + TypeScript + Vite customer recovery portal.

## Local development

1. Install Node.js 22 or later.
2. Run `npm ci` inside `website`.
3. Create `.env.local` if needed. For local Vite proxy use `LOST_MODE_API_URL=http://127.0.0.1:8891` (the default proxy target).
4. Start the API server first, then run `npm run dev`.
5. Open `http://localhost:5190`.

For a hosted build, set `VITE_API_BASE_URL` to the public HTTPS backend origin before `npm run build`.

## Subscription behaviour

- Newly registered eligible users receive a seven-day trial recorded by the backend in PostgreSQL.
- The customer subscription screen appears only when the backend reports expired access and no verified active subscription.
- Monthly is ₹49 and annual is ₹399. Each opens its corresponding Razorpay payment link.
- Annual discount codes are validated by the backend and support 10%, 20% and 50%. Fixed-price Razorpay links cannot collect discounted totals; those intents remain pending until dynamic checkout is configured.
- No browser redirect or client message activates a subscription. A verified server-side payment integration is required.

## Billing administrator

The first administrator is designated from the server using `npm run bootstrap-billing-admin` and the private `JAZZ_BILLING_ADMIN_BOOTSTRAP_SECRET`. Never place that secret in website environment variables or frontend code. Admin APIs check the PostgreSQL administrator record on every request.

See `docs/WORKFLOW-OVERVIEW.md` for the access and billing flow.

## Website architecture

See `docs/PROJECT-STRUCTURE-AND-WORKFLOW.md` for the current folder tree, component responsibilities, startup flow, data flow, and security boundaries.


## Phase 1 local Cloudflare Worker review (no remote D1)
The integrated Worker is the backend target for this Phase 1 package. Start it locally from `server/server` with `npm run dev` after applying D1 migrations with the explicit `--local` flag. In a second terminal, from `website/website`, set `LOST_MODE_API_URL=http://127.0.0.1:8787` before running `npm run dev`. Vite will proxy `/api` requests to the local Worker.

PowerShell:
```powershell
# Terminal 1
cd .\server\server
npm ci
npx wrangler d1 migrations apply jazz-recovery-main --local --config cloudflare/wrangler.toml
npm run dev

# Terminal 2
cd .\website\website
npm ci
$env:LOST_MODE_API_URL = "http://127.0.0.1:8787"
npm run dev
```

Do not run `wrangler deploy` or omit `--local` from the D1 migration command during local review. The supplied admin API source is included, but the separate admin dashboard UI source is not present in this website archive; the India-time server-side trial input fix is included and must be checked from the actual admin page.


## Cloudflare Pages API bridge (required for browser authentication)

The website and API Worker currently use different default Cloudflare domains
(`pages.dev` and `workers.dev`). Browsers can block third-party cookies between
those sites, which causes login to appear successful while the following
`/api/auth/session` request is unauthenticated.

The `functions/api/[[path]].js` Pages Function forwards `/api/*` requests to the
Worker while keeping the browser request and `__Host-jazz_lost_mode_session`
cookie on the Pages origin. This makes the session cookie first-party without
weakening the existing `HttpOnly`, `Secure`, `SameSite=Lax` cookie settings.

Configure this environment variable on the `jazz-recovery` Pages project for
both Production and Preview:

- `JAZZ_API_ORIGIN` = `https://jazz-recovery-api-staging.jazz-recovery.workers.dev`

The API frontend now uses relative `/api/...` paths. Do not set
`VITE_API_BASE_URL` to the `workers.dev` address in production; that would
bypass the same-origin bridge and reintroduce third-party-cookie failures.

Local Vite development continues to use the `/api` proxy configured in
`vite.config.ts`. Set `LOST_MODE_API_URL` or `VITE_API_BASE_URL` only when the
local Worker/API is running on a non-default address.

Run the Pages bridge tests with:

```powershell
npm run test:proxy
```

After deploying, verify that the browser receives the session cookie for
`jazz-recovery.pages.dev`, and that `/api/auth/session` succeeds after login.
