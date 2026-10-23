import React from "react";
import { ChevronRight, ShieldCheck, Smartphone } from "lucide-react";

type DeviceListItem = {
  id: number;
  deviceId?: string;
  deviceName: string;
  deviceType: string;
  online: boolean;
};

type DeviceSidebarProps = {
  devices: DeviceListItem[];
  selected: number | null;
  onSelect: (id: number) => void;
};

export function DeviceSidebar({ devices, selected, onSelect }: DeviceSidebarProps) {
  return (
    <aside className="device-sidebar glass-panel">
      <div className="sidebar-title">
        <div>
          <span className="eyebrow">MY DEVICES</span>
          <h2>Recovery Fleet</h2>
        </div>
        <span className="count-badge">{devices.length}</span>
      </div>
      <div className="device-list">
        {devices.length === 0 && (
          <div className="empty-state compact">
            <Smartphone size={24} />
            <span>No enrolled devices</span>
          </div>
        )}
        {devices.map((item) => (
          <button
            key={item.id}
            className={`device-row ${selected === item.id ? "selected" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            <div className={`device-avatar ${item.online ? "live" : ""}`}>
              <Smartphone size={21} />
            </div>
            <div className="device-row-copy">
              <strong>{item.deviceName || item.deviceId || "Device"}</strong>
              <span>{item.deviceId || item.deviceType}</span>
              <small className={item.online ? "online-text" : "offline-text"}>
                {item.online ? "● Online" : "● Offline"}
              </small>
            </div>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      <div className="sidebar-security">
        <ShieldCheck size={18} />
        <div>
          <strong>Secure recovery</strong>
          <span>Encrypted owner-authorized channel</span>
        </div>
      </div>
    </aside>
  );
}
