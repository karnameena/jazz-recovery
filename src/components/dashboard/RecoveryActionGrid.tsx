import React from "react";
import { Camera, LocateFixed, Mic, ShieldCheck, Smartphone, Volume2 } from "lucide-react";

type RecoveryActionGridProps = {
  isActionBusy: (name: string, args?: Record<string, unknown>) => boolean;
  onAction: (name: string, args?: Record<string, unknown>) => Promise<void>;
  voiceOpen: boolean;
  onToggleVoice: () => void;
};

export function RecoveryActionGrid({
  isActionBusy,
  onAction,
  voiceOpen,
  onToggleVoice,
}: RecoveryActionGridProps) {
  return (
    <>
      <section className="section-heading">
        <div>
          <span className="eyebrow">RECOVERY ACTIONS</span>
          <h2>Remote controls</h2>
        </div>
        <span>Commands use the existing allowlisted recovery workflow.</span>
      </section>
      <section className="action-grid">
        <button disabled={isActionBusy("DEVICE_STATUS")} onClick={() => void onAction("DEVICE_STATUS")}>
          <Smartphone />
          <div><strong>Device Status</strong><span>Refresh device health</span></div>
        </button>
        <button disabled={isActionBusy("GET_LOCATION")} onClick={() => void onAction("GET_LOCATION")}>
          <LocateFixed />
          <div>
            <strong>Get Location</strong>
            <span>{isActionBusy("GET_LOCATION") ? "Request in progress…" : "Request latest position"}</span>
          </div>
        </button>
        <button disabled={isActionBusy("RING_DEVICE")} onClick={() => void onAction("RING_DEVICE")}>
          <Volume2 />
          <div><strong>Ring Device</strong><span>Play recovery alert</span></div>
        </button>
        <button
          disabled={isActionBusy("RECOVERY_PHOTO", { camera: "front" })}
          onClick={() => void onAction("RECOVERY_PHOTO", { camera: "front" })}
        >
          <Camera />
          <div>
            <strong>Front Camera</strong>
            <span>{isActionBusy("RECOVERY_PHOTO", { camera: "front" }) ? "Capturing…" : "Request recovery photo"}</span>
          </div>
        </button>
        <button
          disabled={isActionBusy("RECOVERY_PHOTO", { camera: "rear" })}
          onClick={() => void onAction("RECOVERY_PHOTO", { camera: "rear" })}
        >
          <Camera />
          <div>
            <strong>Back Camera</strong>
            <span>{isActionBusy("RECOVERY_PHOTO", { camera: "rear" }) ? "Capturing…" : "Request recovery photo"}</span>
          </div>
        </button>
        <button
          className="critical-action"
          disabled={isActionBusy("SET_RECOVERY_MODE", { enabled: true })}
          onClick={() => void onAction("SET_RECOVERY_MODE", { enabled: true })}
        >
          <ShieldCheck />
          <div><strong>Enable Lost Mode</strong><span>Secure recovery state</span></div>
        </button>
        <button
          className="voice-toggle"
          aria-expanded={voiceOpen}
          aria-controls="recovery-voice-panel"
          onClick={onToggleVoice}
        >
          <Mic />
          <div><strong>Voice Input</strong><span>Remote recovery voice broadcast</span></div>
        </button>
      </section>
    </>
  );
}
