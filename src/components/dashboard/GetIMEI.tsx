import { useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { api } from "../../services/api";

type GetIMEIProps = { deviceId: number };

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable in this browser.");
}

export function GetIMEI({ deviceId }: GetIMEIProps) {
  const [visible, setVisible] = useState(false);
  const [imei, setImei] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function toggleIMEI() {
    if (visible) {
      setVisible(false);
      setImei("");
      setCopied(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api(`/api/devices/${deviceId}/imei`);
      if (!result.imei) throw new Error("IMEI is not available for this device.");
      setImei(String(result.imei));
      setVisible(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retrieve IMEI.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await copyText(imei);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy IMEI.");
    }
  }

  return (
    <div className="get-imei-action">
      <button type="button" onClick={() => void toggleIMEI()} disabled={loading}>
        {loading ? <RefreshCw className="spin" /> : visible ? <EyeOff /> : <Eye />}
        <div>
          <strong>{visible ? "Hide IMEI" : "Get IMEI"}</strong>
          <span>{loading ? "Retrieving securely…" : visible ? "Hide device identifier" : "Reveal paired device IMEI"}</span>
        </div>
      </button>
      {visible && (
        <div className="imei-reveal" aria-live="polite">
          <span className="imei-value">{imei}</span>
          <button type="button" className="imei-copy-button" onClick={() => void handleCopy()} aria-label="Copy IMEI">
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {error && <p className="imei-feedback" role="alert">{error}</p>}
    </div>
  );
}
