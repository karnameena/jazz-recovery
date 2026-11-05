import jazzLogo from "../../Logo-jazz.webp";
import { useState } from "react";
import { LockKeyhole, LogOut, Menu, Radio, RefreshCw, X } from "lucide-react";

type DashboardHeaderProps = {
  onlineCount: number;
  deviceCount: number;
  load: () => Promise<void>;
  registerPasskey: () => Promise<void>;
  setupRecoveryPin: () => Promise<void>;
  openSubscription: () => void;
  showSubscription?: boolean;
  logout: () => Promise<void>;
};

export function DashboardHeader({
  onlineCount,
  deviceCount,
  load,
  registerPasskey,
  setupRecoveryPin,
  openSubscription,
  showSubscription = false,
  logout,
}: DashboardHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
  <header className="topbar glass-panel">
          <div className="brand-block">
            <div className="brand-logo">
              <img
                src={jazzLogo}
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
          <button
            type="button"
            className="topbar-menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="dashboard-header-actions"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={25} /> : <Menu size={25} />}
          </button>
          <div
            id="dashboard-header-actions"
            className={`topbar-actions${menuOpen ? " is-open" : ""}`}
          >
            <div className="fleet-pill">
              <Radio size={16} />
              <span>
                {onlineCount}/{deviceCount} online
              </span>
            </div>
            <button
              className="ghost-button"
              onClick={() => {
                setMenuOpen(false);
                void load();
              }}
            >
              <RefreshCw size={17} /> Refresh
            </button>
            <button className="ghost-button" onClick={() => {
              setMenuOpen(false);
              void registerPasskey();
            }}>
              <LockKeyhole size={17} /> Register passkey
            </button>
            <button className="ghost-button" onClick={() => {
              setMenuOpen(false);
              void setupRecoveryPin();
            }}>
              <LockKeyhole size={17} /> Set recovery PIN
            </button>
            {showSubscription && <button className="ghost-button" onClick={() => {
              setMenuOpen(false);
              openSubscription();
            }}>
              <LockKeyhole size={17} /> Billing admin
            </button>}
            <button className="ghost-button danger-hover" onClick={() => {
              setMenuOpen(false);
              void logout();
            }}>
              <LogOut size={17} /> Logout
            </button>
          </div>
        </header>
  );
}
