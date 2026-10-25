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
// In local Vite development, use the same-origin /api proxy so the launcher can
// route requests to the exact backend PORT configured in the private server .env.
// Hosted builds keep using the explicitly configured VITE_API_BASE_URL.
const API = import.meta.env.DEV ? "" : apiBaseUrl();
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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [deviceId] = useState(randomId);
  const [deviceToken] = useState(() => randomToken(32));
  const [created, setCreated] = useState(false);
  const [trialActivated, setTrialActivated] = useState(false);
  const [showTrialToast, setShowTrialToast] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [imei, setImei] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    if (!created || !trialActivated) return;
    setShowTrialToast(true);
    const timer = window.setTimeout(() => setShowTrialToast(false), 4000);
    return () => window.clearTimeout(timer);
  }, [created, trialActivated]);

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
      const result = await request("/api/auth/register", { method: "POST", body: JSON.stringify({
        username, password, deviceName, imei, deviceId, deviceToken
      }) });
      form.reset();
      setTrialActivated(result.trialActivated === true);
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
    {showTrialToast && <div className="trial-toast" role="status">Your 7-day free trial is activated.</div>}
    <div className="brand-mark">✓</div><div className="eyebrow">REGISTRATION COMPLETE</div><h1>Welcome to Jazz Recovery</h1>
    <p className="auth-subtitle">{trialActivated ? "Your 7-day free trial has started. Save these device credentials now; the secret token cannot be retrieved later." : "Your account is registered, but this username has already claimed its free trial. Choose a subscription plan after continuing. Save these device credentials now; the secret token cannot be retrieved later."}</p>
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
type SubscriptionState = { status: string; access: boolean; trialEndsAt: string | null; paidEndsAt: string | null; planType: string | null };
export function BillingPanel({ onAccessChange }: { onAccessChange?: (access: "trial" | "subscribed" | "expired") => void }) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [code, setCode] = useState("");
  const [plans, setPlans] = useState({ monthly: 4900, annual: 39900 });
  const [planDetails, setPlanDetails] = useState({
    monthly: { label: "Monthly", periodLabel: "1 month", durationMonths: 1 },
    annual: { label: "Annual", periodLabel: "12 months", durationMonths: 12 }
  });
  const [plan, setPlan] = useState<"monthly" | "annual">("annual");
  const [preview, setPreview] = useState<{percentOff:number;amountPaise:number}|null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [codes, setCodes] = useState<Array<{id:string;label:string;percent_off:number;active:boolean;starts_at:string;expires_at:string|null;redeemed_count:number;max_redemptions:number|null;eligible_plan:string;per_user_limit:number}>>([]);
  const [userLedger, setUserLedger] = useState<Array<{username:string;trial_started_at:string|null;trial_ends_at:string|null;trial_active:boolean;subscription_id:string|null;subscription_plan:string|null;subscription_duration_months:number|null;subscription_status:string|null;subscription_started_at:string|null;subscription_ends_at:string|null;amount_paid_paise:number|null;subscription_active:boolean}>>([]);
  const [newCode, setNewCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [percent, setPercent] = useState("10");
  const [startsAt, setStartsAt] = useState("");
  const [expires, setExpires] = useState("");
  const [limit, setLimit] = useState("");
  const [perUserLimit, setPerUserLimit] = useState("1");
  const [eligiblePlan, setEligiblePlan] = useState("annual");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [claimingAdmin, setClaimingAdmin] = useState(false);

  async function claimAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (claimingAdmin || !bootstrapSecret) return;
    setClaimingAdmin(true);
    setMessage("");
    try {
      await request("/api/billing/admin/claim", { method: "POST", body: JSON.stringify({ bootstrapSecret }) });
      setBootstrapSecret("");
      await refresh();
      setMessage("Owner billing controls enabled. Remove the one-time bootstrap secret from the server environment now.");
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setClaimingAdmin(false);
    }
  }

  async function refresh() {
    const result = await request("/api/billing/status");
    if (result.access === "trial" || result.access === "subscribed" || result.access === "expired") onAccessChange?.(result.access);
    setIsOwner(result.isBillingAdmin === true);
    if (result.isBillingAdmin === true) await refreshCodes();
    else setCodes([]);
    setPlans({ monthly: Number(result.plans?.monthly || 4900), annual: Number(result.plans?.annual || result.pricePaise || 39900) });
    setPlanDetails({
      monthly: {
        label: String(result.planDetails?.monthly?.label || "Monthly"),
        periodLabel: String(result.planDetails?.monthly?.periodLabel || "1 month"),
        durationMonths: Number(result.planDetails?.monthly?.durationMonths || 1)
      },
      annual: {
        label: String(result.planDetails?.annual?.label || "Annual"),
        periodLabel: String(result.planDetails?.annual?.periodLabel || "12 months"),
        durationMonths: Number(result.planDetails?.annual?.durationMonths || 12)
      }
    });
    if (result.subscription?.active) {
      setSubscription({ status: result.subscription.status, access: true, trialEndsAt: null, paidEndsAt: result.subscription.expires_at, planType: result.subscription.plan_type || "annual" });
    } else if (result.trial?.active) {
      setSubscription({ status: "trialing", access: true, trialEndsAt: result.trial.expiresAt, paidEndsAt: null, planType: null });
    } else {
      setSubscription({ status: "expired", access: false, trialEndsAt: result.trial?.expiresAt || null, paidEndsAt: result.subscription?.expires_at || null, planType: result.subscription?.plan_type || null });
    }
  }
  async function refreshCodes() {
    try {
      const result = await request("/api/billing/admin/discount-codes");
      setCodes(result.items || []);
      const ledger = await request("/api/billing/admin/user-ledger");
      setUserLedger(ledger.items || []);
      setIsOwner(true);
    } catch (e) {
      setMessage(errorMessage(e));
      setIsOwner(false);
    }
  }
  function formatLedgerDate(value: string | null) {
    return value ? new Date(value).toLocaleString() : "—";
  }
  useEffect(() => { void refresh().catch(e => setMessage(errorMessage(e))); }, []);
  async function applyCode() {
    setMessage(""); setPreview(null);
    if (!code.trim()) { setMessage("Enter a discount code first."); return; }
    try {
      const result = await request("/api/billing/discount/validate", { method: "POST", body: JSON.stringify({code, plan}) });
      if (!result.valid) throw new Error(result.error || "This discount code is invalid or unavailable.");
      if (!Number.isFinite(Number(result.percentOff)) || !Number.isFinite(Number(result.amountPaise))) throw new Error("The server returned an invalid discount preview.");
      setPreview({ percentOff: Number(result.percentOff), amountPaise: Number(result.amountPaise) });
      setMessage("Discount validated by the server.");
    } catch (e) { setMessage(errorMessage(e)); }
  }
  async function subscribe() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await request("/api/billing/checkout", { method: "POST", body: JSON.stringify({code: code.trim() || undefined, plan}) });
      if (result.complimentary) { await refresh(); setMessage(`Complimentary ${plan} access activated.`); return; }
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
          setCheckoutOpen(false);
          setMessage("Payment submitted. Waiting for verified provider confirmation…");
          for (let i=0; i<12; i++) {
            await new Promise(resolve => window.setTimeout(resolve, 2500));
            await refresh();
            const current = await request("/api/billing/status");
            if (current.access === "subscribed" || current.subscription?.status === "active" || current.subscription?.status === "complimentary") {
              setMessage(`${plan === "monthly" ? "Monthly" : "Annual"} subscription activated.`); return;
            }
          }
          setMessage("Payment is awaiting verified confirmation. Your account will update when the payment webhook is processed.");
        },
        modal: { ondismiss: () => { setCheckoutOpen(false); setMessage("Checkout closed. No subscription was activated unless payment is verified."); } }
      });
      setCheckoutOpen(true);
      checkout.open();
    } catch (e) { setMessage(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function createCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    try {
      if (editingId !== null) {
        await request("/api/billing/admin/discount-codes/" + editingId + "/update", {method:"POST",body:JSON.stringify({percentOff:Number(percent),startsAt:startsAt || null,expiresAt:expires || null,maxRedemptions:limit ? Number(limit) : null,perUserLimit:Number(perUserLimit),eligiblePlan})});
        setMessage("Discount updated. Existing entitlements are unchanged.");
        setEditingId(null);
      } else {
        await request("/api/billing/admin/discount-codes", {method:"POST",body:JSON.stringify({code:newCode,label:newCode,percentOff:Number(percent),startsAt:startsAt || null,expiresAt:expires || null,maxRedemptions:limit ? Number(limit) : null,perUserLimit:Number(perUserLimit),eligiblePlan})});
        setMessage("Discount created. Save the exact code you entered; the server stores only its hash.");
      }
      setNewCode(""); setStartsAt(""); setExpires(""); setLimit(""); setPerUserLimit("1"); setEligiblePlan("annual"); await refreshCodes();
    } catch(e) { setMessage(errorMessage(e)); }
  }
  function editCode(item: {id:string;percent_off:number;starts_at:string;expires_at:string|null;max_redemptions:number|null;eligible_plan:string;per_user_limit:number}) {
    setEditingId(item.id);
    setPercent(String(item.percent_off));
    const start = item.starts_at ? new Date(item.starts_at) : null;
    const end = item.expires_at ? new Date(item.expires_at) : null;
    setStartsAt(start ? new Date(start.getTime() - start.getTimezoneOffset()*60000).toISOString().slice(0,16) : "");
    setExpires(end ? new Date(end.getTime() - end.getTimezoneOffset()*60000).toISOString().slice(0,16) : "");
    setLimit(item.max_redemptions == null ? "" : String(item.max_redemptions));
    setPerUserLimit(String(item.per_user_limit || 1));
    setEligiblePlan(item.eligible_plan || "annual");
  }
  async function toggleCode(id:string, active:boolean) {
    try { await request("/api/billing/admin/discount-codes/"+id+(active?"/enable":"/disable"),{method:"POST",body:JSON.stringify({})}); await refreshCodes(); setMessage(active?"Code enabled.":"Code disabled for future redemptions."); }
    catch(e) { setMessage(errorMessage(e)); }
  }
  const end = subscription?.status === "trialing" ? subscription.trialEndsAt : subscription?.paidEndsAt;
  const endLabel = end ? new Date(end).toLocaleString() : "Not available";
  const selectedPricePaise = preview ? preview.amountPaise : plans[plan];
  return <section className="glass-panel billing-panel">
    <div className="card-heading"><div><span className="eyebrow">ACCOUNT PLAN</span><h2>Trial & subscription</h2></div><span className="count-badge">{subscription?.status || "loading"}</span></div>
    <p>Your configured trial period is followed by an optional subscription. Choose the monthly or annual plan that fits you. Payments are processed securely by Razorpay; no automatic renewal is enabled.</p>
    {subscription && !subscription.access && <div className="error-banner" role="status">Your trial or subscription access has ended. Subscribe to continue with your selected plan. Existing recovery controls remain available so subscription expiry does not unexpectedly lock you out of essential recovery.</div>}
    <div className="billing-meta"><div><span>Current status</span><strong>{subscription?.status || "Loading…"}</strong></div><div><span>Access ends</span><strong>{endLabel}</strong></div></div>
    <div className="billing-plans" role="group" aria-label="Subscription plan">
      <button type="button" className={plan === "monthly" ? "primary-button" : "secondary-button"} onClick={() => {setPlan("monthly");setPreview(null);}}>{planDetails.monthly.label} · {planDetails.monthly.periodLabel} · ₹{(plans.monthly/100).toFixed(2)}</button>
      <button type="button" className={plan === "annual" ? "primary-button" : "secondary-button"} onClick={() => {setPlan("annual");setPreview(null);}}>{planDetails.annual.label} · {planDetails.annual.periodLabel} · ₹{(plans.annual/100).toFixed(2)}</button>
    </div>
    <div className="billing-actions"><input aria-label="Discount code" placeholder="Discount code (optional)" value={code} onChange={e=>{setCode(e.target.value.toUpperCase());setPreview(null);}} maxLength={40}/><button className="secondary-button" onClick={()=>void applyCode()} disabled={busy}>Apply code</button></div>
    {preview && <p className="billing-price">Discount {preview.percentOff}% · Total <strong>₹{(preview.amountPaise/100).toFixed(2)}</strong></p>}
    <button className="primary-button" disabled={busy || checkoutOpen || subscription?.status === "active" || subscription?.status === "complimentary"} onClick={()=>void subscribe()}>{busy?"Preparing secure checkout…":checkoutOpen?"Checkout open…":`Subscribe ${plan === "monthly" ? "monthly" : "annually"} — ₹${(selectedPricePaise/100).toFixed(2)}`}</button>
    {message && <p className="billing-message" role="status">{message}</p>}
    {!isOwner && <div className="discount-admin">
      <div className="eyebrow">FIRST-TIME OWNER SETUP</div>
      <p>Only the first authenticated account can claim billing administration. Enter the one-time secret configured privately on the server. Do not share it.</p>
      <form className="discount-form" onSubmit={claimAdmin}>
        <label><span>One-time bootstrap secret</span><input type="password" value={bootstrapSecret} onChange={e=>setBootstrapSecret(e.target.value)} autoComplete="off" required /></label>
        <button className="primary-button" type="submit" disabled={claimingAdmin}>{claimingAdmin ? "Verifying owner setup…" : "Claim billing admin"}</button>
      </form>
    </div>}
    {isOwner && <div className="discount-admin"><div className="eyebrow">OWNER CONTROLS</div><h3>Discount code management</h3>
      <form onSubmit={createCode} className="discount-form">
        {editingId === null
          ? <label><span>New code</span><input value={newCode} onChange={e=>setNewCode(e.target.value.toUpperCase())} pattern="[A-Z0-9][A-Z0-9-]{3,39}" required /></label>
          : <div><span>Editing code ••••{codes.find(item=>item.id===editingId)?.label}</span><p>The original code is hashed and cannot be displayed or renamed. To rotate it, create a replacement code and disable the old one.</p></div>}
        <label><span>Discount</span><select value={percent} onChange={e=>setPercent(e.target.value)}><option value="10">10%</option><option value="20">20%</option><option value="50">50%</option><option value="100">100% family/friends</option></select></label>
        <label><span>Starts at (optional)</span><input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} /></label>
        <label><span>Fixed expiry (optional)</span><input type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)} /></label>
        <label><span>Eligible plan</span><select value={eligiblePlan} onChange={e=>setEligiblePlan(e.target.value)}><option value="annual">Annual only</option><option value="monthly">Monthly only</option><option value="both">Monthly and annual</option></select></label>
        <label><span>Max redemptions overall (optional)</span><input type="number" min="1" max="1000000" value={limit} onChange={e=>setLimit(e.target.value)} /></label>
        <label><span>Max uses per user</span><input type="number" min="1" max="1000000" value={perUserLimit} onChange={e=>setPerUserLimit(e.target.value)} required /></label>
        <button className="primary-button" type="submit">{editingId === null ? "Create discount code" : "Save discount changes"}</button>
        {editingId !== null && <button className="secondary-button" type="button" onClick={()=>{setEditingId(null);setStartsAt("");setExpires("");setLimit("");setPerUserLimit("1");setEligiblePlan("annual");}}>Cancel edit</button>}
      </form>
      <div className="discount-list">{codes.map(item=><div className="discount-row" key={item.id}><span>{item.label} · {item.percent_off}% · {item.eligible_plan} · {item.redeemed_count}{item.max_redemptions?"/"+item.max_redemptions:""} used · {item.per_user_limit}/user · {item.active?"Active":"Disabled"}</span><div><button className="secondary-button" onClick={()=>editCode(item)}>Edit</button> <button className="secondary-button" onClick={()=>void toggleCode(item.id,!item.active)}>{item.active?"Disable":"Enable"}</button></div></div>)}</div>
      <div className="user-ledger-heading">
        <div><h3>Per-user trial & subscription ledger</h3><p>Live PostgreSQL records. JSON config files define trial duration and plan rules; user dates are stored here and are not overwritten by redeploys.</p></div>
        <button type="button" className="secondary-button" onClick={()=>void refreshCodes()}>Refresh ledger</button>
      </div>
      <div className="discount-list user-ledger-list">
        {userLedger.length === 0 && <p>No registered-user ledger records returned yet.</p>}
        {userLedger.map((item,index)=><div className="discount-row user-ledger-row" key={item.username+":"+(item.subscription_id || "trial-only")+":"+index}>
          <span><strong>{item.username}</strong><br />Trial: {formatLedgerDate(item.trial_started_at)} → {formatLedgerDate(item.trial_ends_at)} · {item.trial_active ? "Trial active" : item.trial_ends_at ? "Trial expired" : "No trial record"}<br />Subscription: {item.subscription_plan || "—"} · Period: {item.subscription_duration_months === 1 ? "1 month" : item.subscription_duration_months ? `${item.subscription_duration_months} months` : "—"} · {item.subscription_active ? item.subscription_status : item.subscription_ends_at && ["active", "complimentary"].includes(String(item.subscription_status)) ? "expired" : item.subscription_status || "Not subscribed"}<br />Start: {formatLedgerDate(item.subscription_started_at)} · End: {formatLedgerDate(item.subscription_ends_at)} · Paid: {item.amount_paid_paise == null ? "—" : "₹"+(Number(item.amount_paid_paise)/100).toFixed(2)}</span>
        </div>)}
      </div>
    </div>}
  </section>;
}
