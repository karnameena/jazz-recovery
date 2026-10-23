import React from "react";
import { BatteryCharging, CircleDot, Gauge, ShieldCheck, Wifi } from "lucide-react";
import type { Device } from "../../types/device";

type DeviceHeroProps = {
  device: Device;
  formatTime: (value: string | number | null | undefined) => string;
};

export function DeviceHero({ device, formatTime }: DeviceHeroProps) {
  return (
    <section className="device-hero glass-panel">
      <div className="hero-main">
        <div className={`status-orb ${device.online ? "live" : "offline-orb"}`}>
          <CircleDot size={25} />
        </div>
        <div>
          <div className={`status-label ${device.online ? "online-text" : "offline-text"}`}>
            {device.online ? "ONLINE • LIVE CONNECTION" : "OFFLINE • LAST KNOWN STATE"}
          </div>
          <h2>{device.deviceName || device.deviceId || "Registered device"}</h2>
          <div className="device-id-line">
            {device.deviceId || "Registered device"} · {device.deviceType}
          </div>
        </div>
      </div>
      <div className="mode-badge">
        <ShieldCheck size={17} /> {device.mode}
      </div>
      <div className="metrics-grid">
        <div className="metric-card">
          <BatteryCharging size={20} />
          <div>
            <span>Battery</span>
            <strong>{device.battery ?? "--"}%</strong>
          </div>
        </div>
        <div className="metric-card">
          <Wifi size={20} />
          <div>
            <span>Network</span>
            <strong>{device.network || "Unknown"}</strong>
          </div>
        </div>
        <div className="metric-card">
          <Gauge size={20} />
          <div>
            <span>Last Seen</span>
            <strong>{formatTime(device.lastSeen)}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
