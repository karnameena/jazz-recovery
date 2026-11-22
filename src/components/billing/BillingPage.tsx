import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Clock3, CreditCard, LogOut, RefreshCw, ShieldCheck, Ticket, Trash2 } from "lucide-react";
import { api } from "../../services/api";
import "./billing.css";

type Plan = "monthly" | "annual";
type BillingStatus = {
  access: "trial" | "trial_pending" | "subscribed" | "expired";
  trial: { startsAt: string; expiresAt: string; active: boolean } | null;
  subscription: { status: string; starts_at: string; expires_at: string; amount_paid_paise: number; plan_type: Plan; active: boolean } | null;
  pendingPayment: { id: string; plan_type: Plan; amount_paise: number; status: string } | null;
  plans: { monthly: number; annual: number };
  paymentLinks: Record<Plan, string>;
  isBillingAdmin: boolean;
  isOwnerAdmin: boolean;
};
type DiscountCode = {
  id: string; label: string; percent_off: number; active: boolean; starts_at: string; expires_at: string | null;
  trial_eligible_from: string | null; trial_eligible_until: string | null; max_redemptions: number | null;
  redeemed_count: number; eligible_plan: string; per_user_limit: number;
};
type LedgerItem = {
  user_id: number; username: string; trial_started_at: string | null; trial_ends_at: string | null;
  trial_active: boolean; subscription_id: string | null; subscription_plan: Plan | null; subscription_status: string | null;
  subscription_started_at: string | null; subscription_ends_at: string | null; amount_paid_paise: number | null; pending_payments: number;
};
type PaymentIntent = { id: string; username: string; plan_type: Plan; amount_paise: number; status: string; created_at: string; payment_url: string | null };
type AuditItem = { id: number; actor_user_id: number | null; action: string; details: unknown; created_at: string };
type SubscriptionHistory = { id: string; username: string; plan_type: Plan; status: string; starts_at: string; expires_at: string; amount_paid_paise: number; created_at: string };
type PaymentHistory = { id: string; username: string; plan_type: Plan; status: string; amount_paise: number; payment_id: string | null; order_id: string; created_at: string };
type CodeUsage = { id: string; username: string; amount_paid_paise: number; created_at: string };

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "Not set";
const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const toLocalInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => value ? new Date(value).toISOString() : null;

