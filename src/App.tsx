import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./services/api";
import { Login } from "./components/auth/Login";
import { DashboardHeader } from "./components/dashboard/DashboardHeader";
import { DeviceSidebar } from "./components/dashboard/DeviceSidebar";
import { DeviceHero } from "./components/dashboard/DeviceHero";
import { LocationCard } from "./components/dashboard/LocationCard";
import { RecoveryPhotoCard } from "./components/dashboard/RecoveryPhotoCard";
import { RecoveryActionGrid } from "./components/dashboard/RecoveryActionGrid";
import { LocationServicesCard } from "./components/dashboard/LocationServicesCard";
import type { Device, LocationState } from "./types/device";
import { base64UrlToBytes, serializeCredential } from "./services/passkeys";
import { RefreshCw, Smartphone } from "lucide-react";
import { VoiceInput } from "./voice/VoiceInput";

function formatTime(value: string | number | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function mapEmbedUrl(location: LocationState) {
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  const spread = 0.006;
  const bbox = [lon - spread, lat - spread, lon + spread, lat + spread].join(
    ",",
  );
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
}

function googleMapsUrl(location: LocationState) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
}

function downloadText(filename: string, value: string) {
  const blob = new Blob([value], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function actionKey(name: string, args: Record<string, unknown> = {}) {
  if (name === "RECOVERY_PHOTO")
    return `${name}:${args.camera === "rear" ? "rear" : "front"}`;
  return name;
}

export function App() {
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [msg, setMsg] = useState("");
  const [activeCount, setActiveCount] = useState(0);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState("");

  const actionLocks = useRef(new Set<string>());

  async function registerPasskey() {
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("This browser does not support passkeys.");
      const challenge = await api("/api/auth/passkey/register/options", { method: "POST", body: JSON.stringify({}) });
      const options = challenge.options;
      const credential = await navigator.credentials.create({ publicKey: {
        ...options,
        challenge: base64UrlToBytes(options.challenge),
        user: { ...options.user, id: base64UrlToBytes(options.user.id) },
        excludeCredentials: (options.excludeCredentials || []).map((item: { id: string; transports?: AuthenticatorTransport[]; type?: PublicKeyCredentialType }) => ({ ...item, id: base64UrlToBytes(item.id) }))
      } as PublicKeyCredentialCreationOptions }) as PublicKeyCredential | null;
      if (!credential) throw new Error("Passkey registration was cancelled.");
      await api("/api/auth/passkey/register/verify", { method: "POST", body: JSON.stringify({ flowId: challenge.flowId, response: serializeCredential(credential) }) });
      setMsg("Passkey registered successfully. You can use it to reset your password.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not register passkey.");
    }
  }

  async function load() {
    const data = await api("/api/devices");
    const items: Device[] = data.items || [];
    setDevices(items);
    if (!selected && items.length) setSelected(items[0].id);
  }

  async function refresh(id = selected) {
    if (!id) return null;
    const data = await api(`/api/devices/${id}`);
    setDevice(data.device);
    return data.device as Device;
  }


  useEffect(() => {
    api("/api/auth/session")
      .then(() => setLogin(true))
      .catch(() => setLogin(false))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!login) return;
    void load().catch((error) => {
      const message = error instanceof Error ? error.message : "Could not load devices.";
      if (/authentication required/i.test(message)) {
        setLogin(false);
        setDevices([]);
        setDevice(null);
        setMsg("Your session is no longer valid. Please sign in again.");
      } else {
        setMsg(message);
      }
    });
  }, [login]);
  useEffect(() => {
    if (!login || !selected) return;
    void refresh(selected).catch((error) => {
      const message = error instanceof Error ? error.message : "Could not refresh the selected device.";
      if (/authentication required/i.test(message)) {
        setLogin(false);
        setDevices([]);
        setDevice(null);
        setMsg("Your session is no longer valid. Please sign in again.");
      } else {
        setMsg(message);
      }
    });
  }, [login, selected]);
  useEffect(() => {
    if (!login || !selected) return;
    const timer = window.setInterval(() => {
      void refresh(selected).catch(() => {});
      void load().catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [login, selected]);

  function isActionBusy(name: string, args: Record<string, unknown> = {}) {
    return actionLocks.current.has(actionKey(name, args));
  }

  async function action(name: string, args: Record<string, unknown> = {}) {
    if (!selected) return;
    const key = actionKey(name, args);
    if (actionLocks.current.has(key)) {
      setMsg(
        "That recovery request is already in progress. Jazz will refresh the latest result automatically.",
      );
      return;
    }

    const selectedAtStart = selected;
    const beforeLocation = String(device?.location?.timestamp ?? "");
    const beforePhoto = `${device?.photo?.camera ?? ""}:${String(device?.photo?.timestamp ?? "")}`;
    const beforeMode = device?.mode || "";

    actionLocks.current.add(key);
    setActiveCount(actionLocks.current.size);
    setMsg("Sending secure recovery request…");

    try {
      const data = await api(`/api/devices/${selectedAtStart}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: name, args }),
      });
      setMsg(
        data.deduplicated
          ? "A matching recovery request is already queued. Waiting for the latest result…"
          : "Recovery request sent. Waiting for the device…",
      );

      const maxAttempts =
        name === "GET_LOCATION" || name === "RECOVERY_PHOTO" ? 36 : 10;
      for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        const latest = await refresh(selectedAtStart).catch(() => null);
        if (!latest) continue;
        if (attempts % 3 === 0) void load().catch(() => {});

        if (name === "GET_LOCATION") {
          const now = String(latest.location?.timestamp ?? "");
          if (now && now !== beforeLocation) {
            setMsg("Latest location received and map updated.");
            break;
          }
        } else if (name === "RECOVERY_PHOTO") {
          const wanted = args.camera === "rear" ? "rear" : "front";
          const now = `${latest.photo?.camera ?? ""}:${String(latest.photo?.timestamp ?? "")}`;
          if (latest.photo?.camera === wanted && now !== beforePhoto) {
            setMsg(
              `${wanted === "rear" ? "Back" : "Front"} camera recovery photo updated.`,
            );
            break;
          }
        } else if (name === "SET_RECOVERY_MODE" && latest.mode !== beforeMode) {
          setMsg("Lost Mode state updated.");
          break;
        } else if (attempts === maxAttempts - 1) {
          setMsg(
            "Recovery request sent. The page will continue refreshing automatically.",
          );
        }
      }
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Action failed");
    } finally {
      actionLocks.current.delete(key);
      setActiveCount(actionLocks.current.size);
    }
  }

  async function locationControl(enabled: boolean) {
    if (!selected || locationBusy) return;
    const selectedAtStart = selected;
    const desired = enabled ? "ON" : "OFF";
    setLocationBusy(true);
    setLocationFeedback(
      "Sending owner-authorized Location Services " + desired + " request…",
    );
    try {
      const queued = await api(`/api/devices/${selectedAtStart}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: enabled ? "LOCATION_ENABLE" : "LOCATION_DISABLE",
        }),
      });
      if (!queued.commandId)
        throw new Error("The Lost Mode server returned no command ID.");
      setLocationFeedback(
        queued.deduplicated
          ? "A matching request was already queued. Checking the phone's confirmed result…"
          : "Command queued. Awaiting confirmation from your paired Android Companion…",
      );
      let completed = false;
      for (let attempt = 0; attempt < 75; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        const data = await api(
          `/api/devices/${selectedAtStart}/commands/${encodeURIComponent(queued.commandId)}`,
        );
        if (
          data.confirmed &&
          data.status === "CONFIRMED" &&
          data.result?.locationServices === desired
        ) {
          setLocationFeedback(
            "Device confirmed: Location Services " + desired + ".",
          );
          await refresh(selectedAtStart);
          completed = true;
          break;
        }
        if (["FAILED", "EXPIRED"].includes(data.status)) {
          setLocationFeedback(
            "Command " +
              data.status +
              ": " +
              (data.result?.error ||
                data.result?.status ||
                "The device did not confirm the requested state."),
          );
          completed = true;
          break;
        }
        if (data.status === "DEVICE_OFFLINE" && attempt % 7 === 0) {
          setLocationFeedback(
            "Device offline. Command is queued, not successful; it will expire if the phone cannot reconnect.",
          );
        }
      }
      if (!completed)
        setLocationFeedback(
          "No device confirmation yet. The command may still be pending; refresh the device status to check.",
        );
    } catch (error) {
      setLocationFeedback(
        error instanceof Error
          ? error.message
          : "Location Services request failed.",
      );
    } finally {
      setLocationBusy(false);
    }
  }

  async function logout() {
    setVoiceOpen(false);
    actionLocks.current.clear();
    setActiveCount(0);
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(
      () => {},
    );
    setLogin(false);
    setDevices([]);
    setDevice(null);
  }

  async function setupRecoveryPin() {
    const password = window.prompt("Confirm your current Jazz Recovery password:");
    if (password == null || !password) return;
    const recoveryPin = window.prompt("Create a 4-digit recovery PIN:");
    if (recoveryPin == null) return;
    const confirmRecoveryPin = window.prompt("Re-enter your 4-digit recovery PIN:");
    if (confirmRecoveryPin == null) return;
    try {
      await api("/api/auth/recovery-pin", {
        method: "POST",
        body: JSON.stringify({ password, recoveryPin, confirmRecoveryPin }),
      });
      setMsg("Recovery PIN saved securely. You can use it if you forget your password.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not save recovery PIN.");
    }
  }

  async function shareLocation() {
    if (!device?.location) return;
    const url = googleMapsUrl(device.location);
    const text = `${device.deviceName || device.deviceId || "Jazz device"} last known location: ${device.location.latitude}, ${device.location.longitude}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Jazz Lost Mode Location", text, url });
        setMsg("Location shared.");
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setMsg("Location link copied to clipboard.");
      }
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError")
        setMsg("Could not share location on this browser.");
    }
  }

  function downloadReport() {
    if (!device) return;
    const report = {
      exportedAt: new Date().toISOString(),
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
      online: device.online,
      mode: device.mode,
      battery: device.battery,
      charging: device.charging,
      network: device.network,
      lastSeen: device.lastSeen,
      lastKnownLocation: device.location,
      latestRecoveryPhoto: device.photo
        ? {
            camera: device.photo.camera,
            timestamp: device.photo.timestamp,
            includedSeparately: true,
          }
        : null,
    };
    downloadText(
      `jazz-recovery-${device.deviceId || device.id}.json`,
      JSON.stringify(report, null, 2),
    );
    setMsg("Recovery report downloaded.");
  }

  const onlineCount = useMemo(
    () => devices.filter((item) => item.online).length,
    [devices],
  );

  if (!ready)
    return (
      <div className="loading-screen">
        <RefreshCw className="spin" /> Loading secure recovery…
      </div>
    );
  if (!login) return <Login done={() => setLogin(true)} />;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <DashboardHeader
        onlineCount={onlineCount}
        deviceCount={devices.length}
        selected={selected}
        load={load}
        refresh={refresh}
        registerPasskey={registerPasskey}
        setupRecoveryPin={setupRecoveryPin}
        logout={logout}
      />

      <div className="dashboard-layout">
        <DeviceSidebar
          devices={devices}
          selected={selected}
          onSelect={setSelected}
        />

        <main className="dashboard-main">
          {!device ? (
            <section className="glass-panel empty-state">
              <Smartphone size={36} />
              <h2>Select a device</h2>
              <p>Choose an enrolled device to open recovery controls.</p>
            </section>
          ) : (
            <>
              <DeviceHero device={device} formatTime={formatTime} />

              <RecoveryActionGrid
                isActionBusy={isActionBusy}
                onAction={action}
                voiceOpen={voiceOpen}
                onToggleVoice={() => setVoiceOpen((open) => !open)}
              />

              <LocationServicesCard
                device={device}
                locationBusy={locationBusy}
                locationFeedback={locationFeedback}
                formatTime={formatTime}
                isActionBusy={isActionBusy}
                onLocationControl={locationControl}
                onAction={action}
              />

              {voiceOpen && (
                <VoiceInput
                  key={selected}
                  deviceName={
                    devices.find((item) => item.id === selected)?.deviceName ||
                    "Selected device"
                  }
                  disabled={activeCount > 0 || device.id !== selected}
                  onAction={action}
                  onClose={() => setVoiceOpen(false)}
                />
              )}

              {(msg || activeCount > 0) && (
                <div className="command-banner glass-panel">
                  <div className="pulse-dot" />
                  <span>{msg || "Processing…"}</span>
                  {activeCount > 0 && <RefreshCw className="spin" size={16} />}
                </div>
              )}

              <section className="recovery-grid">
                <LocationCard
                  device={device}
                  formatTime={formatTime}
                  mapEmbedUrl={mapEmbedUrl}
                  googleMapsUrl={googleMapsUrl}
                  onShareLocation={() => void shareLocation()}
                  onDownloadReport={downloadReport}
                />

                <RecoveryPhotoCard
                  device={device}
                  formatTime={formatTime}
                  onDownloadReport={downloadReport}
                />
              </section>
            </>
          )}
        </main>
      </div>

      <footer className="site-footer">
        <span className="footer-brand">Jazz Device Recovery</span>

        <span className="developer-credit">
          Developed by <span className="developer-name">😈 gunakarna 😈</span>
        </span>
      </footer>
    </div>
  );
}
