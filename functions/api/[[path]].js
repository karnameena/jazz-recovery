const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body, status = 503) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function getApiOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("The Jazz Recovery API origin is not configured.");
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("JAZZ_API_ORIGIN must be an HTTPS origin without a path.");
  }
  return parsed;
}

/**
 * Same-origin API bridge for Cloudflare Pages.
 *
 * The website is hosted on pages.dev and the Worker on workers.dev. Direct
 * cross-site cookie authentication is unreliable because browsers may block
 * third-party cookies. This bridge makes the browser talk only to pages.dev:
 * the __Host session cookie is therefore first-party, then forwarded to the
 * Worker on each request.
 */
export async function onRequest({ request, env }) {
  let apiOrigin;
  try {
    apiOrigin = getApiOrigin(env.JAZZ_API_ORIGIN);
  } catch (error) {
    return json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Jazz Recovery API is not configured.",
    });
  }

  const incomingUrl = new URL(request.url);
  if (!incomingUrl.pathname.startsWith("/api/")) {
    return json({ ok: false, error: "API route not found." }, 404);
  }

  const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, apiOrigin);
  const upstreamRequest = new Request(upstreamUrl, request);

  try {
    const upstream = await fetch(upstreamRequest);
    const headers = new Headers(upstream.headers);
    headers.set("cache-control", "no-store");

    // Preserve Set-Cookie from the Worker. The browser receives it from the
    // Pages origin, making the __Host cookie first-party and available to the
    // same-origin /api requests that follow.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return json(
      {
        ok: false,
        error: "Could not reach the Jazz Recovery API Worker.",
      },
      502,
    );
  }
}
