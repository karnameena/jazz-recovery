import {
  Camera,
  LocateFixed,
  Mic,
  ShieldCheck,
  Smartphone,
  Volume2,
} from "lucide-react";

type RecoveryActionGridProps = {
  action: (name: string, args?: Record<string, unknown>) => Promise<void>;
  isActionBusy: (name: string, args?: Record<string, unknown>) => boolean;
  voiceOpen: boolean;
  onToggleVoice: () => void;
};

export function RecoveryActionGrid({
  action,
  isActionBusy,
  voiceOpen,
  onToggleVoice,
}: RecoveryActionGridProps) {
  return (
  <section className="action-grid">
                  <button
                    disabled={isActionBusy("DEVICE_STATUS")}
                    onClick={() => action("DEVICE_STATUS")}
                  >
                    <Smartphone />
                    <div>
                      <strong>Device Status</strong>
                      <span>Refresh device health</span>
                    </div>
                  </button>
                  <button
                    disabled={isActionBusy("GET_LOCATION")}
                    onClick={() => action("GET_LOCATION")}
                  >
                    <LocateFixed />
                    <div>
                      <strong>Get Location</strong>
                      <span>
                        {isActionBusy("GET_LOCATION")
                          ? "Request in progress…"
                          : "Request latest position"}
                      </span>
                    </div>
                  </button>
                  <button
                    disabled={isActionBusy("RING_DEVICE")}
                    onClick={() => action("RING_DEVICE")}
                  >
                    <Volume2 />
                    <div>
                      <strong>Ring Device</strong>
                      <span>Play recovery alert</span>
                    </div>
                  </button>
                  <button
                    disabled={isActionBusy("RECOVERY_PHOTO", { camera: "front" })}
                    onClick={() => action("RECOVERY_PHOTO", { camera: "front" })}
                  >
                    <Camera />
                    <div>
                      <strong>Front Camera</strong>
                      <span>
                        {isActionBusy("RECOVERY_PHOTO", { camera: "front" })
                          ? "Capturing…"
                          : "Request recovery photo"}
                      </span>
                    </div>
                  </button>
                  <button
                    disabled={isActionBusy("RECOVERY_PHOTO", { camera: "rear" })}
                    onClick={() => action("RECOVERY_PHOTO", { camera: "rear" })}
                  >
                    <Camera />
                    <div>
                      <strong>Back Camera</strong>
                      <span>
                        {isActionBusy("RECOVERY_PHOTO", { camera: "rear" })
                          ? "Capturing…"
                          : "Request recovery photo"}
                      </span>
                    </div>
                  </button>
                  <button
                    className="critical-action"
                    disabled={isActionBusy("SET_RECOVERY_MODE", {
                      enabled: true,
                    })}
                    onClick={() => action("SET_RECOVERY_MODE", { enabled: true })}
                  >
                    <ShieldCheck />
                    <div>
                      <strong>Enable Lost Mode</strong>
                      <span>Secure recovery state</span>
                    </div>
                  </button>
                  <button
                    className="voice-toggle"
                    aria-expanded={voiceOpen}
                    aria-controls="recovery-voice-panel"
                    onClick={onToggleVoice
                  >
                    <Mic />
                    <div>
                      <strong>Voice Input</strong>
                      <span>Remote recovery voice broadcast</span>
                    </div>
                  </button>
                </section>
    .replace(/^s*<section className="action-grid">/,"    <section className="action-grid">")
    .replace(/^s*</section>$/m,"    </section>")}
  );
}
