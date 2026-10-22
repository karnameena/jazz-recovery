import React, { useCallback, useEffect, useState } from "react";
import { CreditCard, RefreshCw, TicketPercent, ShieldCheck } from "lucide-react";

type Api = (path: string, options?: RequestInit) => Promise<any>;
type Subscription = { status: string; startsAt?: string; endsAt?: string; amountPaise?: number };
type Discount = { id: number; code_label: string; discount_percent: number; expires_at?: string | null; max_redemptions?: number | null; per_user_limit: number; redemption_count: number; is_active: boolean };

declare global {
  interface Window {
    Razorpay?: new (options: {
      key: string; amount: number; currency: string; name: string; description: string; order_id: string;
      handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
      modal?: { ondismiss?: () => void };
      theme?: { color: string };
    }) => { open: () => void };
  }
}

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
const when = (value?: string) => value ? new Date(value).toLocaleString() : "No expiry";

export function SubscriptionPanel({ api }: { api: Api }) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState<{ discountPercent: number; amountPaise: number; savingsPaise: number } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [codes, setCodes] = useState<Discount[]>([]);
  const [label, setLabel] = useState("");
  const [newCode, setNewCode] = useState("");
  const [percent, setPercent] = useState("10");
  const [expiry, setExpiry] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");

  const refresh = useCallback(async () => {
    const data = await api("/api/subscription");
    setSubscription(data.subscription);
  }, [api]);

  const loadAdmin = useCallback(async () => {
    try {
      const data = await api("/api/admin/discount-codes");
      setCodes(data.items || []);
      setAdmin(true);
    } catch {
      setAdmin(false);
    }
  }, [api]);

  useEffect(() => { void refresh().catch(() => {}); void loadAdmin(); }, [refresh, loadAdmin]);

  async function validateCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/billing/discount/validate", { method: "POST", body: JSON.stringify({ code }) });
      setDiscount({ discountPercent: result.discountPercent, amountPaise: result.amountPaise, savingsPaise: result.savingsPaise });
      setMessage(`Code accepted: ${result.discountPercent}% off. You pay ${money(result.amountPaise)}.`);
    } catch (error) {
      setDiscount(null);
      setMessage(error instanceof Error ? error.message : "Could not validate the code.");
    } finally { setBusy(false); }
  }

  async function subscribe() {
    setBusy(true);
    setMessage("");
    try {
      const order = await api("/api/billing/order", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      if (order.complimentary) {
        setMessage("Your complimentary annual access is active.");
        setDiscount(null);
        await refresh();
        return;
      }
      if (!window.Razorpay) throw new Error("Secure checkout did not load. Refresh the page and try again.");
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "Jazz Recovery",
        description: "Annual subscription",
        order_id: order.orderId,
        theme: { color: "#6f8cff" },
        handler: async response => {
          setBusy(true);
          try {
            await api("/api/billing/verify", { method: "POST", body: JSON.stringify(response) });
            setMessage("Payment verified. Your annual subscription is active.");
            setCode("");
            setDiscount(null);
            await refresh();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Payment verification is pending. Do not pay again yet.");
          } finally { setBusy(false); }
        },
        modal: { ondismiss: () => setMessage("Checkout closed. No access is granted until payment is verified.") }
      });
      checkout.open();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start checkout.");
    } finally { setBusy(false); }
  }

  async function createCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/discount-codes", {
        method: "POST",
        body: JSON.stringify({
          code: newCode,
          label: label || `${percent}% promotion`,
          discountPercent: Number(percent),
          expiresAt: expiry ? new Date(expiry).toISOString() : null,
          maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
          perUserLimit: 1
        })
      });
      setMessage("Discount code created. The secret code is stored as a hash and cannot be retrieved later.");
      setNewCode(""); setLabel(""); setExpiry(""); setMaxRedemptions("");
      await loadAdmin();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create discount code.");
    } finally { setBusy(false); }
  }

  async function disableCode(id: number) {
    setBusy(true);
    try {
      await api(`/api/admin/discount-codes/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
      setMessage("Code disabled for future redemptions. Existing entitlements are unchanged.");
      await loadAdmin();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disable the code.");
    } finally { setBusy(false); }
  }

  const active = subscription?.status === "trialing" || subscription?.status === "active" || subscription?.status === "complimentary";
  return (
    <section className="subscription-panel glass-panel">
      <div className="subscription-heading">
        <div><div className="eyebrow">ACCOUNT PLAN</div><h2>Trial & subscription</h2></div>
        <span className={active ? "subscription-status active" : "subscription-status"}>{subscription?.status || "Loading"}</span>
      </div>
      <div className="subscription-details">
        {subscription?.status === "trialing" ? <p>Your 7-day free trial ends <strong>{when(subscription.endsAt)}</strong>.</p>
          : subscription?.status === "active" || subscription?.status === "complimentary" ? <p>Annual access ends <strong>{when(subscription.endsAt)}</strong>.</p>
          : <p>Your trial or subscription has ended. Renew for annual access.</p>}
        <p>Annual plan: <strong>₹499/year</strong>. Gateway fees are absorbed by Jazz Recovery; they are not added to the customer price.</p>
      </div>
      <form className="subscription-code-form" onSubmit={validateCode}>
        <label><span>Discount code</span><input value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setDiscount(null); }} placeholder="Enter your code" maxLength={64} autoComplete="off" /></label>
        <button className="secondary-button" type="submit" disabled={busy || !code.trim()}><TicketPercent size={17} /> Apply code</button>
      </form>
      {discount && <p className="subscription-price">Pay <strong>{money(discount.amountPaise)}</strong> · Save {money(discount.savingsPaise)}</p>}
      <button className="primary-button" type="button" onClick={() => void subscribe()} disabled={busy}><CreditCard size={17} /> {busy ? "Please wait…" : "Subscribe / Redeem code"}</button>
      {message && <p className="subscription-message" role="status">{message}</p>}
      <p className="auth-hint"><ShieldCheck size={15} /> Payments are activated only after server-side verification. Renewals are manual; no automatic charging.</p>

      {admin && <div className="discount-admin">
        <div className="eyebrow">OWNER CONTROLS</div><h3>Discount code management</h3>
        <form className="discount-admin-form" onSubmit={createCode}>
          <label><span>Secret code</span><input value={newCode} onChange={event => setNewCode(event.target.value.toUpperCase())} minLength={4} maxLength={64} pattern="[A-Z0-9_-]{4,64}" placeholder="e.g. JAZZ-FAMILY" required /></label>
          <label><span>Label (not secret)</span><input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} placeholder="Family access" /></label>
          <label><span>Discount</span><select value={percent} onChange={event => setPercent(event.target.value)}><option value="10">10% off</option><option value="20">20% off</option><option value="50">50% off</option><option value="100">100% complimentary</option></select></label>
          <label><span>Expiry (optional)</span><input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>
          <label><span>Maximum redemptions (optional)</span><input type="number" min="1" max="1000000" value={maxRedemptions} onChange={event => setMaxRedemptions(event.target.value)} placeholder="Unlimited" /></label>
          <button className="primary-button" type="submit" disabled={busy}>Create discount code</button>
        </form>
        <p className="auth-hint">To rotate a code, create the replacement first, then disable the old code. Existing annual entitlements remain valid.</p>
        <div className="discount-code-list">{codes.map(item => <div className="discount-code-row" key={item.id}>
          <div><strong>{item.code_label}</strong><span>{item.discount_percent}% off · {item.redemption_count}{item.max_redemptions ? `/${item.max_redemptions}` : ""} redemptions</span><small>{item.expires_at ? `Expires ${when(item.expires_at)}` : "No expiry set"}</small></div>
          <span className={item.is_active ? "subscription-status active" : "subscription-status"}>{item.is_active ? "Active" : "Disabled"}</span>
          {item.is_active && <button className="secondary-button" type="button" disabled={busy} onClick={() => void disableCode(item.id)}>Disable</button>}
        </div>)}</div>
      </div>}
    </section>
  );
}
