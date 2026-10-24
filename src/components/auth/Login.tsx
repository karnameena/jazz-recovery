import React, { useRef, useState } from "react";
import { LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../../services/api";
import { base64UrlToBytes, serializeCredential } from "../../services/passkeys";

export function Login({ done }: { done: () => void }) {
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
        await api("/api/auth/register", { method: "POST", body });
      } else {
        const body = JSON.stringify({ username, password });
        password = "";
        if (passwordRef.current) passwordRef.current.value = "";
        await api("/api/auth/login", { method: "POST", body });
      }
      try {
        await api("/api/auth/session");
      } catch {
        throw new Error(
          "Sign-in was accepted, but the browser session could not be confirmed. Use the same host for the website and API, and enable the local Vite API proxy before trying again.",
        );
      }
      form.reset();
      done();
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
