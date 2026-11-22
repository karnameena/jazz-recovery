import { useState, type FormEvent } from "react";
import { api } from "../services/api";
import { clearOwnerRecoveryCache } from "../services/recovery-cache";

export function AccountDeletion() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(""); setMessage("");
    if (!confirm) { setError("Please confirm that you understand this action is permanent."); return; }
    setBusy(true);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      await api("/api/auth/account", { method: "DELETE" });
      await clearOwnerRecoveryCache(username).catch(() => {});
      setMessage("Your Jazz Recovery account deletion has been completed. Your account and associated server-side device records have been deleted. Clear browser data on any other device where you used Jazz Recovery to remove locally cached recovery information.");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not complete your deletion request. Please try again or contact support.");
    } finally { setBusy(false); }
  }

  return <main className="legal-page">
    <header className="legal-header"><a className="legal-brand" href="/">Jazz Recovery</a><nav><a href="/privacy-policy">Privacy Policy</a><a href="/delete-account" aria-current="page">Delete Account</a><a href="/">Website</a></nav></header>
    <article className="legal-card deletion-card">
      <p className="legal-eyebrow">JAZZ RECOVERY · ACCOUNT CONTROL</p><h1>Delete your account</h1>
      <p className="legal-lead">You can permanently delete your Jazz Recovery account here, even if you have uninstalled the Android app. Use the credentials for the account you registered on the Jazz Recovery website.</p>
      <div className="deletion-warning"><strong>This action cannot be undone.</strong><p>After verification, your account, registered device associations, credentials, sessions and associated server-side records will be deleted. You will need to register again to use Jazz Recovery.</p></div>
      <h2>What about data on this browser?</h2>
      <p>Recovery photos and cached location results may be held in this browser's IndexedDB. Server-side account deletion cannot remotely erase browser storage on every device. After deletion, clear this browser's site data for jazzrecovery.com and, if you previously used it, jazz-recovery.pages.dev on each browser/device you used.</p>
      <form onSubmit={submit} className="deletion-form">
        <label>Registered username<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required maxLength={64}/></label>
        <label>Account password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={512}/></label>
        <label className="deletion-confirm"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> I understand that account deletion is permanent.</label>
        {error && <p className="legal-error" role="alert">{error}</p>}
        {message && <p className="legal-success" role="status">{message}</p>}
        <button type="submit" disabled={busy}>{busy ? "Deleting account…" : "Verify and permanently delete account"}</button>
      </form>
      <p className="legal-contact">Need help? <a href="mailto:gunakarna33@gmail.com">gunakarna33@gmail.com</a></p>
    </article>
    <footer className="legal-footer">© {new Date().getFullYear()} Jazz Recovery · <a href="/privacy-policy">Privacy Policy</a></footer>
  </main>;
}
