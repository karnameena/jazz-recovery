import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BatteryCharging,
  Camera,
  ChevronRight,
  CircleDot,
  Crosshair,
  Download,
  ExternalLink,
  Gauge,
  LocateFixed,
  LockKeyhole,
  LogOut,
  MapPin,
  Mic,
  Navigation,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Volume2,
  Wifi,
} from "lucide-react";
import "./styles.css";
import "./responsive-fixes.css";
import { VoiceInput } from "./voice/VoiceInput";

type LocationState = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  timestamp?: number | string | null;
};

type PhotoState = {
  dataUrl: string;
  camera?: string | null;
  timestamp?: number | string | null;
};

type Device = {
  id: number;
  deviceId?: string;
  deviceName: string;
  deviceType: string;
  online: boolean;
  battery: number | null;
  charging?: boolean;
  network: string;
  lastSeen: string | null;
  locationServices?: "ON" | "OFF" | "UNKNOWN" | "OFFLINE";
  locationServicesLastConfirmed?: number | null;
  mode: string;
  location: LocationState | null;
  photo: PhotoState | null;
};

const rawApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();

function apiBaseUrl() {
  if (!rawApiBaseUrl) return "";
  try {
    const parsed = new URL(rawApiBaseUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("API URL must not contain credentials, query parameters, or fragments.");
    }
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
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

async function api(path: string, options: RequestInit = {}) {
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
        : "Could not reach the Jazz Lost Mode API. If web and server are hosted separately, set VITE_API_BASE_URL on the web build."
    );
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Lost Mode API returned an unexpected response (${response.status}). ` +
      "Check VITE_API_BASE_URL and make sure it points to the Lost Mode server, not the website."
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function mapEmbedUrl(location: LocationState) {
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  const spread = 0.006;
  const bbox = [lon - spread, lat - spread, lon + spread, lat + spread].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
}

function googleMapsUrl(location: LocationState) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
}

function downloadText(filename: string, value: string) {
  const blob = new Blob([value], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function actionKey(name: string, args: Record<string, unknown> = {}) {
  if (name === "RECOVERY_PHOTO") return `${name}:${args.camera === "rear" ? "rear" : "front"}`;
  return name;
}

function Login({ done }: { done: () => void }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDeviceToken, setShowDeviceToken] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const [deviceId, setDeviceId] = useState("");
  const [deviceToken, setDeviceToken] = useState("");

  function generateDeviceCredentials() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    const token = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    const idBytes = new Uint8Array(8);
    window.crypto.getRandomValues(idBytes);
    const id = "JZ-" + Array.from(idBytes, value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    setDeviceId(id);
    setDeviceToken(token);
    if (tokenRef.current) tokenRef.current.value = token;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    const form = event.currentTarget;
    const fields = new FormData(form);
    const username = String(fields.get("username") || "").trim();
    let password = String(fields.get("password") || "");
    const confirmPassword = String(fields.get("confirmPassword") || "");
    const deviceName = String(fields.get("deviceName") || "").trim();
    const imei = String(fields.get("imei") || "").replace(/[\s-]/g, "");
    const submittedDeviceId = String(fields.get("deviceId") || "").trim();
    let submittedDeviceToken = String(fields.get("deviceToken") || "").trim();

    if (!username || !password) {
      setError("Enter your username and password.");
      setSubmitting(false);
      return;
    }
    if (registerMode && password !== confirmPassword) {
      if (confirmRef.current) confirmRef.current.value = "";
      setError("The passwords do not match.");
      setSubmitting(false);
      return;
    }
    if (registerMode && (!deviceName || !/^\d{14,16}$/.test(imei) || !submittedDeviceId || submittedDeviceToken.length < 32)) {
      setError("Enter the device name and 14–16 digit IMEI, then generate a device ID and token.");
      setSubmitting(false);
      return;
    }

    const body = registerMode
      ? JSON.stringify({ username, password, deviceName, imei, deviceId: submittedDeviceId, deviceToken: submittedDeviceToken })
      : JSON.stringify({ username, password });
    password = "";
    submittedDeviceToken = "";
    if (passwordRef.current) passwordRef.current.value = "";
    if (confirmRef.current) confirmRef.current.value = "";
    if (tokenRef.current) tokenRef.current.value = "";

    try {
      await api(registerMode ? "/api/auth/register" : "/api/auth/login", { method: "POST", body });
      form.reset();
      setDeviceId("");
      setDeviceToken("");
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : (registerMode ? "Registration failed" : "Login failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="auth-card glass-panel">
        <div className="brand-mark"><Sparkles size={28} /></div>
        <div className="eyebrow">JAZZ SECURE RECOVERY</div>
        <h1>{registerMode ? "Create account" : "Lost Mode"}</h1>
        <p className="auth-subtitle">{registerMode ? "Register your account and pair your Android recovery app. Your 7-day trial starts after successful registration." : "Secure access to your registered recovery devices."}</p>
        <form onSubmit={submit} className="auth-form" autoComplete="on">
          <label>
            <span>Username</span>
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Enter username" required />
          </label>
          <label>
            <span>Password</span>
            <input ref={passwordRef} name="password" autoComplete={registerMode ? "new-password" : "current-password"} type={showPassword ? "text" : "password"} placeholder={registerMode ? "Create a strong password" : "Enter password"} required />
          </label>
          {registerMode && <>
            <label>
              <span>Confirm password</span>
              <input ref={confirmRef} name="confirmPassword" autoComplete="new-password" type={showPassword ? "text" : "password"} placeholder="Confirm password" required />
            </label>
            <button className="ghost-button" type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide passwords" : "Show passwords"}</button>
            <label>
              <span>Device name</span>
              <input name="deviceName" autoComplete="off" placeholder="e.g. My Android phone" required />
            </label>
            <label>
              <span>IMEI (14–16 digits)</span>
              <input name="imei" inputMode="numeric" autoComplete="off" maxLength={16} placeholder="Enter device IMEI" required />
            </label>
            <label>
              <span>Device token ID</span>
              <input name="deviceId" value={deviceId} onChange={event => setDeviceId(event.target.value)} autoComplete="off" placeholder="Generate a unique device ID" required />
            </label>
            <label>
              <span>Device token (copy into the Android app)</span>
              <input ref={tokenRef} name="deviceToken" value={deviceToken} onChange={event => setDeviceToken(event.target.value)} type={showDeviceToken ? "text" : "password"} autoComplete="off" placeholder="Generate a secure device token" required />
            </label>
            <div className="auth-inline-actions">
              <button className="secondary-button" type="button" onClick={generateDeviceCredentials}>Generate device ID + token</button>
              <button className="ghost-button" type="button" onClick={() => setShowDeviceToken(value => !value)}>{showDeviceToken ? "Hide token" : "Show token"}</button>
            </div>
            <p className="auth-help">Save the generated device ID and token and enter them in the paired Android app. The server stores a hash of the token, not the plain token.</p>
          </>}
          {!registerMode && <button className="ghost-button" type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide password" : "Show password"}</button>}
          {error && <div className="error-banner" role="alert">{error}</div>}
          <button className="primary-button full-width" type="submit" disabled={submitting}>
            {submitting ? <RefreshCw className="spin" size={18} /> : <LockKeyhole size={18} />}
            {submitting ? (registerMode ? "Creating account…" : "Verifying securely…") : (registerMode ? "Register and start 7-day trial" : "Enter Lost Mode")}
          </button>
        </form>
        <button className="auth-switch" type="button" onClick={() => { setRegisterMode(value => !value); setError(""); setShowPassword(false); setShowDeviceToken(false); }}>
          {registerMode ? "Already registered? Sign in" : "New to Jazz Recovery? Create an account"}
        </button>
        <div className="secure-note"><ShieldCheck size={16} /> Secure account and device authentication</div>
      </section>
      <footer className="auth-footer">Developed by 😈gunakarna😈</footer>
    </main>
  );
}

declare global {
  interface Window { Razorpay?: new (options: Record<string, any>) => { open: () => void }; }
}

function BillingPanel() {
  const [status, setStatus] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [codes, setCodes] = useState<any[]>([]);
  const [newCode, setNewCode] = useState("");
  const [label, setLabel] = useState("Promotion");
  const [percent, setPercent] = useState("10");
  const [expiry, setExpiry] = useState("");
  const [limit, setLimit] = useState("");

  async function refresh() {
    const data = await api("/api/billing/status");
    setStatus(data);
    try {
      const admin = await api("/api/billing/admin/discount-codes");
      setIsAdmin(true);
      setCodes(admin.items || []);
    } catch { setIsAdmin(false); }
  }
  useEffect(() => { void refresh().catch(error => setMessage(error.message || "Could not load subscription status")); }, []);

  async function applyCode() {
    setBusy(true); setMessage(""); setApplied(null);
    try {
      const result = await api("/api/billing/discount/validate", { method: "POST", body: JSON.stringify({ code }) });
      if (!result.valid) throw new Error(result.error || "Invalid discount code");
      setApplied(result);
      setMessage("Discount applied: " + result.percentOff + "% off. Final price ₹" + (result.amountPaise / 100).toFixed(2) + ".");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not validate code"); }
    finally { setBusy(false); }
  }

  async function subscribe() {
    setBusy(true); setMessage("");
    try {
      const order = await api("/api/billing/checkout", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      if (order.complimentary) {
        setMessage("Complimentary annual access activated.");
        await refresh();
        return;
      }
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Could not load secure Razorpay Checkout"));
          document.head.appendChild(script);
        });
      }
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
      const checkout = new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amountPaise, currency: order.currency,
        name: "Jazz Recovery", description: order.description,
        theme: { color: "#748cff" },
        handler: () => setMessage("Payment submitted. Subscription activates after the server verifies Razorpay's webhook. Tap Refresh status in a moment."),
        modal: { ondismiss: () => setMessage("Checkout closed. If you completed payment, wait for server verification before retrying.") }
      });
      checkout.open();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start checkout"); }
    finally { setBusy(false); }
  }

  async function claimAdmin() {
    setBusy(true); setMessage("");
    try {
      await api("/api/billing/admin/claim", { method: "POST", body: JSON.stringify({ bootstrapSecret }) });
      setBootstrapSecret("");
      setMessage("Billing admin claimed for this account. Remove the bootstrap secret from server settings now.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Admin setup failed"); }
    finally { setBusy(false); }
  }

  async function createCode() {
    setBusy(true); setMessage("");
    try {
      const result = await api("/api/billing/admin/discount-codes", { method: "POST", body: JSON.stringify({ code: newCode || undefined, label, percentOff: Number(percent), expiresAt: expiry || null, maxRedemptions: limit || null }) });
      setNewCode(result.code);
      setMessage("New code created. Copy it now; only its hash is stored. Code: " + result.code);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create code"); }
    finally { setBusy(false); }
  }

  async function codeAction(id: string, action: "disable" | "rotate") {
    setBusy(true); setMessage("");
    try {
      const result = await api("/api/billing/admin/discount-codes/" + id + "/" + action, { method: "POST", body: JSON.stringify({}) });
      if (action === "rotate") setMessage("New code generated; copy it now: " + result.code);
      else setMessage("Code disabled for future redemptions. Existing entitlements remain unchanged.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Discount update failed"); }
    finally { setBusy(false); }
  }

  if (!status) return <section className="billing-panel glass-panel"><p>Loading subscription status…</p></section>;
  const amount = applied ? applied.amountPaise / 100 : 499;
  return (
    <section className="billing-panel glass-panel">
      <div className="billing-heading">
        <div><div className="eyebrow">JAZZ RECOVERY PLAN</div><h2>Subscription & free trial</h2></div>
        <button className="secondary-button" type="button" onClick={() => void refresh().catch(error => setMessage(error.message))}>Refresh status</button>
      </div>
      <div className="billing-status-grid">
        <div><span>Current access</span><strong>{status.access === "trial" ? "7-day free trial" : status.access === "subscribed" ? "Annual subscription active" : "Trial/subscription required"}</strong></div>
        <div><span>Annual plan</span><strong>₹499 / year</strong></div>
        <div><span>Trial ends</span><strong>{status.trial?.expiresAt ? new Date(status.trial.expiresAt).toLocaleString() : "Not started"}</strong></div>
      </div>
      <div className="billing-checkout-row">
        <label className="billing-code-field"><span>Discount code (optional)</span><input value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setApplied(null); }} placeholder="Enter your code" autoComplete="off" /></label>
        <button className="secondary-button" type="button" disabled={busy || !code.trim()} onClick={() => void applyCode()}>Apply code</button>
      </div>
      <div className="billing-actions">
        <div><span className="billing-muted">Total payable</span><strong className="billing-price">₹{amount.toFixed(2)}</strong><span className="billing-muted">Gateway fees are not added to your price.</span></div>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void subscribe()}>{busy ? "Please wait…" : "Subscribe securely"}</button>
      </div>
      {message && <div className="billing-message" role="status">{message}</div>}
      <button className="auth-switch" type="button" onClick={() => setAdminOpen(value => !value)}>{adminOpen ? "Hide owner/admin tools" : "Owner/admin tools"}</button>
      {adminOpen && !isAdmin && <div className="billing-admin-box">
        <p>After the fresh reset, sign in to the intended owner account and claim billing administration with the one-time server bootstrap secret.</p>
        <label><span>One-time bootstrap secret</span><input type="password" value={bootstrapSecret} onChange={event => setBootstrapSecret(event.target.value)} autoComplete="off" /></label>
        <button className="secondary-button" type="button" disabled={busy || !bootstrapSecret} onClick={() => void claimAdmin()}>Claim admin access</button>
      </div>}
      {adminOpen && isAdmin && <div className="billing-admin-box">
        <h3>Discount code management</h3>
        <div className="billing-admin-form">
          <label><span>Code (leave blank to generate)</span><input value={newCode} onChange={event => setNewCode(event.target.value.toUpperCase())} placeholder="e.g. JAZZ-FAMILY" /></label>
          <label><span>Label</span><input value={label} onChange={event => setLabel(event.target.value)} /></label>
          <label><span>Discount</span><select value={percent} onChange={event => setPercent(event.target.value)}><option value="10">10%</option><option value="20">20%</option><option value="50">50%</option><option value="100">100% — complimentary</option></select></label>
          <label><span>Expiry (optional)</span><input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>
          <label><span>Maximum redemptions (optional)</span><input type="number" min="1" value={limit} onChange={event => setLimit(event.target.value)} placeholder="Unlimited" /></label>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void createCode()}>Create discount</button>
        </div>
        <div className="billing-code-list">{codes.map(item => <div className="billing-code-item" key={item.id}>
          <div><strong>{item.label}</strong><span>{item.percent_off}% · {item.active ? "Active" : "Disabled"} · {item.redeemed_count} redeemed{item.expires_at ? " · expires " + new Date(item.expires_at).toLocaleDateString() : " · no expiry"}</span></div>
          {item.active && <div className="billing-code-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void codeAction(item.id,"rotate")}>Rotate</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void codeAction(item.id,"disable")}>Disable</button></div>}
        </div>)}</div>
      </div>}
      <p className="billing-footnote">Payments use Razorpay Checkout. Access is granted only after verified server-side payment confirmation. Paid subscriptions renew manually; no automatic charging.</p>
    </section>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [msg, setMsg] = useState("");
  const [activeCount, setActiveCount] = useState(0);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState("");

  const actionLocks = useRef(new Set<string>());

  async function load() {
    const data = await api("/api/devices");
    const items: Device[] = data.items || [];
    setDevices(items);
    if (!selected && items.length) setSelected(items[0].id);
  }

  async function refresh(id = selected) {
    if (!id) return null;
    const data = await api(`/api/devices/${id}`);
    setDevice(data.device);
    return data.device as Device;
  }

  useEffect(() => {
    api("/api/auth/session")
      .then(() => setLogin(true))
      .catch(() => setLogin(false))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => { if (login) void load(); }, [login]);
  useEffect(() => { if (login && selected) void refresh(selected); }, [login, selected]);
  useEffect(() => {
    if (!login || !selected) return;
    const timer = window.setInterval(() => {
      void refresh(selected).catch(() => {});
      void load().catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [login, selected]);

  function isActionBusy(name: string, args: Record<string, unknown> = {}) {
    return actionLocks.current.has(actionKey(name, args));
  }

  async function action(name: string, args: Record<string, unknown> = {}) {
    if (!selected) return;
    const key = actionKey(name, args);
    if (actionLocks.current.has(key)) {
      setMsg("That recovery request is already in progress. Jazz will refresh the latest result automatically.");
      return;
    }

    const selectedAtStart = selected;
    const beforeLocation = String(device?.location?.timestamp ?? "");
    const beforePhoto = `${device?.photo?.camera ?? ""}:${String(device?.photo?.timestamp ?? "")}`;
    const beforeMode = device?.mode || "";

    actionLocks.current.add(key);
    setActiveCount(actionLocks.current.size);
    setMsg("Sending secure recovery request…");

    try {
      const data = await api(`/api/devices/${selectedAtStart}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: name, args }),
      });
      setMsg(data.deduplicated
        ? "A matching recovery request is already queued. Waiting for the latest result…"
        : "Recovery request sent. Waiting for the device…");

      const maxAttempts = name === "GET_LOCATION" || name === "RECOVERY_PHOTO" ? 36 : 10;
      for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 650));
        const latest = await refresh(selectedAtStart).catch(() => null);
        if (!latest) continue;
        if (attempts % 3 === 0) void load().catch(() => {});

        if (name === "GET_LOCATION") {
          const now = String(latest.location?.timestamp ?? "");
          if (now && now !== beforeLocation) {
            setMsg("Latest location received and map updated.");
            break;
          }
        } else if (name === "RECOVERY_PHOTO") {
          const wanted = args.camera === "rear" ? "rear" : "front";
          const now = `${latest.photo?.camera ?? ""}:${String(latest.photo?.timestamp ?? "")}`;
          if (latest.photo?.camera === wanted && now !== beforePhoto) {
            setMsg(`${wanted === "rear" ? "Back" : "Front"} camera recovery photo updated.`);
            break;
          }
        } else if (name === "SET_RECOVERY_MODE" && latest.mode !== beforeMode) {
          setMsg("Lost Mode state updated.");
          break;
        } else if (attempts === maxAttempts - 1) {
          setMsg("Recovery request sent. The page will continue refreshing automatically.");
        }
      }
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Action failed");
    } finally {
      actionLocks.current.delete(key);
      setActiveCount(actionLocks.current.size);
    }
  }

  async function locationControl(enabled: boolean) {
    if (!selected || locationBusy) return;
    const selectedAtStart = selected;
    const desired = enabled ? "ON" : "OFF";
    setLocationBusy(true);
    setLocationFeedback("Sending owner-authorized Location Services " + desired + " request…");
    try {
      const queued = await api(`/api/devices/${selectedAtStart}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: enabled ? "LOCATION_ENABLE" : "LOCATION_DISABLE" })
      });
      if (!queued.commandId) throw new Error("The Lost Mode server returned no command ID.");
      setLocationFeedback(queued.deduplicated
        ? "A matching request was already queued. Checking the phone's confirmed result…"
        : "Command queued. Awaiting confirmation from your paired Android Companion…");
      let completed = false;
      for (let attempt = 0; attempt < 75; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 1400));
        const data = await api(`/api/devices/${selectedAtStart}/commands/${encodeURIComponent(queued.commandId)}`);
        if (data.confirmed && data.status === "CONFIRMED" && data.result?.locationServices === desired) {
          setLocationFeedback("Device confirmed: Location Services " + desired + ".");
          await refresh(selectedAtStart);
          completed = true;
          break;
        }
        if (["FAILED", "EXPIRED"].includes(data.status)) {
          setLocationFeedback("Command " + data.status + ": " + (data.result?.error || data.result?.status || "The device did not confirm the requested state."));
          completed = true;
          break;
        }
        if (data.status === "DEVICE_OFFLINE" && attempt % 7 === 0) {
          setLocationFeedback("Device offline. Command is queued, not successful; it will expire if the phone cannot reconnect.");
        }
      }
      if (!completed) setLocationFeedback("No device confirmation yet. The command may still be pending; refresh the device status to check.");
    } catch (error) {
      setLocationFeedback(error instanceof Error ? error.message : "Location Services request failed.");
    } finally {
      setLocationBusy(false);
    }
  }

  async function logout() {
    setVoiceOpen(false);
    actionLocks.current.clear();
    setActiveCount(0);
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    setLogin(false);
    setDevices([]);
    setDevice(null);
  }

  async function shareLocation() {
    if (!device?.location) return;
    const url = googleMapsUrl(device.location);
    const text = `${device.deviceName || device.deviceId || "Jazz device"} last known location: ${device.location.latitude}, ${device.location.longitude}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Jazz Lost Mode Location", text, url });
        setMsg("Location shared.");
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setMsg("Location link copied to clipboard.");
      }
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") setMsg("Could not share location on this browser.");
    }
  }

  function downloadReport() {
    if (!device) return;
    const report = {
      exportedAt: new Date().toISOString(),
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
      online: device.online,
      mode: device.mode,
      battery: device.battery,
      charging: device.charging,
      network: device.network,
      lastSeen: device.lastSeen,
      lastKnownLocation: device.location,
      latestRecoveryPhoto: device.photo ? {
        camera: device.photo.camera,
        timestamp: device.photo.timestamp,
        includedSeparately: true,
      } : null,
    };
    downloadText(`jazz-recovery-${device.deviceId || device.id}.json`, JSON.stringify(report, null, 2));
    setMsg("Recovery report downloaded.");
  }

  const onlineCount = useMemo(() => devices.filter((item) => item.online).length, [devices]);

  if (!ready) return <div className="loading-screen"><RefreshCw className="spin" /> Loading secure recovery…</div>;
  if (!login) return <Login done={() => setLogin(true)} />;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar glass-panel">
        <div className="brand-block">
          <div className="brand-mark small-mark"><Sparkles size={20} /></div>
          <div><div className="eyebrow">JAZZ RECOVERY</div><h1>Lost Mode Command Center</h1></div>
        </div>
        <div className="topbar-actions">
          <div className="fleet-pill"><Radio size={16} /><span>{onlineCount}/{devices.length} online</span></div>
          <button className="ghost-button" onClick={() => { void load(); if (selected) void refresh(selected); }}><RefreshCw size={17} /> Refresh</button>
          <button className="ghost-button danger-hover" onClick={logout}><LogOut size={17} /> Logout</button>
        </div>
      </header>

      <BillingPanel />
      <div className="dashboard-layout">
        <aside className="device-sidebar glass-panel">
          <div className="sidebar-title"><div><span className="eyebrow">MY DEVICES</span><h2>Recovery Fleet</h2></div><span className="count-badge">{devices.length}</span></div>
          <div className="device-list">
            {devices.length === 0 && <div className="empty-state compact"><Smartphone size={24} /><span>No enrolled devices</span></div>}
            {devices.map((item) => (
              <button key={item.id} className={`device-row ${selected === item.id ? "selected" : ""}`} onClick={() => setSelected(item.id)}>
                <div className={`device-avatar ${item.online ? "live" : ""}`}><Smartphone size={21} /></div>
                <div className="device-row-copy"><strong>{item.deviceName || item.deviceId || "Device"}</strong><span>{item.deviceId || item.deviceType}</span><small className={item.online ? "online-text" : "offline-text"}>{item.online ? "● Online" : "● Offline"}</small></div>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
          <div className="sidebar-security"><ShieldCheck size={18} /><div><strong>Secure recovery</strong><span>Encrypted owner-authorized channel</span></div></div>
        </aside>

        <main className="dashboard-main">
          {!device ? <section className="glass-panel empty-state"><Smartphone size={36} /><h2>Select a device</h2><p>Choose an enrolled device to open recovery controls.</p></section> : <>
            <section className="device-hero glass-panel">
              <div className="hero-main">
                <div className={`status-orb ${device.online ? "live" : "offline-orb"}`}><CircleDot size={25} /></div>
                <div>
                  <div className={`status-label ${device.online ? "online-text" : "offline-text"}`}>{device.online ? "ONLINE • LIVE CONNECTION" : "OFFLINE • LAST KNOWN STATE"}</div>
                  <h2>{device.deviceName || device.deviceId || "Registered device"}</h2>
                  <div className="device-id-line">{device.deviceId || "Registered device"} · {device.deviceType}</div>
                </div>
              </div>
              <div className="mode-badge"><ShieldCheck size={17} /> {device.mode}</div>
              <div className="metrics-grid">
                <div className="metric-card"><BatteryCharging size={20} /><div><span>Battery</span><strong>{device.battery ?? "--"}%</strong></div></div>
                <div className="metric-card"><Wifi size={20} /><div><span>Network</span><strong>{device.network || "Unknown"}</strong></div></div>
                <div className="metric-card"><Gauge size={20} /><div><span>Last Seen</span><strong>{formatTime(device.lastSeen)}</strong></div></div>
              </div>
            </section>

            <section className="section-heading"><div><span className="eyebrow">RECOVERY ACTIONS</span><h2>Remote controls</h2></div><span>Commands use the existing allowlisted recovery workflow.</span></section>
            <section className="action-grid">
              <button disabled={isActionBusy("DEVICE_STATUS")} onClick={() => action("DEVICE_STATUS")}><Smartphone /><div><strong>Device Status</strong><span>Refresh device health</span></div></button>
              <button disabled={isActionBusy("GET_LOCATION")} onClick={() => action("GET_LOCATION")}><LocateFixed /><div><strong>Get Location</strong><span>{isActionBusy("GET_LOCATION") ? "Request in progress…" : "Request latest position"}</span></div></button>
              <button disabled={isActionBusy("RING_DEVICE")} onClick={() => action("RING_DEVICE")}><Volume2 /><div><strong>Ring Device</strong><span>Play recovery alert</span></div></button>
              <button disabled={isActionBusy("RECOVERY_PHOTO", { camera: "front" })} onClick={() => action("RECOVERY_PHOTO", { camera: "front" })}><Camera /><div><strong>Front Camera</strong><span>{isActionBusy("RECOVERY_PHOTO", { camera: "front" }) ? "Capturing…" : "Request recovery photo"}</span></div></button>
              <button disabled={isActionBusy("RECOVERY_PHOTO", { camera: "rear" })} onClick={() => action("RECOVERY_PHOTO", { camera: "rear" })}><Camera /><div><strong>Back Camera</strong><span>{isActionBusy("RECOVERY_PHOTO", { camera: "rear" }) ? "Capturing…" : "Request recovery photo"}</span></div></button>
              <button className="critical-action" disabled={isActionBusy("SET_RECOVERY_MODE", { enabled: true })} onClick={() => action("SET_RECOVERY_MODE", { enabled: true })}><ShieldCheck /><div><strong>Enable Lost Mode</strong><span>Secure recovery state</span></div></button>
              <button className="voice-toggle" aria-expanded={voiceOpen} aria-controls="recovery-voice-panel" onClick={() => setVoiceOpen(open => !open)}><Mic /><div><strong>Voice Input</strong><span>Remote recovery voice broadcast</span></div></button>
            </section>

            <section className="glass-panel" aria-label="Device Location Services" style={{ padding: 22, marginTop: 20 }}>
              <div className="card-heading">
                <div><span className="eyebrow">DEVICE SYSTEM SETTINGS</span><h2>Location Services</h2></div>
                <MapPin size={22} />
              </div>
              <div className="location-meta">
                <div>
                  <span>Current status</span>
                  <strong>{!device.online ? "Device Offline" : device.locationServices || "Unknown"}</strong>
                </div>
                <div>
                  <span>Last device-confirmed status</span>
                  <strong>{formatTime(device.locationServicesLastConfirmed)}</strong>
                </div>
              </div>
              <p style={{ opacity: 0.75, margin: "12px 0" }}>
                Reported by the enrolled Android Companion during its last authenticated heartbeat.
                Global Location Services status is different from Jazz's own location permission.
              </p>
              <div className="card-actions">
                <button className="primary-button" disabled={locationBusy}
                  onClick={() => void locationControl(true)}>
                  <MapPin size={17} /> Turn ON Location
                </button>
                <button className="secondary-button" disabled={locationBusy}
                  onClick={() => void locationControl(false)}>
                  <MapPin size={17} /> Turn OFF Location
                </button>
                <button className="secondary-button" disabled={locationBusy || isActionBusy("DEVICE_STATUS") || !device.online}
                  onClick={() => action("DEVICE_STATUS")}>
                  <RefreshCw size={17} /> Refresh Status
                </button>
              </div>
              {locationFeedback && <div role="status" aria-live="polite" className="command-banner" style={{ marginTop: 12 }}>
                {locationBusy && <RefreshCw size={16} className="spin" />}
                <span>{locationFeedback}</span>
              </div>}
              <p style={{ opacity: 0.7, fontSize: 12 }}>
                Remote ON/OFF requires local owner opt-in and Android Enterprise device-owner privileges.
                Queued commands do not mean that Location Services changed.
              </p>
            </section>

            {voiceOpen && <VoiceInput
              key={selected}
              deviceName={devices.find(item => item.id === selected)?.deviceName || "Selected device"}
              disabled={activeCount > 0 || device.id !== selected}
              onAction={action}
              onClose={() => setVoiceOpen(false)}
            />}

            {(msg || activeCount > 0) && <div className="command-banner glass-panel"><div className="pulse-dot" /><span>{msg || "Processing…"}</span>{activeCount > 0 && <RefreshCw className="spin" size={16} />}</div>}

            <section className="recovery-grid">
              <article className="location-card glass-panel">
                <div className="card-heading">
                  <div><span className="eyebrow">LAST KNOWN LOCATION</span><h2>Device map</h2></div>
                  <MapPin size={22} />
                </div>
                {device.location ? <>
                  <div className="map-frame">
                    <iframe
                      title="Last known device location"
                      src={mapEmbedUrl(device.location)}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts allow-same-origin"
                    />
                    <div className="map-overlay"><Navigation size={15} /> Last known position</div>
                  </div>
                  <div className="location-meta">
                    <div><span>Coordinates</span><strong>{device.location.latitude.toFixed(6)}, {device.location.longitude.toFixed(6)}</strong></div>
                    <div><span>Accuracy</span><strong>{device.location.accuracyMeters ?? "--"} m</strong></div>
                    <div><span>Location time</span><strong>{formatTime(device.location.timestamp)}</strong></div>
                  </div>
                  <div className="card-actions">
                    <a className="primary-button" target="_blank" rel="noreferrer" href={googleMapsUrl(device.location)}><ExternalLink size={17} /> Open in Maps</a>
                    <button className="secondary-button" onClick={shareLocation}><Navigation size={17} /> Share Location</button>
                    <button className="secondary-button" onClick={downloadReport}><Download size={17} /> Download Report</button>
                  </div>
                </> : <div className="empty-state"><Crosshair size={30} /><h3>No location yet</h3><p>Use Get Location to request the latest available position.</p></div>}
              </article>

              <article className="photo-card glass-panel">
                <div className="card-heading">
                  <div><span className="eyebrow">RECOVERY EVIDENCE</span><h2>Latest recovery photo</h2></div>
                  <Camera size={22} />
                </div>
                {device.photo ? <>
                  <div className="photo-frame"><img src={device.photo.dataUrl} alt="Latest recovery" /></div>
                  <div className="photo-meta"><span>{device.photo.camera || "camera"} camera</span><span>{formatTime(device.photo.timestamp)}</span></div>
                  <div className="card-actions">
                    <a className="primary-button" href={device.photo.dataUrl} download={`jazz-recovery-${device.photo.camera || "photo"}.jpg`}><Download size={17} /> Download Recovery Photo</a>
                    <button className="secondary-button" onClick={downloadReport}><Download size={17} /> Download Recovery Report</button>
                  </div>
                </> : <div className="empty-state photo-empty"><Camera size={32} /><h3>No recovery photo yet</h3><p>Request the front or back camera using the recovery controls above.</p></div>}
              </article>
            </section>
          </>}
        </main>
      </div><footer className="site-footer">
        <span className="footer-brand">Jazz Device Recovery</span>

        <span className="developer-credit">
          Developed by <span className="developer-name">😈 gunakarna 😈</span>
        </span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
