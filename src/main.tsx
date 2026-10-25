import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BatteryCharging,
  Camera,
  Copy,
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
  Navigation,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Volume2,
  Wifi,
} from "lucide-react";
import "./styles.css";
import "./responsive-fixes.css";
import { BillingPanel } from "./billing-ui";

type LocationState = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  timestamp?: number | string | null;
};

type PhotoState = {
  dataUrl?: string;
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
  imei?: string | null;
};

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

// Local Vite development must use the same-origin /api proxy, just like billing-ui.tsx.
// Hosted builds continue to use VITE_API_BASE_URL.
const API_BASE_URL = import.meta.env.DEV ? "" : apiBaseUrl();

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

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function serializeCredential(credential: PublicKeyCredential) {
  const response = credential.response;
  const base = { id: credential.id, rawId: bytesToBase64Url(credential.rawId), type: credential.type };
  if (response instanceof AuthenticatorAttestationResponse) {
    return { ...base, response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      attestationObject: bytesToBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : []
    } };
  }
  const assertion = response as AuthenticatorAssertionResponse;
  return { ...base, response: {
    clientDataJSON: bytesToBase64Url(assertion.clientDataJSON),
    authenticatorData: bytesToBase64Url(assertion.authenticatorData),
    signature: bytesToBase64Url(assertion.signature),
    userHandle: assertion.userHandle ? bytesToBase64Url(assertion.userHandle) : null
  } };
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
  const bbox = [lon - spread, lat - spread, lon + spread, lat + spread].join(
    ",",
  );
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
  if (name === "RECOVERY_PHOTO")
    return `${name}:${args.camera === "rear" ? "rear" : "front"}`;
  return name;
}

