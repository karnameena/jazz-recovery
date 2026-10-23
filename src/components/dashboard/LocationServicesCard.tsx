import React from "react";
import { MapPin, RefreshCw } from "lucide-react";
import type { Device } from "../../types/device";

type LocationServicesCardProps = {
  device: Device;
  locationBusy: boolean;
  locationFeedback: string;
  formatTime: (value: string | number | null | undefined) => string;
  isActionBusy: (name: string, args?: Record<string, unknown>) => boolean;
  onLocationControl: (enabled: boolean) => Promise<void>;
  onAction: (name: string, args?: Record<string, unknown>) => Promise<void>;
};

export function LocationServicesCard({
  device,
  locationBusy,
  locationFeedback,
  formatTime,
  isActionBusy,
  onLocationControl,
  onAction,
}: LocationServicesCardProps) {
  return (
    <section
      className="glass-panel"
      aria-label="Device Location Services"
      style={{ padding: 22, marginTop: 20 }}
    >
      <div className="card-heading">
        <div>
          <span className="eyebrow">DEVICE SYSTEM SETTINGS</span>
          <h2>Location Services</h2>
        </div>
        <MapPin size={22} />
      </div>
      <div className="location-meta">
        <div>
          <span>Current status</span>
          <strong>{!device.online ? "Device Offline" : device.locationServices || "Unknown"}</strong>
        </div>
        <div>
          <span>Last device-confirmed status</span>
          <strong>{formatTime(device.locationServicesLastConfirmed)}</strong>
        </div>
      </div>
      <p style={{ opacity: 0.75, margin: "12px 0" }}>
        If Location is turned off, click “Turn On” to enable it and get the device’s exact location.
      </p>
      <div className="card-actions">
        <button className="primary-button" disabled={locationBusy} onClick={() => void onLocationControl(true)}>
          <MapPin size={17} /> Turn ON Location
        </button>
        <button className="secondary-button" disabled={locationBusy} onClick={() => void onLocationControl(false)}>
          <MapPin size={17} /> Turn OFF Location
        </button>
        <button
          className="secondary-button"
          disabled={locationBusy || isActionBusy("DEVICE_STATUS") || !device.online}
          onClick={() => void onAction("DEVICE_STATUS")}
        >
          <RefreshCw size={17} /> Refresh Status
        </button>
      </div>
      {locationFeedback && (
        <div role="status" aria-live="polite" className="command-banner" style={{ marginTop: 12 }}>
          {locationBusy && <RefreshCw size={16} className="spin" />}
          <span>{locationFeedback}</span>
        </div>
      )}
      <p style={{ opacity: 0.7, fontSize: 12 }}>
        Remote ON/OFF requires local opt-in and either Android that Location Services changed.
      </p>
    </section>
  );
}
