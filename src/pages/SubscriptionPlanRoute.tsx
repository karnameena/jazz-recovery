import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../services/api";
import { BillingPage } from "../components/billing/BillingPage";
import { PublicSubscriptionPlan } from "./PublicSubscriptionPlan";

type RouteView = "loading" | "public" | "account-billing";

export function SubscriptionPlanRoute() {
  const [view, setView] = useState<RouteView>("loading");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    async function resolveView() {
      try {
        await api("/api/auth/session");
        if (!active) return;
        setSignedIn(true);
        const billing = await api("/api/billing/status");
        if (!active) return;
        const needsBilling = billing.access === "expired" || billing.access === "trial_pending" || Boolean(billing.isBillingAdmin || billing.isOwnerAdmin);
        setView(needsBilling ? "account-billing" : "public");
      } catch {
        if (active) setView("public");
      }
    }
    void resolveView();
    return () => { active = false; };
  }, []);

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); }
    finally { window.location.assign("/"); }
  }

  if (view === "loading") return <div className="loading-screen"><RefreshCw className="spin" /> Loading subscription plans…</div>;
  if (view === "account-billing") return <BillingPage onBack={() => window.location.assign("/")} onLogout={logout} />;
  return <PublicSubscriptionPlan signedIn={signedIn} />;
}