export function BillingPage({ onBack, onLogout }: { onBack: () => void; onLogout: () => Promise<void> }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [payments, setPayments] = useState<PaymentIntent[]>([]);
  const [subscriptionHistory, setSubscriptionHistory] = useState<SubscriptionHistory[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [codeUsage, setCodeUsage] = useState<{ codeId: string; items: CodeUsage[] } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan>("annual");
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState<{ percentOff: number; amountPaise: number; label: string } | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPercent, setNewPercent] = useState("10");
  const [newActive, setNewActive] = useState(true);
  const [newStarts, setNewStarts] = useState("");
  const [newExpires, setNewExpires] = useState("");
  const [trialFrom, setTrialFrom] = useState("");
  const [trialUntil, setTrialUntil] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [perUserLimit, setPerUserLimit] = useState("1");
  const [search, setSearch] = useState("");
  const [codeSearch, setCodeSearch] = useState("");
  const [replacementCode, setReplacementCode] = useState("");
  const [editingCode, setEditingCode] = useState<DiscountCode | null>(null);
  const [editingLedger, setEditingLedger] = useState<LedgerItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LedgerItem | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const current = await api("/api/billing/status") as BillingStatus;
    setStatus(current);
    if (current.isBillingAdmin || current.isOwnerAdmin) {
      const [codeData, ledgerData, paymentData, auditData, subscriptionData, historyData] = await Promise.all([
        api("/api/billing/admin/discount-codes"), api("/api/billing/admin/user-ledger"),
        api("/api/billing/admin/payment-intents"), api("/api/billing/admin/audit"),
        api("/api/billing/admin/subscriptions"), api("/api/billing/admin/payments")
      ]);
      setCodes(codeData.items || []); setLedger(ledgerData.items || []);
      setPayments(paymentData.items || []); setAudit(auditData.items || []);
      setSubscriptionHistory(subscriptionData.items || []); setPaymentHistory(historyData.items || []);
    } else {
      setCodes([]); setLedger([]); setPayments([]); setAudit([]); setSubscriptionHistory([]); setPaymentHistory([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load().catch((reason) => { setError(reason instanceof Error ? reason.message : "Could not load subscription details."); setLoading(false); }); }, [load]);
  const filteredLedger = useMemo(() => ledger.filter(item => item.username.toLowerCase().includes(search.trim().toLowerCase())), [ledger, search]);
  const filteredCodes = useMemo(() => codes.filter(item => `${item.label} ${item.percent_off}`.toLowerCase().includes(codeSearch.trim().toLowerCase())), [codes, codeSearch]);

  async function runTask(task: () => Promise<void>, success?: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await task(); if (success) setMessage(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The operation could not be completed."); }
    finally { setBusy(false); }
  }


  async function validateDiscount(event: FormEvent) {
    event.preventDefault();
    await runTask(async () => {
      if (selectedPlan !== "annual") throw new Error("Discount codes are available only for the annual plan.");
      const result = await api("/api/billing/discount/validate", { method: "POST", body: JSON.stringify({ code, plan: "annual" }) });
      if (!result.valid) throw new Error(result.error || "This discount code is not available.");
      setDiscount({ percentOff: Number(result.percentOff), amountPaise: Number(result.amountPaise), label: result.label || "Annual discount" });
    }, "Discount validated by the server.");
  }

  async function pay() {
    await runTask(async () => {
      const result = await api("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: selectedPlan, code: selectedPlan === "annual" && discount ? code : "" }) });
      if (result.paymentUrl) {
        setMessage("Opening Razorpay. Your subscription remains pending until payment is verified by the server.");
        window.location.assign(result.paymentUrl);
        return;
      }
      if (result.pending) {
        setMessage(result.message || "Your discounted payment is pending dynamic checkout configuration. No subscription has been activated.");
        await load();
      }
    });
  }

  async function createCode(event: FormEvent) {
    event.preventDefault();
    await runTask(async () => {
      const result = await api("/api/billing/admin/discount-codes", { method: "POST", body: JSON.stringify({
        code: newCode || undefined, label: newLabel, percentOff: Number(newPercent), startsAt: fromLocalInput(newStarts) || new Date().toISOString(),
        expiresAt: fromLocalInput(newExpires), trialEligibleFrom: fromLocalInput(trialFrom), trialEligibleUntil: fromLocalInput(trialUntil),
        maxRedemptions: maxRedemptions || null, perUserLimit: Number(perUserLimit), eligiblePlan: "annual", active: newActive
      }) });
      setNewCode(""); setNewLabel(""); setNewActive(true); setNewStarts(""); setNewExpires(""); setTrialFrom(""); setTrialUntil(""); setMaxRedemptions("");
      setMessage(`Discount code created: ${result.code}`); await load();
    });
  }

  async function saveCode(event: FormEvent) {
    event.preventDefault(); if (!editingCode) return;
    await runTask(async () => {
      await api(`/api/billing/admin/discount-codes/${editingCode.id}/update`, { method: "POST", body: JSON.stringify({
        code: replacementCode || undefined, label: editingCode.label, percentOff: editingCode.percent_off, startsAt: editingCode.starts_at,
        expiresAt: editingCode.expires_at, trialEligibleFrom: editingCode.trial_eligible_from,
        trialEligibleUntil: editingCode.trial_eligible_until, maxRedemptions: editingCode.max_redemptions,
        perUserLimit: editingCode.per_user_limit
      }) });
      setEditingCode(null); setReplacementCode(""); await load();
    }, replacementCode ? "Discount code updated and replaced." : "Discount code updated.");
  }

  async function showCodeUsage(item: DiscountCode) {
    await runTask(async () => {
      const result = await api(`/api/billing/admin/discount-codes/${item.id}/usage`);
      setCodeUsage({ codeId: item.id, items: result.items || [] });
    });
  }

  async function codeAction(item: DiscountCode, action: "enable" | "disable" | "delete") {
    if (action === "delete" && !window.confirm("Delete this discount code? Codes with redemption history can only be disabled.")) return;
    await runTask(async () => { await api(`/api/billing/admin/discount-codes/${item.id}/${action}`, { method: "POST", body: "{}" }); await load(); }, `Discount code ${action === "delete" ? "deleted" : action + "d"}.`);
  }

  async function saveLedger(event: FormEvent) {
    event.preventDefault(); if (!editingLedger) return;
    await runTask(async () => {
      if (editingLedger.trial_started_at && editingLedger.trial_ends_at) {
        await api(`/api/billing/admin/users/${editingLedger.user_id}/trial`, { method: "POST", body: JSON.stringify({ startsAt: editingLedger.trial_started_at, expiresAt: editingLedger.trial_ends_at }) });
      } else if (editingLedger.trial_started_at || editingLedger.trial_ends_at) {
        throw new Error("Enter both trial dates, or leave both blank without changing the trial.");
      }
      if (editingLedger.subscription_id && editingLedger.subscription_started_at && editingLedger.subscription_ends_at && editingLedger.subscription_status) {
        await api(`/api/billing/admin/users/${editingLedger.user_id}/subscription`, { method: "POST", body: JSON.stringify({
          startsAt: editingLedger.subscription_started_at, expiresAt: editingLedger.subscription_ends_at,
          status: editingLedger.subscription_status, planType: editingLedger.subscription_plan || "annual"
        }) });
      }
      setEditingLedger(null); await load();
    }, "Account access dates saved to PostgreSQL and audited.");
  }

  async function deleteUser(event: FormEvent) {
    event.preventDefault(); if (!deleteTarget) return;
    await runTask(async () => {
      await api(`/api/billing/admin/users/${deleteTarget.user_id}/delete`, { method: "POST", body: JSON.stringify({ confirmUsername: deleteConfirmation }) });
      setDeleteTarget(null); setDeleteConfirmation(""); await load();
    }, "User and cascading account records deleted.");
  }

  const isAdmin = Boolean(status?.isBillingAdmin || status?.isOwnerAdmin);
  const isTrial = status?.access === "trial";
  const isTrialPending = status?.access === "trial_pending";
  const isActive = status?.access === "subscribed";
  const originalAnnual = status?.plans.annual ?? 39900;
  const checkoutAmount = selectedPlan === "annual" && discount ? discount.amountPaise : status?.plans[selectedPlan] ?? (selectedPlan === "annual" ? 39900 : 4900);

  return <main className="billing-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className="billing-page glass-panel">
      <div className="billing-page-header">
        {(isAdmin || isTrial || isActive) && <button type="button" className="ghost-button" onClick={onBack}><ArrowLeft size={17} /> Back to recovery</button>}
        <button type="button" className="ghost-button" onClick={() => void onLogout()}><LogOut size={17} /> Logout</button>
        <div className="brand-mark"><ShieldCheck size={27} /></div><div className="eyebrow">JAZZ SECURE RECOVERY</div>
        <h1>Subscription</h1><p className="auth-subtitle">Secure access plans for Jazz Recovery.</p>
      </div>
      {loading && <div className="billing-message"><RefreshCw className="spin" size={16} /> Loading subscription…</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="billing-success" role="status"><CheckCircle2 size={18} /> {message}</div>}

      {status && <>
        <section className="billing-status-card">
          <div className="billing-status-title"><div><span className="eyebrow">CURRENT ACCESS</span><h2>{isTrialPending ? "Your trial has not started" : isTrial ? "Recovery access active" : isActive ? "Subscription active" : "Subscription required"}</h2></div>{isActive || isTrial ? <CheckCircle2 size={25} /> : <Clock3 size={25} />}</div>
          <div className="billing-meta">
            <div><span>Access type</span><strong>{isAdmin ? "Billing administrator" : isTrial ? "Active access" : isActive ? `${status.subscription?.plan_type || "Paid"} plan` : "Expired"}</strong></div>
            <div><span>Subscription ends</span><strong>{formatDate(status.subscription?.expires_at)}</strong></div>
            <div><span>Payment status</span><strong>{status.pendingPayment?.status || (isActive ? "Verified active" : "No verified payment")}</strong></div>
          </div>
        </section>
        {isTrialPending && <section className="billing-section"><h2>Trial scheduled</h2><p>Your trial is scheduled to begin on {formatDate(status.trial?.startsAt)}. Subscription options will become available after the trial period ends.</p></section>}
        {!isAdmin && !isTrial && !isActive && !isTrialPending && <>
          <h2 className="billing-section-title">Choose your plan</h2>
          <div className="billing-plan-grid">
            <button type="button" className={`billing-plan ${selectedPlan === "monthly" ? "selected" : ""}`} onClick={() => { setSelectedPlan("monthly"); setDiscount(null); }} aria-pressed={selectedPlan === "monthly"}>
              <span className="eyebrow">MONTHLY</span><strong>{money(status.plans.monthly)}</strong><span>Per month · billed monthly</span><small>Flexible monthly access</small>
            </button>
            <button type="button" className={`billing-plan featured ${selectedPlan === "annual" ? "selected" : ""}`} onClick={() => setSelectedPlan("annual")} aria-pressed={selectedPlan === "annual"}>
              <span className="eyebrow">YEARLY</span><strong>{money(status.plans.annual)}</strong><span>12 months · billed annually</span><small>Best value for continued access</small>
            </button>
          </div>
          {selectedPlan === "annual" && <section className="billing-section"><h2><Ticket size={18} /> Annual discount code</h2>
            <form className="billing-code-form" onSubmit={validateDiscount}><label><span>Discount code</span><input value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setDiscount(null); }} placeholder="Enter annual discount code" autoComplete="off" /></label><button className="secondary-button" type="submit" disabled={busy || !code.trim()}>Validate code</button></form>
            {discount && <div className="billing-success"><CheckCircle2 size={17} /> {discount.percentOff}% discount applied. {money(originalAnnual)} → {money(discount.amountPaise)}</div>}
          </section>}
          <section className="billing-checkout"><div><span className="eyebrow">AMOUNT DUE</span><strong>{money(checkoutAmount)}</strong><small>{selectedPlan === "annual" && discount ? `${discount.percentOff}% annual discount · ${discount.label}` : selectedPlan === "annual" ? "Annual plan" : "Monthly plan"}</small></div>
            <button type="button" className="primary-button" onClick={() => void pay()} disabled={busy}><CreditCard size={18} /> {busy ? "Please wait…" : "Payment"}</button>
          </section>
          <p className="billing-note">Payment opens the matching Razorpay payment link. Your subscription will not activate from a button click or browser return; server-side payment verification is required. Discounted annual payments remain pending until dynamic checkout is configured.</p>
        </>}
      </>}



      {isAdmin && <section className="billing-admin">
        <div className="billing-section"><span className="eyebrow">ADMINISTRATION</span><h2>Discount codes</h2><p>Create annual-only discounts. A 100% code is not permitted.</p>
          <form className="discount-form" onSubmit={createCode}>
            <label>Code (optional)<input value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="Auto-generate" maxLength={40} /></label>
            <label>Display label<input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Annual promotion" maxLength={100} required /></label>
            <label>Discount<select value={newPercent} onChange={e => setNewPercent(e.target.value)}><option value="10">10%</option><option value="20">20%</option><option value="50">50%</option></select></label>
            <label className="billing-checkbox-label"><input type="checkbox" checked={newActive} onChange={e => setNewActive(e.target.checked)} /> Enable immediately</label>
            <label>Valid from<input type="datetime-local" value={newStarts} onChange={e => setNewStarts(e.target.value)} /></label>
            <label>Expires at<input type="datetime-local" value={newExpires} onChange={e => setNewExpires(e.target.value)} /></label>
            <label>Eligible trial starts from<input type="datetime-local" value={trialFrom} onChange={e => setTrialFrom(e.target.value)} /></label>
            <label>Eligible trial starts until<input type="datetime-local" value={trialUntil} onChange={e => setTrialUntil(e.target.value)} /></label>
            <label>Maximum redemptions<input type="number" min="1" value={maxRedemptions} onChange={e => setMaxRedemptions(e.target.value)} placeholder="Unlimited" /></label>
            <label>Per-account limit<input type="number" min="1" value={perUserLimit} onChange={e => setPerUserLimit(e.target.value)} /></label>
            <button className="primary-button" type="submit" disabled={busy}>Create annual code</button>
          </form>
          <label className="billing-search">Search discount codes<input value={codeSearch} onChange={e => setCodeSearch(e.target.value)} placeholder="Search code label" /></label>
          <div className="discount-list">{filteredCodes.map(item => <div className="discount-row" key={item.id}><span><strong>{item.label}</strong><small>{item.percent_off}% · Annual · {item.redeemed_count}{item.max_redemptions == null ? "" : `/${item.max_redemptions}`} used · {item.active ? "Enabled" : "Disabled"} · {item.expires_at && new Date(item.expires_at).getTime() <= Date.now() ? "Expired" : "Not expired"} · Expires {formatDate(item.expires_at)}</small></span><div className="billing-inline-actions"><button className="secondary-button" type="button" onClick={() => setEditingCode(item)}>Edit</button><button className="secondary-button" type="button" onClick={() => void showCodeUsage(item)}>Usage</button><button className="secondary-button" type="button" onClick={() => void codeAction(item, item.active ? "disable" : "enable")}>{item.active ? "Disable" : "Enable"}</button><button className="secondary-button danger-button" type="button" onClick={() => void codeAction(item, "delete")}><Trash2 size={14} /> Delete</button></div></div>)}</div>
          {codeUsage && <div className="billing-ledger-row"><strong>Discount usage</strong>{codeUsage.items.length ? codeUsage.items.map(use => <span key={use.id}>{use.username} · {money(use.amount_paid_paise)} · {formatDate(use.created_at)}</span>) : <span>No redemptions recorded for this code.</span>}<button className="secondary-button" type="button" onClick={() => setCodeUsage(null)}>Close usage</button></div>}
          {editingCode && <form className="billing-edit-form" onSubmit={saveCode}><h3>Edit {editingCode.label}</h3>
            <label>Replace code (optional)<input value={replacementCode} onChange={e => setReplacementCode(e.target.value.toUpperCase())} placeholder="Leave blank to keep current code" maxLength={40} /></label>
            <label>Label<input value={editingCode.label} onChange={e => setEditingCode({...editingCode,label:e.target.value})} /></label>
            <label>Discount<select value={editingCode.percent_off} onChange={e => setEditingCode({...editingCode,percent_off:Number(e.target.value)})}><option value={10}>10%</option><option value={20}>20%</option><option value={50}>50%</option></select></label>
            <label>Valid from<input type="datetime-local" value={toLocalInput(editingCode.starts_at)} onChange={e => setEditingCode({...editingCode,starts_at:fromLocalInput(e.target.value) || editingCode.starts_at})} /></label>
            <label>Expires at<input type="datetime-local" value={toLocalInput(editingCode.expires_at)} onChange={e => setEditingCode({...editingCode,expires_at:fromLocalInput(e.target.value)})} /></label>
            <label>Trial starts from<input type="datetime-local" value={toLocalInput(editingCode.trial_eligible_from)} onChange={e => setEditingCode({...editingCode,trial_eligible_from:fromLocalInput(e.target.value)})} /></label>
            <label>Trial starts until<input type="datetime-local" value={toLocalInput(editingCode.trial_eligible_until)} onChange={e => setEditingCode({...editingCode,trial_eligible_until:fromLocalInput(e.target.value)})} /></label>
            <label>Maximum redemptions<input type="number" min={editingCode.redeemed_count} value={editingCode.max_redemptions ?? ""} onChange={e => setEditingCode({...editingCode,max_redemptions:e.target.value === "" ? null : Number(e.target.value)})} /></label>
            <label>Per-account limit<input type="number" min="1" value={editingCode.per_user_limit} onChange={e => setEditingCode({...editingCode,per_user_limit:Number(e.target.value)})} /></label>
            <div className="billing-inline-actions"><button className="primary-button" type="submit" disabled={busy}>Save changes</button><button className="secondary-button" type="button" onClick={() => {setEditingCode(null);setReplacementCode("");}}>Cancel</button></div>
          </form>}
        </div>

        <div className="billing-section billing-ledger"><h2>Trial and subscription ledger</h2><p>PostgreSQL account history and administrator-edited access dates.</p><label className="billing-search">Search users<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search username" /></label>
          <div className="billing-ledger-list">{filteredLedger.map(item => <article className="billing-ledger-row" key={item.user_id}><strong>{item.username}</strong><span>Trial: {formatDate(item.trial_started_at)} → {formatDate(item.trial_ends_at)} · {item.trial_active ? "Active" : "Inactive"}</span><span>Subscription: {item.subscription_plan || "None"} · {item.subscription_status || "None"} · {formatDate(item.subscription_ends_at)}</span><span>Pending payment intents: {item.pending_payments}</span><div className="billing-inline-actions"><button className="secondary-button" type="button" onClick={() => setEditingLedger(item)}>Edit access</button><button className="secondary-button danger-button" type="button" onClick={() => {setDeleteTarget(item);setDeleteConfirmation("");}}>Delete user</button></div></article>)}</div>
          {editingLedger && <form className="billing-edit-form" onSubmit={saveLedger}><h3>Edit access: {editingLedger.username}</h3>
            <label>Trial starts<input type="datetime-local" value={toLocalInput(editingLedger.trial_started_at)} onChange={e => setEditingLedger({...editingLedger,trial_started_at:fromLocalInput(e.target.value)})} /></label>
            <label>Trial expires<input type="datetime-local" value={toLocalInput(editingLedger.trial_ends_at)} onChange={e => setEditingLedger({...editingLedger,trial_ends_at:fromLocalInput(e.target.value)})} /></label>
            {editingLedger.subscription_id && <><label>Subscription status<select value={editingLedger.subscription_status || "expired"} onChange={e => setEditingLedger({...editingLedger,subscription_status:e.target.value})}><option value="active">Active</option><option value="expired">Expired</option><option value="refunded">Refunded</option></select></label><label>Plan<select value={editingLedger.subscription_plan || "annual"} onChange={e => setEditingLedger({...editingLedger,subscription_plan:e.target.value as Plan})}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label><label>Subscription starts<input type="datetime-local" value={toLocalInput(editingLedger.subscription_started_at)} onChange={e => setEditingLedger({...editingLedger,subscription_started_at:fromLocalInput(e.target.value)})} /></label><label>Subscription expires<input type="datetime-local" value={toLocalInput(editingLedger.subscription_ends_at)} onChange={e => setEditingLedger({...editingLedger,subscription_ends_at:fromLocalInput(e.target.value)})} /></label></>}
            <div className="billing-inline-actions"><button className="primary-button" type="submit" disabled={busy}>Save access changes</button><button className="secondary-button" type="button" onClick={() => setEditingLedger(null)}>Cancel</button></div>
          </form>}
          {deleteTarget && <form className="billing-edit-form delete-confirm" onSubmit={deleteUser}><h3>Permanent account deletion</h3><p>This removes the account and PostgreSQL records linked by cascading foreign keys. This cannot be undone. Protected administrator accounts cannot be deleted here.</p><label>Type <strong>{deleteTarget.username}</strong> to confirm<input value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} required /></label><div className="billing-inline-actions"><button className="primary-button danger-button" type="submit" disabled={busy || deleteConfirmation !== deleteTarget.username}>Permanently delete user</button><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)}>Cancel</button></div></form>}
        </div>
        <div className="billing-section"><h2>Payment intents</h2><p>Pending payments are not treated as active subscriptions.</p><div className="billing-ledger-list">{payments.map(item => <div className="billing-ledger-row" key={item.id}><strong>{item.username} · {item.plan_type}</strong><span>{money(item.amount_paise)} · {item.status} · {formatDate(item.created_at)}</span><small>{item.id}</small></div>)}</div></div>
        <div className="billing-section"><h2>Subscription history</h2><div className="billing-ledger-list">{subscriptionHistory.map(item => <div className="billing-ledger-row" key={item.id}><strong>{item.username} · {item.plan_type}</strong><span>{item.status} · {money(item.amount_paid_paise)} · {formatDate(item.starts_at)} → {formatDate(item.expires_at)}</span><small>{item.id}</small></div>)}</div></div>
        <div className="billing-section"><h2>Verified payment history</h2><div className="billing-ledger-list">{paymentHistory.map(item => <div className="billing-ledger-row" key={item.id}><strong>{item.username} · {item.plan_type}</strong><span>{item.status} · {money(item.amount_paise)} · {formatDate(item.created_at)}</span><small>Payment {item.payment_id || "not assigned"} · Order {item.order_id}</small></div>)}</div></div>
        <div className="billing-section"><h2>Administrative audit log</h2><div className="billing-ledger-list">{audit.map(item => <div className="billing-ledger-row" key={item.id}><strong>{item.action}</strong><span>Administrator {item.actor_user_id ?? "system"} · {formatDate(item.created_at)}</span><small>{JSON.stringify(item.details)}</small></div>)}</div></div>
      </section>}
      <footer className="site-footer billing-footer"><span className="footer-brand">Jazz Device Recovery</span><span className="developer-credit">Developed by <span className="developer-name">gunakarna</span></span></footer>
    </section>
  </main>;
}