function Login({ done }: { done: (registration?: { trialActivated: boolean }) => void }) {
  const [registering, setRegistering] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [useRecoveryPin, setUseRecoveryPin] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    const form = event.currentTarget;
    const fields = new FormData(form);
    let trialActivated = false;
    const username = String(fields.get("username") || "").trim();
    let password = String(fields.get("password") || "");
    try {
      setNotice("");
      if (forgotPassword) {
        const recoveryPin = String(fields.get("recoveryPin") || "");
        const newPassword = String(fields.get("newPassword") || "");
        const confirmNewPassword = String(fields.get("confirmNewPassword") || "");
        if (!username) throw new Error("Enter your username.");
        if (newPassword !== confirmNewPassword) throw new Error("The new passwords do not match.");
        if (useRecoveryPin) {
          if (!/^\d{4}$/.test(recoveryPin)) throw new Error("Enter your 4-digit recovery PIN.");
          await api("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ username, recoveryPin, newPassword }) });
        } else {
          if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("This browser does not support passkeys. Use your recovery PIN instead.");
          const challenge = await api("/api/auth/password-reset/passkey/options", { method: "POST", body: JSON.stringify({ username }) });
          if (!challenge.available || !challenge.options || !challenge.flowId) throw new Error(challenge.message || "No registered passkey is available. Use your recovery PIN instead.");
          const options = challenge.options;
          const credential = await navigator.credentials.get({ publicKey: {
            ...options,
            challenge: base64UrlToBytes(options.challenge),
            allowCredentials: (options.allowCredentials || []).map((item: { id: string; transports?: AuthenticatorTransport[]; type?: PublicKeyCredentialType }) => ({ ...item, id: base64UrlToBytes(item.id) }))
          } as PublicKeyCredentialRequestOptions }) as PublicKeyCredential | null;
          if (!credential) throw new Error("Passkey verification was cancelled.");
          await api("/api/auth/password-reset/passkey/verify", { method: "POST", body: JSON.stringify({ flowId: challenge.flowId, response: serializeCredential(credential), newPassword }) });
        }
        form.reset();
        setForgotPassword(false);
        setUseRecoveryPin(false);
        setRegistering(false);
        setNotice("Password reset successful. Sign in with your new password.");
        return;
      }
      if (!username || !password) throw new Error("Enter your username and password.");
      if (registering) {
        const confirmPassword = String(fields.get("confirmPassword") || "");
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const deviceName = String(fields.get("deviceName") || "").trim();
        const imei = String(fields.get("imei") || "").trim();
        const deviceId = String(fields.get("deviceId") || "").trim();
        const deviceToken = String(fields.get("deviceToken") || "").trim();
        const recoveryPin = String(fields.get("recoveryPin") || "");
        const confirmRecoveryPin = String(fields.get("confirmRecoveryPin") || "");
        if (!/^\d{4}$/.test(recoveryPin) || recoveryPin !== confirmRecoveryPin) throw new Error("Enter and confirm the same 4-digit recovery PIN.");
        if (!deviceName || !imei || !deviceId || !deviceToken) {
          throw new Error("Enter the device details and copy the device ID and token from the Jazz Recovery app.");
        }
        const body = JSON.stringify({ username, password, confirmPassword, deviceName, imei, deviceId, deviceToken, recoveryPin, confirmRecoveryPin });
        password = "";
        if (passwordRef.current) passwordRef.current.value = "";
        const registration = await api("/api/auth/register", { method: "POST", body });
        trialActivated = Boolean(registration.trialActivated);
      } else {
        const body = JSON.stringify({ username, password });
        password = "";
        if (passwordRef.current) passwordRef.current.value = "";
        await api("/api/auth/login", { method: "POST", body });
      }
      form.reset();
      done(registering ? { trialActivated } : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : (registering ? "Registration failed" : "Login failed"));
    } finally {
      password = "";
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="auth-card glass-panel">
        <div className="brand-logo">
          <img
            src="https://raw.githubusercontent.com/karnameena/jazz-recovery/refs/heads/feature/neon-web-compat-20261012/src/Logo-jazz.png"
            alt="Jazz Logo"
            width={95}
            height={95}
          />
        </div>
        <div className="eyebrow">JAZZ SECURE RECOVERY</div>
        <h1>{forgotPassword ? "Reset your password" : registering ? "Create your account" : "Lost Mode"}</h1>
        <p className="auth-subtitle">
          {forgotPassword ? (useRecoveryPin ? "Verify your username and recovery PIN to set a new password." : "Verify with your registered passkey to set a new password.") : registering ? "Register your owner account and pair this Android device." : "Secure access to your registered recovery devices."}
        </p>
        <form onSubmit={submit} className="auth-form" autoComplete="on">
          <label><span>Username</span><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Enter username" minLength={3} maxLength={64} required /></label>
          {!forgotPassword && <label><span>Password</span><input ref={passwordRef} name="password" autoComplete={registering ? "new-password" : "current-password"} type="password" placeholder={registering ? "At least 12 characters, upper/lowercase and a number" : "Enter password"} minLength={registering ? 12 : undefined} required /></label>}
          {forgotPassword && <>
            {useRecoveryPin && <label><span>4-digit recovery PIN</span><input name="recoveryPin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" placeholder="Enter your recovery PIN" required /></label>}
            <label><span>New password</span><input name="newPassword" type="password" autoComplete="new-password" minLength={12} placeholder="At least 12 characters" required /></label>
            <label><span>Confirm new password</span><input name="confirmNewPassword" type="password" autoComplete="new-password" minLength={12} placeholder="Re-enter new password" required /></label>
          </>}
          {!forgotPassword && registering && <>
            <label><span>Confirm password</span><input name="confirmPassword" autoComplete="new-password" type="password" placeholder="Re-enter password" minLength={12} required /></label>
            <label><span>4-digit recovery PIN</span><input name="recoveryPin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" placeholder="Create a 4-digit PIN" required /></label>
            <label><span>Confirm recovery PIN</span><input name="confirmRecoveryPin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" placeholder="Re-enter the PIN" required /></label>
            <div className="eyebrow" style={{ marginTop: 8 }}>DEVICE ENROLLMENT</div>
            <label><span>Device name</span><input name="deviceName" autoComplete="off" placeholder="e.g. My OnePlus" maxLength={80} required /></label>
            <label><span>IMEI</span><input name="imei" inputMode="numeric" autoComplete="off" placeholder="14–16 digit IMEI" maxLength={20} required /></label>
            <label><span>Device ID from app</span><input name="deviceId" autoComplete="off" placeholder="Copy device ID from Jazz Recovery" required /></label>
            <label><span>Device token from app</span><input name="deviceToken" autoComplete="off" type="password" placeholder="Paste generated device token" required /></label>
            <p className="auth-subtitle">The server stores only a hash of the device token. Keep the token private.</p>
          </>}
          {error && <div className="error-banner" role="alert">{error}</div>}
          {notice && <div role="status" style={{ padding: 12, borderRadius: 10, background: "rgba(16,185,129,.12)", color: "#047857" }}>{notice}</div>}
          <button className="primary-button full-width" type="submit" disabled={submitting}>
            {submitting ? <RefreshCw className="spin" size={18} /> : <LockKeyhole size={18} />}
            {submitting ? "Please wait…" : forgotPassword ? (useRecoveryPin ? "Verify PIN and reset password" : "Verify passkey and reset password") : registering ? "Register and pair device" : "Enter Lost Mode"}
          </button>
        </form>
        {!forgotPassword && !registering && <button className="ghost-button full-width" style={{ marginTop: 12, justifyContent: "center" }} type="button" onClick={() => { setForgotPassword(true); setUseRecoveryPin(false); setError(""); setNotice(""); }}>Forgot password?</button>}
        {forgotPassword && <button className="ghost-button full-width" style={{ marginTop: 12, justifyContent: "center" }} type="button" onClick={() => { setUseRecoveryPin(value => !value); setError(""); setNotice(""); }}>{useRecoveryPin ? "Use passkey instead" : "Use recovery PIN instead"}</button>}
        {forgotPassword && <button className="ghost-button full-width" style={{ marginTop: 12, justifyContent: "center" }} type="button" onClick={() => { setForgotPassword(false); setUseRecoveryPin(false); setError(""); setNotice(""); }}>Back to sign in</button>}
        {!forgotPassword && <button className="ghost-button full-width" style={{ marginTop: 12, justifyContent: "center" }} type="button" onClick={() => { setRegistering(value => !value); setError(""); setNotice(""); }}> 
          {registering ? "Already registered? Sign in" : "New here? Register a device"}
        </button>}
        <div className="secure-note"><ShieldCheck size={16} /> Owner-only authenticated recovery portal</div>
      </section>
      <footer className="site-footer">
        <span className="footer-brand">Jazz Device Recovery</span>
        <span className="developer-credit">Developed by <span className="developer-name">😈 gunakarna 😈</span></span>
      </footer>
    </main>
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
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingAccess, setBillingAccess] = useState<"loading" | "trial" | "subscribed" | "expired" | "error">("loading");
  const [isBillingAdmin, setIsBillingAdmin] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<{ deviceId: number; url: string } | null>(null);
  const [photoLoadError, setPhotoLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [imeiVisible, setImeiVisible] = useState(false);
  const [imeiCopyMessage, setImeiCopyMessage] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState("");

  const actionLocks = useRef(new Set<string>());

  async function registerPasskey() {
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("This browser does not support passkeys.");
      const challenge = await api("/api/auth/passkey/register/options", { method: "POST", body: JSON.stringify({}) });
      const options = challenge.options;
      const credential = await navigator.credentials.create({ publicKey: {
        ...options,
        challenge: base64UrlToBytes(options.challenge),
        user: { ...options.user, id: base64UrlToBytes(options.user.id) },
        excludeCredentials: (options.excludeCredentials || []).map((item: { id: string; transports?: AuthenticatorTransport[]; type?: PublicKeyCredentialType }) => ({ ...item, id: base64UrlToBytes(item.id) }))
      } as PublicKeyCredentialCreationOptions }) as PublicKeyCredential | null;
      if (!credential) throw new Error("Passkey registration was cancelled.");
      await api("/api/auth/passkey/register/verify", { method: "POST", body: JSON.stringify({ flowId: challenge.flowId, response: serializeCredential(credential) }) });
      setMsg("Passkey registered successfully. You can use it to reset your password.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not register passkey.");
    }
  }

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

  useEffect(() => {
    if (login && (billingAccess === "trial" || billingAccess === "subscribed" || isBillingAdmin)) void load().catch(() => {});
  }, [login, billingAccess, isBillingAdmin]);

  useEffect(() => {
    if (!login) { setBillingAccess("loading"); return; }
    let cancelled = false;
    setBillingAccess("loading");
    api("/api/billing/status").then((status) => {
      if (cancelled) return;
      setIsBillingAdmin(status.isBillingAdmin === true);
      if (status.access === "trial" || status.access === "subscribed" || status.access === "expired") {
        setBillingAccess(status.access);
      } else {
        setBillingAccess("error");
      }
      if (status.access === "expired") {
        if (status.isBillingAdmin === true) {
          // The owner bypasses the subscription paywall and lands on owner controls.
          setBillingOpen(true);
        } else {
          setBillingOpen(false);
          setToast("Your 7-day trial or subscription has expired. Choose a plan to continue.");
        }
      }
    }).catch(() => { if (!cancelled) setBillingAccess("error"); });
    return () => { cancelled = true; };
  }, [login]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (login && (billingAccess === "trial" || billingAccess === "subscribed" || isBillingAdmin) && selected) void refresh(selected).catch(() => {});
  }, [login, billingAccess, selected, isBillingAdmin]);
  useEffect(() => {
    if (!login || ((billingAccess !== "trial" && billingAccess !== "subscribed") && !isBillingAdmin)) return;
    const timer = window.setInterval(() => {
      if (selected) {
        void refresh(selected).catch(() => {});
        void load().catch(() => {});
      }
      // Billing expiry is checked independently of device selection, so access
      // still closes on time even when an account has no currently selected device.
      void api("/api/billing/status").then(status => {
        if (status.access === "expired") {
          if (status.isBillingAdmin !== true) setBillingOpen(false);
          setBillingAccess("expired");
        } else if (status.access === "trial" || status.access === "subscribed") {
          setBillingAccess(status.access);
        }
      }).catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [login, billingAccess, selected, isBillingAdmin]);

  function isActionBusy(name: string, args: Record<string, unknown> = {}) {
    return actionLocks.current.has(actionKey(name, args));
  }

  async function action(name: string, args: Record<string, unknown> = {}) {
    if (!selected) return;
    const key = actionKey(name, args);
    if (actionLocks.current.has(key)) {
      setMsg(
        "That recovery request is already in progress. Jazz will refresh the latest result automatically.",
      );
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
      setMsg(
        data.deduplicated
          ? "A matching recovery request is already queued. Waiting for the latest result…"
          : "Recovery request sent. Waiting for the device…",
      );

      const isPhotoRequest = name === "RECOVERY_PHOTO";
      const maxAttempts =
        name === "GET_LOCATION" || isPhotoRequest ? 30 : 10;
      let completed = false;
      for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
        // Fast initial checks make completed captures appear quickly; a small
        // backoff then avoids hammering PostgreSQL while Android is capturing.
        const delayMs = isPhotoRequest
          ? Math.min(1000, 350 + attempts * 75)
          : name === "GET_LOCATION" ? 650 : 650;
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        const latest = await refresh(selectedAtStart).catch(() => null);
        if (!latest) continue;

        // The server exposes the command's real completion result. This avoids
        // leaving the user waiting through every poll when camera capture or
        // private-storage upload has already failed.
        if (isPhotoRequest && data.commandId) {
          const commandStatus = await api(
            `/api/devices/${selectedAtStart}/commands/${data.commandId}`,
          ).catch(() => null);
          if (commandStatus?.status === "FAILED" || commandStatus?.status === "EXPIRED") {
            const reason = String(commandStatus?.result?.error || "");
            setMsg(reason
              ? `Photo request failed: ${reason}. The previous saved photo was not replaced.`
              : "Photo request failed before a new photo was saved. The previous saved photo was not replaced.");
            completed = true;
            break;
          }
          if (commandStatus?.status === "COMPLETED") {
            const wanted = args.camera === "rear" ? "rear" : "front";
            const now = `${latest.photo?.camera ?? ""}:${String(latest.photo?.timestamp ?? "")}`;
            if (latest.photo?.camera === wanted && now !== beforePhoto) {
              setMsg(`${wanted === "rear" ? "Back" : "Front"} camera photo saved. Updating preview…`);
              completed = true;
              break;
            }
          }
        }

        if (name === "GET_LOCATION") {
          const now = String(latest.location?.timestamp ?? "");
          if (now && now !== beforeLocation) {
            setMsg("Latest location received and map updated.");
            completed = true;
            break;
          }
        } else if (isPhotoRequest) {
          const wanted = args.camera === "rear" ? "rear" : "front";
          const now = `${latest.photo?.camera ?? ""}:${String(latest.photo?.timestamp ?? "")}`;
          if (latest.photo?.camera === wanted && now !== beforePhoto) {
            setMsg(
              `${wanted === "rear" ? "Back" : "Front"} camera photo saved. Updating preview…`,
            );
            // Force the current-photo read after the server confirms a newer
            // photo record, rather than waiting for the next periodic refresh.
            await refresh(selectedAtStart).catch(() => null);
            completed = true;
            break;
          }
        } else if (name === "SET_RECOVERY_MODE" && latest.mode !== beforeMode) {
          setMsg("Lost Mode state updated.");
          completed = true;
          break;
        }
      }
      if (!completed) {
        setMsg(isPhotoRequest
          ? "No new photo was confirmed within the wait window. Check that the phone is online and Jazz Recovery has camera permission, then retry. The previous saved photo has not been replaced."
          : name === "GET_LOCATION"
            ? "No new location was confirmed yet. The page will keep showing the latest saved location."
            : "Recovery request is still pending. Check the phone connection and try again."); 
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
    setLocationFeedback(
      "Sending owner-authorized Location Services " + desired + " request…",
    );
    try {
      const queued = await api(`/api/devices/${selectedAtStart}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: enabled ? "LOCATION_ENABLE" : "LOCATION_DISABLE",
        }),
      });
      if (!queued.commandId)
        throw new Error("The Lost Mode server returned no command ID.");
      setLocationFeedback(
        queued.deduplicated
          ? "A matching request was already queued. Checking the phone's confirmed result…"
          : "Command queued. Awaiting confirmation from your paired Android Companion…",
      );
      let completed = false;
      for (let attempt = 0; attempt < 75; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        const data = await api(
          `/api/devices/${selectedAtStart}/commands/${encodeURIComponent(queued.commandId)}`,
        );
        if (
          data.confirmed &&
          data.status === "CONFIRMED" &&
          data.result?.locationServices === desired
        ) {
          setLocationFeedback(
            "Device confirmed: Location Services " + desired + ".",
          );
          await refresh(selectedAtStart);
          completed = true;
          break;
        }
        if (["FAILED", "EXPIRED"].includes(data.status)) {
          setLocationFeedback(
            "Command " +
              data.status +
              ": " +
              (data.result?.error ||
                data.result?.status ||
                "The device did not confirm the requested state."),
          );
          completed = true;
          break;
        }
        if (data.status === "DEVICE_OFFLINE" && attempt % 7 === 0) {
          setLocationFeedback(
            "Device offline. Command is queued, not successful; it will expire if the phone cannot reconnect.",
          );
        }
      }
      if (!completed)
        setLocationFeedback(
          "No device confirmation yet. The command may still be pending; refresh the device status to check.",
        );
    } catch (error) {
      setLocationFeedback(
        error instanceof Error
          ? error.message
          : "Location Services request failed.",
      );
    } finally {
      setLocationBusy(false);
    }
  }

  async function logout() {
    actionLocks.current.clear();
    setActiveCount(0);
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(
      () => {},
    );
    setLogin(false);
    setBillingAccess("loading");
    setBillingOpen(false);
    setDevices([]);
    setDevice(null);
  }

  async function setupRecoveryPin() {
    const password = window.prompt("Confirm your current Jazz Recovery password:");
    if (password == null || !password) return;
    const recoveryPin = window.prompt("Create a 4-digit recovery PIN:");
    if (recoveryPin == null) return;
    const confirmRecoveryPin = window.prompt("Re-enter your 4-digit recovery PIN:");
    if (confirmRecoveryPin == null) return;
    try {
      await api("/api/auth/recovery-pin", {
        method: "POST",
        body: JSON.stringify({ password, recoveryPin, confirmRecoveryPin }),
      });
      setMsg("Recovery PIN saved securely. You can use it if you forget your password.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not save recovery PIN.");
    }
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
      if ((error as DOMException)?.name !== "AbortError")
        setMsg("Could not share location on this browser.");
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
      latestRecoveryPhoto: device.photo
        ? {
            camera: device.photo.camera,
            timestamp: device.photo.timestamp,
            includedSeparately: true,
          }
        : null,
    };
    downloadText(
      `jazz-recovery-${device.deviceId || device.id}.json`,
      JSON.stringify(report, null, 2),
    );
    setMsg("Recovery report downloaded.");
  }

  useEffect(() => {
    const current = device;
    if (!current?.photo) {
      setPhotoLoadError("");
      setPhotoUrl((previous) => {
        if (previous?.url.startsWith("blob:")) URL.revokeObjectURL(previous.url);
        return null;
      });
      return;
    }
    if (current.photo.dataUrl) {
      setPhotoLoadError("");
      setPhotoUrl((previous) => {
        if (previous?.url.startsWith("blob:") && previous.url !== current.photo?.dataUrl) URL.revokeObjectURL(previous.url);
        return { deviceId: current.id, url: current.photo.dataUrl };
      });
      return;
    }
    let cancelled = false;
    setPhotoLoadError("");
    fetch(`${API_BASE_URL}/api/devices/${current.id}/photo-content`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const contentType = String(response.headers.get("content-type") || "").toLowerCase();
          const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : {};
          if (response.status === 401) {
            throw new Error("Your Jazz Recovery session is not valid. Sign in again, then reopen this device.");
          }
          throw new Error(data.error || `The saved recovery photo could not be loaded (HTTP ${response.status}). The existing photo record has not been deleted.`);
        }
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("The server returned an unexpected response instead of a recovery photo.");
        const url = URL.createObjectURL(blob);
        if (cancelled) { URL.revokeObjectURL(url); return; }
        setPhotoUrl((previous) => {
          if (previous?.url.startsWith("blob:")) URL.revokeObjectURL(previous.url);
          return { deviceId: current.id, url };
        });
      })
      .catch((error) => {
        if (!cancelled) setPhotoLoadError(error instanceof Error
          ? error.message
          : "The saved recovery photo could not be loaded. The existing photo record has not been deleted.");
      });
    return () => { cancelled = true; };
  }, [device?.id, device?.photo?.timestamp, device?.photo?.camera, device?.photo?.dataUrl]);

  const onlineCount = useMemo(
    () => devices.filter((item) => item.online).length,
    [devices],
  );
  const currentPhotoSrc = device?.photo?.dataUrl || (device && photoUrl?.deviceId === device.id ? photoUrl.url : "");

  if (!ready)
    return (
      <div className="loading-screen">
        <RefreshCw className="spin" /> Loading secure recovery…
      </div>
    );
  if (!login) return <Login done={(registration) => {
    setLogin(true);
    if (registration?.trialActivated) setToast("Your 7-day free trial is now active.");
    else if (registration) setToast("Your Jazz Recovery account was created successfully.");
  }} />;
  if (billingAccess === "loading") return <div className="loading-screen"><RefreshCw className="spin" /> Verifying subscription access…</div>;
  if (billingAccess === "error") return <main className="auth-shell"><section className="auth-card glass-panel"><div className="eyebrow">JAZZ SECURE RECOVERY</div><h1>Could not verify account access</h1><p className="auth-subtitle">The server did not return your current trial or subscription status. The dashboard is hidden until access can be verified. Check the backend and try again.</p><button className="primary-button full-width" onClick={() => window.location.reload()}>Retry access check</button><button className="secondary-button full-width" onClick={() => void logout()}>Logout</button></section></main>;
  if (billingAccess === "expired" && !isBillingAdmin) return <main className="auth-shell"><section className="auth-card glass-panel subscription-gate"><div className="brand-logo"><img src="https://raw.githubusercontent.com/karnameena/jazz-recovery/refs/heads/feature/neon-web-compat-20261012/src/Logo-jazz.png" alt="Jazz Logo" width={95} height={95} /></div><div className="eyebrow">JAZZ RECOVERY ACCESS</div><h1>Choose a subscription plan</h1><p className="auth-subtitle">Your free trial or previous subscription has ended. Subscribe to restore dashboard access. Your registered devices and saved recovery evidence remain stored.</p><BillingPanel onAccessChange={(access) => setBillingAccess(access)} /><button className="secondary-button full-width" onClick={() => void logout()}>Logout</button></section></main>;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      {toast && <div className="toast-notice" role="status" aria-live="polite">{toast}</div>}

      <header className="topbar glass-panel">
        <div className="brand-block">
          <div className="brand-logo">
            <img
              src="https://raw.githubusercontent.com/karnameena/jazz-recovery/refs/heads/feature/neon-web-compat-20261012/src/Logo-jazz.png"
              alt="Jazz Logo"
              width={95}
              height={95}
            />
          </div>
          <div>
            <div className="eyebrow">JAZZ RECOVERY</div>
            <h1>Lost Mode Command Center</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="fleet-pill">
            <Radio size={16} />
            <span>
              {onlineCount}/{devices.length} online
            </span>
          </div>
          <button
            className="ghost-button"
            onClick={() => {
              void load();
              if (selected) void refresh(selected);
            }}
          >
            <RefreshCw size={17} /> Refresh
          </button>
          <button className="ghost-button" onClick={() => void registerPasskey()}>
            <LockKeyhole size={17} /> Register passkey
          </button>
          <button className="ghost-button" onClick={() => void setupRecoveryPin()}>
            <LockKeyhole size={17} /> Set recovery PIN
          </button>
          {isBillingAdmin && <button className="ghost-button" onClick={() => setBillingOpen((open) => !open)}>{billingOpen ? "Hide owner controls" : "Owner admin"}</button>}
          <button className="ghost-button danger-hover" onClick={logout}>
            <LogOut size={17} /> Logout
          </button>
        </div>
      </header>

      {billingOpen && (billingAccess !== "expired" || isBillingAdmin) && <div className="billing-panel-wrap"><BillingPanel onAccessChange={(access) => setBillingAccess(access)} /></div>}

      <div className="dashboard-layout">
        <aside className="device-sidebar glass-panel">
          <div className="sidebar-title">
            <div>
              <span className="eyebrow">MY DEVICES</span>
              <h2>Recovery Fleet</h2>
            </div>
            <span className="count-badge">{devices.length}</span>
          </div>
          <div className="device-list">
            {devices.length === 0 && (
              <div className="empty-state compact">
                <Smartphone size={24} />
                <span>No enrolled devices</span>
              </div>
            )}
            {devices.map((item) => (
              <button
                key={item.id}
                className={`device-row ${selected === item.id ? "selected" : ""}`}
                onClick={() => { setSelected(item.id); setImeiVisible(false); setImeiCopyMessage(""); }}
              >
                <div className={`device-avatar ${item.online ? "live" : ""}`}>
                  <Smartphone size={21} />
                </div>
                <div className="device-row-copy">
                  <strong>
                    {item.deviceName || item.deviceId || "Device"}
                  </strong>
                  <span>{item.deviceId || item.deviceType}</span>
                  <small
                    className={item.online ? "online-text" : "offline-text"}
                  >
                    {item.online ? "● Online" : "● Offline"}
                  </small>
                </div>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
          <div className="sidebar-security">
            <ShieldCheck size={18} />
            <div>
              <strong>Secure recovery</strong>
              <span>Encrypted owner-authorized channel</span>
            </div>
          </div>
        </aside>

        <main className="dashboard-main">
          {!device ? (
            <section className="glass-panel empty-state">
              <Smartphone size={36} />
              <h2>Select a device</h2>
              <p>Choose an enrolled device to open recovery controls.</p>
            </section>
          ) : (
            <>
              <section className="device-hero glass-panel">
                <div className="hero-main">
                  <div
                    className={`status-orb ${device.online ? "live" : "offline-orb"}`}
                  >
                    <CircleDot size={25} />
                  </div>
                  <div>
                    <div
                      className={`status-label ${device.online ? "online-text" : "offline-text"}`}
                    >
                      {device.online
                        ? "ONLINE • LIVE CONNECTION"
                        : "OFFLINE • LAST KNOWN STATE"}
                    </div>
                    <h2>
                      {device.deviceName ||
                        device.deviceId ||
                        "Registered device"}
                    </h2>
                    <div className="device-id-line">
                      {device.deviceId || "Registered device"} ·{" "}
                      {device.deviceType}
                    </div>
                  </div>
                </div>
                <div className="mode-badge">
                  <ShieldCheck size={17} /> {device.mode}
                </div>
                <div className="metrics-grid">
                  <div className="metric-card">
                    <BatteryCharging size={20} />
                    <div>
                      <span>Battery</span>
                      <strong>{device.battery ?? "--"}%</strong>
                    </div>
                  </div>
                  <div className="metric-card">
                    <Wifi size={20} />
                    <div>
                      <span>Network</span>
                      <strong>{device.network || "Unknown"}</strong>
                    </div>
                  </div>
                  <div className="metric-card">
                    <Gauge size={20} />
                    <div>
                      <span>Last Seen</span>
                      <strong>{formatTime(device.lastSeen)}</strong>
                    </div>
                  </div>
                </div>
              </section>

              <section className="section-heading">
                <div>
                  <span className="eyebrow">RECOVERY ACTIONS</span>
                  <h2>Remote controls</h2>
                </div>
                <span>
                  Commands use the existing allowlisted recovery workflow.
                </span>
              </section>
              <section className="action-grid">
                <button
                  disabled={isActionBusy("DEVICE_STATUS")}
                  onClick={() => action("DEVICE_STATUS")}
                >
                  <Smartphone />
                  <div>
                    <strong>Device Status</strong>
                    <span>Refresh device health</span>
                  </div>
                </button>
                <button
                  disabled={isActionBusy("GET_LOCATION")}
                  onClick={() => action("GET_LOCATION")}
                >
                  <LocateFixed />
                  <div>
                    <strong>Get Location</strong>
                    <span>
                      {isActionBusy("GET_LOCATION")
                        ? "Request in progress…"
                        : "Request latest position"}
                    </span>
                  </div>
                </button>
                <button
                  disabled={isActionBusy("RING_DEVICE")}
                  onClick={() => action("RING_DEVICE")}
                >
                  <Volume2 />
                  <div>
                    <strong>Ring Device</strong>
                    <span>Play recovery alert</span>
                  </div>
                </button>
                <button
                  disabled={isActionBusy("RECOVERY_PHOTO", { camera: "front" })}
                  onClick={() => action("RECOVERY_PHOTO", { camera: "front" })}
                >
                  <Camera />
                  <div>
                    <strong>Front Camera</strong>
                    <span>
                      {isActionBusy("RECOVERY_PHOTO", { camera: "front" })
                        ? "Capturing…"
                        : "Request recovery photo"}
                    </span>
                  </div>
                </button>
                <button
                  disabled={isActionBusy("RECOVERY_PHOTO", { camera: "rear" })}
                  onClick={() => action("RECOVERY_PHOTO", { camera: "rear" })}
                >
                  <Camera />
                  <div>
                    <strong>Back Camera</strong>
                    <span>
                      {isActionBusy("RECOVERY_PHOTO", { camera: "rear" })
                        ? "Capturing…"
                        : "Request recovery photo"}
                    </span>
                  </div>
                </button>
                <button
                  className="critical-action"
                  disabled={isActionBusy("SET_RECOVERY_MODE", {
                    enabled: true,
                  })}
                  onClick={() => action("SET_RECOVERY_MODE", { enabled: true })}
                >
                  <ShieldCheck />
                  <div>
                    <strong>Enable Lost Mode</strong>
                    <span>Secure recovery state</span>
                  </div>
                </button>
                <button
                  className="voice-toggle"
                  aria-expanded={imeiVisible}
                  aria-controls="registered-imei-panel"
                  onClick={() => { setImeiVisible((visible) => !visible); setImeiCopyMessage(""); }}
                >
                  <Smartphone />
                  <div>
                    <strong>{imeiVisible ? "Hide IMEI" : "Show IMEI"}</strong>
                    <span>View this device's registered IMEI</span>
                  </div>
                </button>
              </section>

              {imeiVisible && (
                <section id="registered-imei-panel" className="glass-panel imei-reveal" aria-label="Registered IMEI">
                  {device.imei ? (
                    <div className="imei-reveal-row">
                      <div>
                        <span className="eyebrow">REGISTERED IMEI</span>
                        <strong className="imei-number">{device.imei}</strong>
                      </div>
                      <button type="button" className="secondary-button" onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(device.imei || "");
                          setImeiCopyMessage("IMEI copied to clipboard.");
                        } catch {
                          setImeiCopyMessage("Clipboard unavailable. Select the IMEI and copy it manually.");
                        }
                      }}><Copy size={16} /> Copy IMEI</button>
                    </div>
                  ) : <p>No IMEI is registered for this device.</p>}
                  {imeiCopyMessage && <p className="imei-copy-message" role="status">{imeiCopyMessage}</p>}
                </section>
              )}

              <section
                className="glass-panel"
                aria-label="Device Location Services"
                style={{ padding: 22, marginTop: 20 }}
              >
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">DEVICE SYSTEM SETTINGS</span>
                    <h2>Location Services</h2>
                  </div>
                  <MapPin size={22} />
                </div>
                <div className="location-meta">
                  <div>
                    <span>Current status</span>
                    <strong>
                      {!device.online
                        ? "Device Offline"
                        : device.locationServices || "Unknown"}
                    </strong>
                  </div>
                  <div>
                    <span>Last device-confirmed status</span>
                    <strong>
                      {formatTime(device.locationServicesLastConfirmed)}
                    </strong>
                  </div>
                </div>
                <p style={{ opacity: 0.75, margin: "12px 0" }}>
                  If Location is turned off, click “Turn On” to enable it and
                  get the device’s exact location.
                </p>
                <div className="card-actions">
                  <button
                    className="primary-button"
                    disabled={locationBusy}
                    onClick={() => void locationControl(true)}
                  >
                    <MapPin size={17} /> Turn ON Location
                  </button>
                  <button
                    className="secondary-button"
                    disabled={locationBusy}
                    onClick={() => void locationControl(false)}
                  >
                    <MapPin size={17} /> Turn OFF Location
                  </button>
                  <button
                    className="secondary-button"
                    disabled={
                      locationBusy ||
                      isActionBusy("DEVICE_STATUS") ||
                      !device.online
                    }
                    onClick={() => action("DEVICE_STATUS")}
                  >
                    <RefreshCw size={17} /> Refresh Status
                  </button>
                </div>
                {locationFeedback && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="command-banner"
                    style={{ marginTop: 12 }}
                  >
                    {locationBusy && <RefreshCw size={16} className="spin" />}
                    <span>{locationFeedback}</span>
                  </div>
                )}
                <p style={{ opacity: 0.7, fontSize: 12 }}>
                  Remote ON/OFF requires local opt-in and either Android that
                  Location Services changed.
                </p>
              </section>

              {(msg || activeCount > 0) && (
                <div className="command-banner glass-panel">
                  <div className="pulse-dot" />
                  <span>{msg || "Processing…"}</span>
                  {activeCount > 0 && <RefreshCw className="spin" size={16} />}
                </div>
              )}

              <section className="recovery-grid">
                <article className="location-card glass-panel">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">LAST KNOWN LOCATION</span>
                      <h2>Device map</h2>
                    </div>
                    <MapPin size={22} />
                  </div>
                  {device.location ? (
                    <>
                      <div className="map-frame">
                        <iframe
                          title="Last known device location"
                          src={mapEmbedUrl(device.location)}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          sandbox="allow-scripts allow-same-origin"
                        />
                        <div className="map-overlay">
                          <Navigation size={15} /> Last known position
                        </div>
                      </div>
                      <div className="location-meta">
                        <div>
                          <span>Coordinates</span>
                          <strong>
                            {device.location.latitude.toFixed(6)},{" "}
                            {device.location.longitude.toFixed(6)}
                          </strong>
                        </div>
                        <div>
                          <span>Accuracy</span>
                          <strong>
                            {device.location.accuracyMeters ?? "--"} m
                          </strong>
                        </div>
                        <div>
                          <span>Location time</span>
                          <strong>
                            {formatTime(device.location.timestamp)}
                          </strong>
                        </div>
                      </div>
                      <div className="card-actions">
                        <a
                          className="primary-button"
                          target="_blank"
                          rel="noreferrer"
                          href={googleMapsUrl(device.location)}
                        >
                          <ExternalLink size={17} /> Open in Maps
                        </a>
                        <button
                          className="secondary-button"
                          onClick={shareLocation}
                        >
                          <Navigation size={17} /> Share Location
                        </button>
                        <button
                          className="secondary-button"
                          onClick={downloadReport}
                        >
                          <Download size={17} /> Download Report
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      <Crosshair size={30} />
                      <h3>No location yet</h3>
                      <p>
                        Use Get Location to request the latest available
                        position.
                      </p>
                    </div>
                  )}
                </article>

                <article className="photo-card glass-panel">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">RECOVERY EVIDENCE</span>
                      <h2>Latest recovery photo</h2>
                    </div>
                    <Camera size={22} />
                  </div>
                  {device.photo ? (
                    <>
                      <div className="photo-frame">
                        {currentPhotoSrc ? <img src={currentPhotoSrc} alt="Latest recovery" /> : <p role="status">Loading saved recovery photo…</p>}
                      </div>
                      {photoLoadError && <p className="error-banner" role="status">{photoLoadError}</p>}
                      <div className="photo-meta">
                        <span>{device.photo.camera || "camera"} camera</span>
                        <span>{formatTime(device.photo.timestamp)}</span>
                      </div>
                      <div className="card-actions">
                        <a
                          className="primary-button"
                          href={currentPhotoSrc || undefined}
                          download={`jazz-recovery-${device.photo.camera || "photo"}.jpg`}
                        >
                          <Download size={17} /> Download Recovery Photo
                        </a>
                        <button
                          className="secondary-button"
                          onClick={downloadReport}
                        >
                          <Download size={17} /> Download Recovery Report
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state photo-empty">
                      <Camera size={32} />
                      <h3>No recovery photo yet</h3>
                      <p>
                        Request the front or back camera using the recovery
                        controls above.
                      </p>
                    </div>
                  )}
                </article>
              </section>
            </>
          )}
        </main>
      </div>

      <footer className="site-footer">
        <span className="footer-brand">Jazz Device Recovery</span>

        <span className="developer-credit">
          Developed by <span className="developer-name">😈 gunakarna 😈</span>
        </span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
