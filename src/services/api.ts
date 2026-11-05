/**
 * All browser API calls are same-origin.
 *
 * In local development Vite proxies /api to the configured API target.
 * In Cloudflare Pages production, functions/api/[[path]].js forwards /api to
 * the Worker while keeping the session cookie on the Pages origin. This avoids
 * third-party-cookie blocking between pages.dev and workers.dev.
 */
const API_BASE_URL = "";

export async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers,
    });
  } catch {
    throw new Error(
      "Could not reach the Jazz Recovery API. Check the Cloudflare Pages API bridge and Worker status.",
    );
  }

  const contentType = String(
    response.headers.get("content-type") || "",
  ).toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Jazz Recovery API returned an unexpected response (${response.status}). ` +
        "Check the Cloudflare Pages API bridge configuration.",
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.error || `Request failed (${response.status})`,
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data;
}
