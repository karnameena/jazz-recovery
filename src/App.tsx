import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { dataUrlToBlob, getCachedLocation, getCachedPhoto, saveVerifiedLocation, saveVerifiedPhoto } from "./services/recovery-cache";
import { RefreshCw, Smartphone } from "lucide-react";

const BillingPage = lazy(() =>
  import("./components/billing/BillingPage").then((module) => ({
    default: module.BillingPage,
  })),
);

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
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function actionKey(name: string, args: Record<string, unknown> = {}) {
  if (name === "RECOVERY_PHOTO")
    return `${name}:${args.camera === "rear" ? "rear" : "front"}`;
  return name;
}

export function App() {
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState(false);
  const [ownerKey, setOwnerKey] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [msg, setMsg] = useState("");
  const [activeCount, setActiveCount] = useState(0);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState("");
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [billingAdmin, setBillingAdmin] = useState(false);
  const [trialToast, setTrialToast] = useState("");
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [recoveryPinOpen, setRecoveryPinOpen] = useState(false);
  const [recoveryPinPassword, setRecoveryPinPassword] = useState("");
  const [recoveryPinValue, setRecoveryPinValue] = useState("");
  const [recoveryPinConfirm, setRecoveryPinConfirm] = useState("");
  const [recoveryPinBusy, setRecoveryPinBusy] = useState(false);
  const [recoveryPinError, setRecoveryPinError] = useState("");
  const deviceRequestId = useRef(0);
  const selectionRequestId = useRef(0);
  const actionLocks = useRef(new Set<string>());
  const sessionEpoch = useRef(0);
  const cachedPhotoUrls = useRef(new Map<string, { timestamp: number; url: string }>());

  function clearCachedPhotoUrls() {
    for (const entry of cachedPhotoUrls.current.values()) URL.revokeObjectURL(entry.url);
    cachedPhotoUrls.current.clear();
  }

  async function hydrateDevice(apiDevice: Device): Promise<Device> {
    if (!ownerKey || !apiDevice.deviceId) return apiDevice;
    const deviceKey = String(apiDevice.deviceId);
    let location = apiDevice.location;
    let photo = apiDevice.photo;

    if (location) {
      const rawTimestamp = location.timestamp;
      const timestamp = typeof rawTimestamp === "number" ? rawTimestamp : Date.parse(String(rawTimestamp || ""));
      if (Number.isFinite(timestamp) && timestamp > 0) {
        const age = Date.now() - timestamp;
        const status = age <= 90_000 ? "live" : age > 24 * 60 * 60 * 1000 ? "old" : "cached";
        location = { ...location, timestamp, status };
        try {
          await saveVerifiedLocation(ownerKey, deviceKey, {
            latitude: location.latitude, longitude: location.longitude,
            accuracyMeters: location.accuracyMeters ?? null, timestamp,
            verifiedAt: Date.now(), status,
          });
          if (location.relayId) {
            await api(`/api/devices/${apiDevice.id}/recovery-relay/ack`, {
              method: "POST", body: JSON.stringify({ relayId: location.relayId }),
            });
          }
        } catch {
          // Keep the live result visible; do not ACK a relay unless local persistence succeeds.
        }
      }
    } else {
      const cached = await getCachedLocation(ownerKey, deviceKey).catch(() => null);
      if (cached) location = cached;
    }

    if (photo?.dataUrl) {
      const timestamp = typeof photo.timestamp === "number" ? photo.timestamp : Date.parse(String(photo.timestamp || ""));
      if (Number.isFinite(timestamp) && timestamp > 0) {
        try {
          await saveVerifiedPhoto(ownerKey, deviceKey, {
            blob: dataUrlToBlob(photo.dataUrl), camera: photo.camera || "camera",
            timestamp, verifiedAt: Date.now(), mimeType: "image/jpeg",
          });
          if (photo.relayId) {
            await api(`/api/devices/${apiDevice.id}/recovery-relay/ack`, {
              method: "POST", body: JSON.stringify({ relayId: photo.relayId }),
            });
          }
        } catch {
          // Keep the already received photo visible for this session if cache storage fails.
        }
      }
    } else {
      const cached = await getCachedPhoto(ownerKey, deviceKey).catch(() => null);
      if (cached) {
        let existing = cachedPhotoUrls.current.get(deviceKey);
        if (!existing || existing.timestamp !== cached.timestamp) {
          if (existing) URL.revokeObjectURL(existing.url);
          existing = { timestamp: cached.timestamp, url: URL.createObjectURL(cached.blob) };
          cachedPhotoUrls.current.set(deviceKey, existing);
        }
        photo = { dataUrl: existing.url, camera: cached.camera, timestamp: cached.timestamp };
      }
    }
    return { ...apiDevice, location, photo };
  }

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

  async function refresh(id = selected) {
    if (!id) return null;
    const requestId = ++deviceRequestId.current;
    const requestEpoch = sessionEpoch.current;
    const data = await api(`/api/devices/${id}`);
    const hydrated = await hydrateDevice(data.device as Device);
    if (requestEpoch === sessionEpoch.current && requestId === deviceRequestId.current && Number(hydrated?.id) === Number(id)) {
      setDevice(hydrated);
      // Keep the sidebar fleet state in sync with the selected-device response.
      // Previously only the detail card updated; the sidebar could remain stale
      // until its slower list poll, making users refresh the page twice.
      setDevices((current) => current.map((item) =>
        Number(item.id) === Number(id) ? { ...item, ...hydrated } : item
      ));
    }
    return hydrated;
  }

  async function selectDevice(id: number) {
    const requestEpoch = sessionEpoch.current;
    const selectionRequest = ++selectionRequestId.current;
    setSelected(id);
    setDevice(null);
    setDevicesLoading(true);
    try {
      await refresh(id);
    } finally {
      if (
        requestEpoch === sessionEpoch.current &&
        selectionRequest === selectionRequestId.current
      ) {
        setDevicesLoading(false);
      }
    }
  }

  async function load() {
    const requestEpoch = sessionEpoch.current;
    setDevicesLoading(true);
    try {
      const data = await api("/api/devices");
      if (requestEpoch !== sessionEpoch.current) return;
      const items: Device[] = data.items || [];
      setDevices(items);
      const nextId = selected && items.some((item) => item.id === selected)
        ? selected
        : items[0]?.id ?? null;
      ++selectionRequestId.current;
      if (nextId == null) {
        ++deviceRequestId.current;
        setSelected(null);
        setDevice(null);
      } else {
        setSelected(nextId);
        await refresh(nextId);
      }
    } finally {
      if (requestEpoch === sessionEpoch.current) setDevicesLoading(false);
    }
  }

  const refreshBillingAccess = useCallback(async (options: { resetPage?: boolean } = {}) => {
    const requestEpoch = sessionEpoch.current;
    try {
      const billing = await api("/api/billing/status");
      if (requestEpoch !== sessionEpoch.current) return { admin: false, required: false };
      const admin = Boolean(billing.isBillingAdmin || billing.isOwnerAdmin);
      const isOwnerAdmin = Boolean(billing.isOwnerAdmin);
      const required = (billing.access === "expired" || billing.access === "trial_pending") && !admin;
      setBillingAdmin(admin);
      setSubscriptionRequired(required);
      if (isOwnerAdmin || required) setSubscriptionOpen(true);
      else if (options.resetPage) setSubscriptionOpen(false);
      return { admin, required };
    } catch {
      if (requestEpoch !== sessionEpoch.current) return { admin: false, required: false };
      // A temporary billing API outage must not lock a legitimate user out of recovery.
      setBillingAdmin(false);
      setSubscriptionRequired(false);
      if (options.resetPage) setSubscriptionOpen(false);
      return { admin: false, required: false };
    }
  }, []);

  useEffect(() => {
    api("/api/auth/session")
      .then(async (session) => { setOwnerKey(String(session.username || "")); await refreshBillingAccess({ resetPage: true }); setLogin(true); })
      .catch(() => setLogin(false))
      .finally(() => setReady(true));
  }, [refreshBillingAccess]);

  function clearAccountState() {
    sessionEpoch.current += 1;
    setOwnerKey("");
    clearCachedPhotoUrls();
    ++deviceRequestId.current;
    ++selectionRequestId.current;
    actionLocks.current.clear();
    setActiveCount(0);
    setDevices([]);
    setSelected(null);
    setDevice(null);
    setMsg("");
    setLocationBusy(false);
    setLocationFeedback("");
    setBillingAdmin(false);
    setSubscriptionRequired(false);
    setSubscriptionOpen(false);
    setDevicesLoading(false);
    setTrialToast("");
  }

  async function afterLogin(result?: { trialActivated?: boolean; trialDays?: number; registered?: boolean }) {
    if (result?.registered) {
      // Registration creates the account/device/trial, but the user must explicitly sign in.
      clearAccountState();
      setLogin(false);
      if (result.trialActivated) setTrialToast(`Your ${Number(result.trialDays ?? 7)}-day trial has been activated.`);
      return;
    }

    // Do not render protected content until the newly issued server cookie and
    // this user's billing/role state have both been read successfully.
    setReady(false);
    clearAccountState();
    const transitionEpoch = sessionEpoch.current;
    try {
      const session = await api("/api/auth/session");
      setOwnerKey(String(session.username || ""));
      await refreshBillingAccess({ resetPage: true });
      if (transitionEpoch === sessionEpoch.current) setLogin(true);
    } catch (error) {
      setLogin(false);
      throw error;
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    if (!trialToast) return;
    const timer = window.setTimeout(() => setTrialToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [trialToast]);

  useEffect(() => {
    if (!login) return;
    const timer = window.setInterval(() => { void refreshBillingAccess(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [login, refreshBillingAccess]);

  // A session can expire while the dashboard remains open. Revalidate it
  // periodically so protected UI is cleared promptly instead of appearing
  // signed in after the server has rejected the session.
  useEffect(() => {
    if (!login) return;
    let checking = false;
    const checkSession = async () => {
      if (checking) return;
      checking = true;
      try {
        await api("/api/auth/session");
      } catch (error) {
        const status = Number((error as Error & { status?: number }).status || 0);
        if (status === 401) {
          setLogin(false);
          clearAccountState();
          setReady(true);
        }
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => { void checkSession(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [login]);

  useEffect(() => {
    if (!login) return;
    const requestEpoch = sessionEpoch.current;
    void load().catch((error) => {
      if (requestEpoch === sessionEpoch.current) {
        setMsg(error instanceof Error ? error.message : "Could not load recovery devices.");
      }
    });
  }, [login]);
  useEffect(() => {
    if (!login || !selected) return;
    const requestEpoch = sessionEpoch.current;
    const selectedId = selected;
    const detailTimer = window.setInterval(() => {
      if (requestEpoch !== sessionEpoch.current) return;
      void refresh(selectedId).catch(() => {});
    }, 5000);
    const listTimer = window.setInterval(() => {
      if (requestEpoch !== sessionEpoch.current) return;
      void api("/api/devices")
        .then((data) => {
          if (requestEpoch === sessionEpoch.current) setDevices(data.items || []);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      window.clearInterval(detailTimer);
      window.clearInterval(listTimer);
    };
  }, [login, selected]);

  // When the owner returns to the dashboard, refresh from the API immediately
  // instead of waiting for the next interval tick.
  useEffect(() => {
    if (!login) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && selected) {
        const requestEpoch = sessionEpoch.current;
        void refresh(selected).catch(() => {});
        void api("/api/devices")
          .then((data) => {
            if (requestEpoch === sessionEpoch.current) setDevices(data.items || []);
          })
          .catch(() => {});
      }
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
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
    const requestEpoch = sessionEpoch.current;
    const beforeLocation = String(device?.location?.timestamp ?? "");
    const beforePhoto = `${device?.photo?.camera ?? ""}:${String(device?.photo?.timestamp ?? "")}`;
    actionLocks.current.add(key);
    setActiveCount(actionLocks.current.size);
    setMsg("Sending secure recovery request…");

    try {
      const data = await api(`/api/devices/${selectedAtStart}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: name, args }),
      });
      if (requestEpoch !== sessionEpoch.current) return;
      if (name === "SET_RECOVERY_MODE") {
        const wakeStatus = data.wake?.status;
        setMsg(
          wakeStatus === "SENT"
            ? "Lost Mode queued. FCM wake-up sent; waiting for Android acknowledgement…"
            : wakeStatus === "NOT_REGISTERED"
              ? "Lost Mode queued, but this phone has no registered FCM token. Waiting for its next connection…"
              : wakeStatus === "NOT_CONFIGURED"
                ? "Lost Mode queued, but FCM is not configured on the server. Waiting for the phone to check in…"
                : wakeStatus === "FAILED"
                  ? "Lost Mode queued, but the FCM wake-up failed. Waiting for the phone to check in…"
                  : "Lost Mode queued. Waiting for Android acknowledgement…",
        );
      } else {
        setMsg(
          data.deduplicated
            ? "A matching recovery request is already queued. Waiting for the latest result…"
            : "Recovery request sent. Waiting for the device…",
        );
      }

      const maxAttempts =
        name === "SET_RECOVERY_MODE"
          ? 60
          : name === "GET_LOCATION" || name === "RECOVERY_PHOTO"
            ? 36
            : 10;
      const pollDelay = name === "SET_RECOVERY_MODE" ? 1000 : 650;
      for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, pollDelay));
        if (requestEpoch !== sessionEpoch.current) return;

        if (name === "SET_RECOVERY_MODE") {
          const commandState = await api(
            `/api/devices/${selectedAtStart}/commands/${encodeURIComponent(data.commandId)}`,
          ).catch(() => null);
          if (requestEpoch !== sessionEpoch.current) return;
          if (commandState?.status === "CONFIRMED") {
            setMsg("Android Companion acknowledged Lost Mode.");
            await refresh(selectedAtStart).catch(() => null);
            void load().catch(() => {});
            break;
          }
          if (["FAILED", "EXPIRED"].includes(commandState?.status)) {
            setMsg("Android did not confirm Lost Mode. Check the device status and try again.");
            break;
          }
        }

        const latest = await refresh(selectedAtStart).catch(() => null);
        if (requestEpoch !== sessionEpoch.current) return;
        if (attempts % 3 === 0) void load().catch(() => {});
        if (!latest) continue;

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
        }

        if (attempts === maxAttempts - 1) {
          setMsg(
            name === "SET_RECOVERY_MODE"
              ? "Lost Mode remains queued, but the phone has not acknowledged it yet. Check its network connection; Jazz will continue refreshing device status."
              : "Recovery request sent. The page will continue refreshing automatically.",
          );
        }
      }
    } catch (error) {
      if (requestEpoch === sessionEpoch.current) {
        setMsg(error instanceof Error ? error.message : "Action failed");
      }
    } finally {
      if (requestEpoch === sessionEpoch.current) {
        actionLocks.current.delete(key);
        setActiveCount(actionLocks.current.size);
      }
    }
  }

  async function locationControl(enabled: boolean) {
    if (!selected || locationBusy) return;
    const selectedAtStart = selected;
    const requestEpoch = sessionEpoch.current;
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
      if (requestEpoch !== sessionEpoch.current) return;
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
        if (requestEpoch !== sessionEpoch.current) return;
        const data = await api(
          `/api/devices/${selectedAtStart}/commands/${encodeURIComponent(queued.commandId)}`,
        );
        if (requestEpoch !== sessionEpoch.current) return;
        if (
          data.confirmed &&
          data.status === "CONFIRMED" &&
          data.result?.locationServices === desired
        ) {
          setLocationFeedback(
            "Device confirmed: Location Services " + desired + ".",
          );
          await refresh(selectedAtStart);
          const latestDevices = await api("/api/devices").catch(() => null);
          if (latestDevices?.items) setDevices(latestDevices.items);
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
      if (requestEpoch === sessionEpoch.current) {
        setLocationFeedback(
          error instanceof Error
            ? error.message
            : "Location Services request failed.",
        );
      }
    } finally {
      if (requestEpoch === sessionEpoch.current) setLocationBusy(false);
    }
  }

  async function logout() {
    // Hide the old account immediately and invalidate in-flight device requests.
    setReady(false);
    setLogin(false);
    clearAccountState();
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      // The server session may already be expired; the client still clears all
      // account-specific state and the next login revalidates its session.
    } finally {
      setReady(true);
    }
  }

  function setupRecoveryPin() {
    setRecoveryPinPassword("");
    setRecoveryPinValue("");
    setRecoveryPinConfirm("");
    setRecoveryPinError("");
    setRecoveryPinOpen(true);
  }

  async function submitRecoveryPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryPinPassword) return setRecoveryPinError("Enter your current password.");
    if (!/^\d{4}$/.test(recoveryPinValue)) return setRecoveryPinError("Your recovery PIN must contain exactly 4 digits.");
    if (recoveryPinValue !== recoveryPinConfirm) return setRecoveryPinError("The PIN entries do not match.");
    setRecoveryPinBusy(true);
    setRecoveryPinError("");
    try {
      await api("/api/auth/recovery-pin", {
        method: "POST",
        body: JSON.stringify({ currentPassword: recoveryPinPassword, recoveryPin: recoveryPinValue, confirmRecoveryPin: recoveryPinConfirm }),
      });
      setRecoveryPinOpen(false);
      setMsg("Recovery PIN saved securely. You can use it if you forget your password.");
    } catch (error) {
      setRecoveryPinError(error instanceof Error ? error.message : "Could not save recovery PIN.");
    } finally {
      setRecoveryPinBusy(false);
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
  if (!login) return <>
    {trialToast && <div className="trial-activation-toast" role="status">✓ {trialToast}</div>}
    <Login done={afterLogin} />
  </>;

  if (subscriptionOpen) {
    return (
      <Suspense fallback={<div className="loading-screen"><RefreshCw className="spin" /> Loading subscription…</div>}>
        <BillingPage onBack={() => { if (!subscriptionRequired) setSubscriptionOpen(false); }} onLogout={logout} />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      {trialToast && <div className="trial-activation-toast" role="status">✓ {trialToast}</div>}

      <DashboardHeader
        onlineCount={onlineCount}
        deviceCount={devices.length}
        load={load}
        registerPasskey={registerPasskey}
        setupRecoveryPin={setupRecoveryPin}
        openSubscription={() => setSubscriptionOpen(true)}
        showSubscription={billingAdmin}
        logout={logout}
      />

      {recoveryPinOpen && (
        <div className="jazz-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !recoveryPinBusy) setRecoveryPinOpen(false); }}>
          <section className="jazz-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-pin-title">
            <div className="jazz-modal-brand"><span className="jazz-modal-brand-icon">✦</span><span>JAZZ SECURE RECOVERY</span></div>
            <h2 id="recovery-pin-title">Set Recovery PIN</h2>
            <p className="jazz-modal-description">Create a private 4-digit PIN to help recover access to your account.</p>
            <form onSubmit={submitRecoveryPin}>
              <label className="jazz-modal-field">Current password
                <input type="password" autoComplete="current-password" value={recoveryPinPassword} onChange={(event) => setRecoveryPinPassword(event.target.value)} required autoFocus />
              </label>
              <div className="jazz-modal-pin-row">
                <label className="jazz-modal-field">New 4-digit PIN
                  <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} pattern="[0-9]{4}" value={recoveryPinValue} onChange={(event) => setRecoveryPinValue(event.target.value.replace(/\D/g, "").slice(0, 4))} required />
                </label>
                <label className="jazz-modal-field">Confirm PIN
                  <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} pattern="[0-9]{4}" value={recoveryPinConfirm} onChange={(event) => setRecoveryPinConfirm(event.target.value.replace(/\D/g, "").slice(0, 4))} required />
                </label>
              </div>
              {recoveryPinError && <p className="jazz-modal-error" role="alert">{recoveryPinError}</p>}
              <div className="jazz-modal-actions">
                <button type="button" className="jazz-modal-cancel" disabled={recoveryPinBusy} onClick={() => setRecoveryPinOpen(false)}>Cancel</button>
                <button type="submit" className="jazz-modal-submit" disabled={recoveryPinBusy}>{recoveryPinBusy ? "Saving…" : "Save PIN"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      <div className="dashboard-layout">
        <DeviceSidebar
          devices={devices}
          selected={selected}
          onSelect={(id) => { void selectDevice(id); }}
        />

        <main className="dashboard-main">
          {!device ? (
            <section className="glass-panel empty-state">
              {devicesLoading ? <RefreshCw className="spin" size={36} /> : <Smartphone size={36} />}
              <h2>{devicesLoading ? "Loading your device…" : devices.length ? "Preparing recovery controls" : "No enrolled devices"}</h2>
              <p>{devicesLoading ? "Retrieving the latest device status." : devices.length ? "The selected device details are being refreshed." : "Pair a device with your Jazz Recovery account to begin."}</p>
            </section>
          ) : (
            <>
              <DeviceHero device={device} formatTime={formatTime} />

              <RecoveryActionGrid
                deviceId={device.id}
                isActionBusy={isActionBusy}
                onAction={action}
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
