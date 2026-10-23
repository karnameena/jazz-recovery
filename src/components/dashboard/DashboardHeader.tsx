import React from "react";
import { LockKeyhole, LogOut, Radio, RefreshCw } from "lucide-react";

type DashboardHeaderProps = {
  onlineCount: number;
  deviceCount: number;
  selected: number | null;
  load: () => Promise<void>;
  refresh: (id?: number | null) => Promise<unknown>;
  registerPasskey: () => Promise<void>;
  setupRecoveryPin: () => Promise<void>;
  logout: () => Promise<void>;
};

export function DashboardHeader({
  onlineCount,
  deviceCount,
  selected,
  load,
  refresh,
  registerPasskey,
  setupRecoveryPin,
  logout,
}: DashboardHeaderProps) {
  return (
  <header className="topbar glass-panel">
          <div className="brand-block">
            <div className="brand-logo">
              <img
                src="https://raw.githubusercontent.com/karnameena/jazz-recovery/refs/heads/feature/neon-web-compat-20261012/src/Logo-jazz.png"
                alt="Jazz Logo"
                width={95}
                height={95}
              />
            </div>
            <div>
              <div className="eyebrow">JAZZ RECOVERY</div>
              <h1>Lost Mode Command Center</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="fleet-pill">
              <Radio size={16} />
              <span>
                {onlineCount}/{deviceCount} online
              </span>
            </div>
            <button
              className="ghost-button"
              onClick={() => {
                void load();
                if (selected) void refresh(selected);
              }}
            >
              <RefreshCw size={17} /> Refresh
            </button>
            <button className="ghost-button" onClick={() => void registerPasskey()}>
              <LockKeyhole size={17} /> Register passkey
            </button>
            <button className="ghost-button" onClick={() => void setupRecoveryPin()}>
              <LockKeyhole size={17} /> Set recovery PIN
            </button>
            <button className="ghost-button danger-hover" onClick={logout}>
              <LogOut size={17} /> Logout
            </button>
          </div>
        </header>
  );
}
