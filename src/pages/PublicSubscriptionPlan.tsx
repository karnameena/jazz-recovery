import { ArrowLeft, CreditCard, ShieldCheck } from "lucide-react";

const plans = [
  { id: "monthly", name: "MONTHLY", price: "₹49", billing: "Per month · billed monthly", detail: "Flexible monthly access" },
  { id: "annual", name: "YEARLY", price: "₹399", billing: "12 months · billed annually", detail: "Best value for continued access", featured: true },
];

export function PublicSubscriptionPlan({ signedIn = false }: { signedIn?: boolean }) {
  return <main className="billing-shell">
    <div className="ambient ambient-one" />
    <div className="ambient ambient-two" />
    <section className="billing-page glass-panel public-subscription-page">
      <header className="billing-page-header">
        <a className="ghost-button public-subscription-back" href="/">
          <ArrowLeft size={17} /> {signedIn ? "Back to recovery" : "Back to Jazz Recovery"}
        </a>
        <div className="brand-mark"><ShieldCheck size={27} /></div>
        <div className="eyebrow">JAZZ SECURE RECOVERY</div>
        <h1>Subscription Plans</h1>
        <p className="auth-subtitle">Choose a plan for continued access to Jazz Recovery.</p>
      </header>

      <h2 className="billing-section-title">Choose your plan</h2>
      <div className="billing-plan-grid public-billing-plan-grid">
        {plans.map((plan) => <article className={`billing-plan public-billing-plan${plan.featured ? " featured" : ""}`} key={plan.id}>
          <span className="eyebrow">{plan.name}</span>
          <strong>{plan.price}</strong>
          <span>{plan.billing}</span>
          <small>{plan.detail}</small>
        </article>)}
      </div>

      <section className="billing-section public-subscription-info">
        <h2><CreditCard size={19} /> Secure subscription payment</h2>
        <p>Payments are available to registered Jazz Recovery account holders. Sign in to continue to the existing secure checkout and payment-verification process.</p>
        <p className="billing-note">Annual discount codes, when provided, can be validated after signing in. A subscription is activated only after payment is verified by the server.</p>
        <a className="primary-button public-subscription-cta" href="/">{signedIn ? "Return to dashboard" : "Sign in to subscribe"}</a>
      </section>

      <footer className="site-footer billing-footer">
        <span className="footer-brand">Jazz Device Recovery</span>
        <span className="developer-credit">Developed by <span className="developer-name">gunakarna</span></span>
        <nav className="public-subscription-footer-links" aria-label="Legal links">
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/delete-account">Delete Account</a>
        </nav>
      </footer>
    </section>
  </main>;
}
