import { Camera, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api";

type UnlockCaptureControlProps = { deviceId: number };

type SettingResponse = { ok?: boolean; enabled?: boolean; triggerAttempts?: number };

export function UnlockCaptureControl({ deviceId }: UnlockCaptureControlProps) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadSetting = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = (await api(`/api/devices/${deviceId}/unlock-capture`)) as SettingResponse;
      setEnabled(result.enabled === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load setting");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void loadSetting();
  }, [loadSetting]);

  async function toggleSetting() {
    if (loading || saving) return;
    if (error) {
      await loadSetting();
      return;
    }
    const next = !enabled;
    setSaving(true);
    setError("");
    try {
      const result = (await api(`/api/devices/${deviceId}/unlock-capture`, {
        method: "PUT",
        body: JSON.stringify({ enabled: next, triggerAttempts: 2 }),
      })) as SettingResponse;
      setEnabled(result.enabled === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save setting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      className={`unlock-capture-control${enabled ? " is-enabled" : ""}`}
      role="switch"
      aria-checked={enabled}
      aria-busy={loading || saving}
      disabled={loading || saving}
      onClick={() => void toggleSetting()}
      title={error || "Requires Device Admin approval and Recovery Readiness to be active on the paired phone. Captures after two consecutive failed unlock attempts."}
    >
      {loading || saving ? <RefreshCw className="unlock-capture-loading" /> : <Camera />}
      <div>
        <strong>Unlock Capture</strong>
        <span>{error ? "Setting unavailable · retry" : loading ? "Checking setting…" : saving ? "Saving…" : enabled ? "ON · 2 failed attempts" : "OFF"}</span>
      </div>
      <span className="unlock-capture-switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
