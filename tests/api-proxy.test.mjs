import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/[[path]].js";

test("Pages API bridge forwards login request and first-party cookie", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (request) => {
    forwarded = request;
    return new Response(JSON.stringify({ ok: true, username: "mama" }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie":
          "__Host-jazz_lost_mode_session=test-session; Path=/; HttpOnly; Secure; SameSite=Lax",
      },
    });
  };

  try {
    const request = new Request("https://jazz-recovery.pages.dev/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://jazz-recovery.pages.dev",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "mama", password: "test-password" }),
    });
    const response = await onRequest({
      request,
      env: { JAZZ_API_ORIGIN: "https://jazz-recovery-api-staging.jazz-recovery.workers.dev" },
    });

    assert.equal(response.status, 200);
    assert.equal(new URL(forwarded.url).origin, "https://jazz-recovery-api-staging.jazz-recovery.workers.dev");
    assert.equal(new URL(forwarded.url).pathname, "/api/auth/login");
    assert.equal(forwarded.headers.get("origin"), "https://jazz-recovery.pages.dev");
    assert.deepEqual(await forwarded.json(), { username: "mama", password: "test-password" });
    assert.match(response.headers.get("set-cookie") || "", /SameSite=Lax/);
    assert.match(response.headers.get("set-cookie") || "", /HttpOnly/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages API bridge forwards the first-party session cookie on later requests", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedCookie = null;
  globalThis.fetch = async (request) => {
    forwardedCookie = request.headers.get("cookie");
    return Response.json({ ok: true, username: "mama" });
  };

  try {
    const request = new Request("https://jazz-recovery.pages.dev/api/auth/session", {
      headers: {
        Cookie: "__Host-jazz_lost_mode_session=test-session",
      },
    });
    const response = await onRequest({
      request,
      env: { JAZZ_API_ORIGIN: "https://jazz-recovery-api-staging.jazz-recovery.workers.dev" },
    });
    assert.equal(response.status, 200);
    assert.equal(forwardedCookie, "__Host-jazz_lost_mode_session=test-session");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages API bridge fails closed when the Worker origin is missing or unsafe", async () => {
  const request = new Request("https://jazz-recovery.pages.dev/api/auth/session");
  const missing = await onRequest({ request, env: {} });
  assert.equal(missing.status, 503);
  const unsafe = await onRequest({
    request,
    env: { JAZZ_API_ORIGIN: "http://example.com" },
  });
  assert.equal(unsafe.status, 503);
});
