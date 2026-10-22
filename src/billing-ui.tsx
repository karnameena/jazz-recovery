import React, { useEffect, useState } from "react";
import "./billing.css";

const rawApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
function apiBaseUrl() {
  if (!rawApiBaseUrl) return "";
  const parsed = new URL(rawApiBaseUrl);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) throw new Error("Hosted API must use HTTPS.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Invalid API URL configuration.");
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}
const API = apiBaseUrl();
async function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body != null) headers.set("Content-Type", "application/json; charset=utf-8");
  const response = await fetch(API + path, { ...options, headers, credentials: "include", cache: "no-store" });
  const type = String(response.headers.get("content-type") || "");
  if (!type.includes("application/json")) throw new Error("Unexpected API response. Check the configured server URL.");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomId() {
  return "jazz-" + (crypto.randomUUID ? crypto.randomUUID() : randomToken(16));
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Request failed."; }

export function Register({ done, onLogin }: { done: () => void; onLogin: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [deviceId] = useState(randomId);
  const [deviceToken] = useState(() => randomToken(32));
  const [created, setCreated] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [imei, setImei] = useState("");
  const [username, setUsername] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get("password") || "");
    const confirm = String(fields.get("confirmPassword") || "");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      setError("Use at least 12 characters with uppercase, lowercase and a number."); return;
    }
    setBusy(true);
    try {
      await request("/api/auth/register", { method: "POST", body: JSON.stringify({
        username, password, deviceName, imei, deviceId, deviceToken
      }) });
      form.reset();
      setCreated(true);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function copyPairing() {
    const text = `Jazz Recovery device pairing\nDevice name: ${deviceName}\nIMEI: ${imei}\nDevice token ID: ${deviceId}\nDevice token: ${deviceToken}`;
    try { await navigator.clipboard.writeText(text); setError("Pairing details copied. Store them privately; the device token is shown only once."); }
    catch { setError("Clipboard access unavailable. Copy the device ID and token manually and keep them private."); }
  }

  if (created) return <main className="auth-shell"><div className="ambient ambient-one" /><section className="auth-card glass-panel">
    <div className="brand-mark">✓</div><div className="eyebrow">REGISTRATION COMPLETE</div><h1>Welcome to Jazz Recovery</h1>
    <p className="auth-subtitle">Your 7-day free trial has started. Save these device credentials now; the secret token cannot be retrieved later.</p>
    <label><span>Device token ID</span><input readOnly value={deviceId} /></label>
    <label><span>Device token — keep private</span><input readOnly value={deviceToken} /></label>
    <button type="button" className="primary-button full-width" onClick={() => void copyPairing()}>Copy device pairing details</button>
    {error && <div className="command-banner" role="status">{error}</div>}
    <button type="button" className="secondary-button full-width" onClick={done}>Continue to Jazz Recovery</button>
  </section></main>;

  return <main className="auth-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className="auth-card glass-panel"><div className="brand-mark">✦</div><div className="eyebrow">JAZZ SECURE RECOVERY</div>
      <h1>Create account</h1><p className="auth-subtitle">Register your account and pair your Android device to start a 7-day free trial.</p>
      <form onSubmit={submit} className="auth-form" autoComplete="off">
        <label><span>Username</span><input name="username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={64} required /></label>
        <label><span>Password</span><input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={12} /></label>
        <label><span>Confirm password</span><input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={12} /></label>
        <label><span>Device name</span><input name="deviceName" value={deviceName} onChange={e => setDeviceName(e.target.value)} placeholder="e.g. My Android phone" maxLength={80} required /></label>
        <label><span>IMEI (14–16 digits)</span><input name="imei" value={imei} onChange={e => setImei(e.target.value.replace(/[^0-9]/g, "").slice(0,16))} inputMode="numeric" pattern="[0-9]{14,16}" required /></label>
        <label><span>Generated device token ID</span><input readOnly value={deviceId} /></label>
        <label><span>Generated device token</span><input readOnly value={deviceToken} /></label>
        <label className="checkbox-row"><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} /> Show passwords</label>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <button className="primary-button full-width" type="submit" disabled={busy}>{busy ? "Creating secure account…" : "Register and start free trial"}</button>
      </form>
      <p className="auth-subtitle">Already registered? <button type="button" className="text-button" onClick={onLogin}>Sign in</button></p>
      <p className="auth-subtitle">Your password is hashed on the server. Device token secrets are stored as hashes.</p>
    </section>
  </main>;
}

declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void }; }
}
type SubscriptionState = { status: string; access: boolean; trialEndsAt: string | null; paidEndsAt: string | null };
export function BillingPanel() {
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [code, setCode] = useState("");
  const [pricePaise, setPricePaise] = useState(49900);
  const [preview, setPreview] = useState<{percentOff:number;amountPaise:number}|null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [codes, setCodes] = useState<Array<{id:number;code_hint:string;percent_off:number;active:boolean;expires_at:string|null;redemption_count:number;max_redemptions:number|null}>>([]);
  const [newCode, setNewCode] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [percent, setPercent] = useState("10");
  const [expires, setExpires] = useState("");
  const [limit, setLimit] = useState("");

  async function refresh() {
    const result = await request("/api/billing/status");
    setSubscription(result.subscription);
    setPricePaise(result.pricePaise || 49900);
  }
  async function refreshCodes() {
    try { const result = await request("/api/admin/discount-codes"); setCodes(result.items || []); setIsOwner(true); }
    catch { setIsOwner(false); }
  }
  useEffect(() => { void refresh().catch(e => setMessage(errorMessage(e))); void refreshCodes(); }, []);
  async function applyCode() {
    setMessage(""); setPreview(null);
    if (!code.trim()) { setMessage("Enter a discount code first."); return; }
    try {
      const result = await request("/api/billing/discount/validate", { method: "POST", body: JSON.stringify({code}) });
      setPreview({ percentOff: result.percentOff, amountPaise: result.amountPaise });
      setMessage("Discount validated by the server.");
    } catch (e) { setMessage(errorMessage(e)); }
  }
  async function subscribe() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await request("/api/billing/checkout", { method: "POST", body: JSON.stringify({code: code.trim() || undefined}) });
      if (result.complimentary) { await refresh(); setMessage("Complimentary annual access activated."); return; }
      if (!result.keyId || !result.orderId) throw new Error("Payment order was not returned by the server.");
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.onload = () => resolve(); script.onerror = () => reject(new Error("Could not load secure Razorpay Checkout."));
          document.head.appendChild(script);
        });
      }
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
      const checkout = new window.Razorpay({
        key: result.keyId, amount: result.amountPaise, currency: "INR", name: "Jazz Recovery",
        description: result.description, order_id: result.orderId,
        theme: { color: "#6f8cff" },
        handler: async () => {
          setMessage("Payment submitted. Waiting for verified provider confirmation…");
          for (let i=0; i<12; i++) {
            await new Promise(resolve => window.setTimeout(resolve, 2500));
            await refresh();
            const current = await request("/api/billing/status");
            if (current.subscription?.status === "active" || current.subscription?.status === "complimentary") {
              setMessage("Annual subscription activated."); return;
            }
          }
          setMessage("Payment is awaiting verified confirmation. Your account will update when the payment webhook is processed.");
        },
        modal: { ondismiss: () => setMessage("Checkout closed. No subscription was activated unless payment is verified.") }
      });
      checkout.open();
    } catch (e) { setMessage(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function createCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    try {
      if (editingId !== null) {
        await request("/api/admin/discount-codes/" + editingId, {method:"PATCH",body:JSON.stringify({percentOff:Number(percent),expiresAt:expires || null,maxRedemptions:limit ? Number(limit) : null})});
        setMessage("Discount updated. Existing entitlements are unchanged.");
        setEditingId(null);
      } else {
        await request("/api/admin/discount-codes", {method:"POST",body:JSON.stringify({code:newCode,percentOff:Number(percent),expiresAt:expires || null,maxRedemptions:limit ? Number(limit) : null})});
        setMessage("Discount created. Save the exact code you entered; the server stores only its hash.");
      }
      setNewCode(""); setExpires(""); setLimit(""); await refreshCodes();
    } catch(e) { setMessage(errorMessage(e)); }
  }
  function editCode(item: {id:number;percent_off:number;expires_at:string|null;max_redemptions:number|null}) {
    setEditingId(item.id);
    setPercent(String(item.percent_off));
    const date = item.expires_at ? new Date(item.expires_at) : null;
    setExpires(date ? new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16) : "");
    setLimit(item.max_redemptions == null ? "" : String(item.max_redemptions));
  }
  async function toggleCode(id:number, active:boolean) {
    try { await request("/api/admin/discount-codes/"+id,{method:"PATCH",body:JSON.stringify({active})}); await refreshCodes(); setMessage(active?"Code enabled.":"Code disabled for future redemptions."); }
    catch(e) { setMessage(errorMessage(e)); }
  }
  const end = subscription?.status === "trialing" ? subscription.trialEndsAt : subscription?.paidEndsAt;
  const endLabel = end ? new Date(end).toLocaleString() : "Not available";
  return <section className="glass-panel billing-panel">
    <div className="card-heading"><div><span className="eyebrow">ACCOUNT PLAN</span><h2>Trial & subscription</h2></div><span className="count-badge">{subscription?.status || "loading"}</span></div>
    <p>Your 7-day trial is followed by an optional annual plan at <strong>₹499/year</strong>. Payments are manual; no automatic renewal.</p>
    <div className="billing-meta"><div><span>Current status</span><strong>{subscription?.status || "Loading…"}</strong></div><div><span>Access ends</span><strong>{endLabel}</strong></div></div>
    <div className="billing-actions"><input aria-label="Discount code" placeholder="Discount code (optional)" value={code} onChange={e=>{setCode(e.target.value.toUpperCase());setPreview(null);}} maxLength={40}/><button className="secondary-button" onClick={()=>void applyCode()} disabled={busy}>Apply code</button></div>
    {preview && <p className="billing-price">Discount {preview.percentOff}% · Total <strong>₹{(preview.amountPaise/100).toFixed(2)}</strong></p>}
    <button className="primary-button" disabled={busy || subscription?.status === "active" || subscription?.status === "complimentary"} onClick={()=>void subscribe()}>{busy?"Preparing secure checkout…":subscription?.access && subscription.status==="trialing"?"Subscribe for one year":"Subscribe / Renew — ₹"+(pricePaise/100).toFixed(2)}</button>
    {message && <p className="billing-message" role="status">{message}</p>}
    {isOwner && <div className="discount-admin"><div className="eyebrow">OWNER CONTROLS</div><h3>Discount code management</h3>
      <form onSubmit={createCode} className="discount-form">
        {editingId === null
          ? <label><span>New code</span><input value={newCode} onChange={e=>setNewCode(e.target.value.toUpperCase())} pattern="[A-Z0-9][A-Z0-9-]{3,39}" required /></label>
          : <div><span>Editing code ••••{codes.find(item=>item.id===editingId)?.code_hint}</span><p>The original code is hashed and cannot be displayed or renamed. To rotate it, create a replacement code and disable the old one.</p></div>}
        <label><span>Discount</span><select value={percent} onChange={e=>setPercent(e.target.value)}><option value="10">10%</option><option value="20">20%</option><option value="50">50%</option><option value="100">100% family/friends</option></select></label>
        <label><span>Expiry (optional)</span><input type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)} /></label>
        <label><span>Max redemptions (optional)</span><input type="number" min="1" max="1000000" value={limit} onChange={e=>setLimit(e.target.value)} /></label>
        <button className="primary-button" type="submit">{editingId === null ? "Create discount code" : "Save discount changes"}</button>
        {editingId !== null && <button className="secondary-button" type="button" onClick={()=>{setEditingId(null);setExpires("");setLimit("");}}>Cancel edit</button>}
      </form>
      <div className="discount-list">{codes.map(item=><div className="discount-row" key={item.id}><span>••••{item.code_hint} · {item.percent_off}% · {item.redemption_count}{item.max_redemptions?"/"+item.max_redemptions:""} used · {item.active?"Active":"Disabled"}</span><div><button className="secondary-button" onClick={()=>editCode(item)}>Edit</button> <button className="secondary-button" onClick={()=>void toggleCode(item.id,!item.active)}>{item.active?"Disable":"Enable"}</button></div></div>)}</div>
    </div>}
  </section>;
}
