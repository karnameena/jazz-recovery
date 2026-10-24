const rawApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();

function apiBaseUrl() {
  if (!rawApiBaseUrl) return "";
  try {
    const parsed = new URL(rawApiBaseUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error(
        "API URL must not contain credentials, query parameters, or fragments.",
      );
    }
    const local =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && local)
    ) {
      throw new Error("Hosted Lost Mode API must use HTTPS.");
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid API URL";
    throw new Error(`Lost Mode API configuration error: ${message}`);
  }
}

const API_BASE_URL = apiBaseUrl();

export async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  // Do not attach application/json to body-less GET requests. Avoiding that
  // unnecessary non-simple header prevents a CORS preflight on every dashboard poll.
  if (options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: "include",
      cache: "no-store",
      headers,
    });
  } catch (error) {
    throw new Error(
      API_BASE_URL
        ? "Could not reach the Jazz Lost Mode server. Check the hosted API URL, HTTPS, CORS origin, and server status."
        : "Could not reach the Jazz Lost Mode API. If web and server are hosted separately, set VITE_API_BASE_URL on the web build.",
    );
  }

  const contentType = String(
    response.headers.get("content-type") || "",
  ).toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Lost Mode API returned an unexpected response (${response.status}). ` +
        "Check VITE_API_BASE_URL and make sure it points to the Lost Mode server, not the website.",
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export async function apiBlob(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "image/jpeg,image/png,application/json" },
    });
  } catch {
    throw new Error(
      API_BASE_URL
        ? "Could not reach the Jazz Lost Mode server while loading the recovery photo."
        : "Could not reach the Jazz Lost Mode API. Check the website API proxy or VITE_API_BASE_URL.",
    );
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `Could not load the current recovery photo (${response.status}).`,
    );
  }

  const contentType = String(response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "image/jpeg" && contentType !== "image/png") {
    throw new Error("The server did not return a valid JPEG or PNG recovery photo.");
  }

  const blob = await response.blob();
  if (!blob.size || blob.size > 5 * 1024 * 1024) {
    throw new Error("The current recovery photo is empty or exceeds the 5 MB limit.");
  }
  return blob;
}
