import React from "react";
import { Camera, Download } from "lucide-react";
import type { Device } from "../../types/device";

type RecoveryPhotoCardProps = {
  device: Device;
  formatTime: (value: string | number | null | undefined) => string;
  onDownloadReport: () => void;
};

export function RecoveryPhotoCard({
  device,
  formatTime,
  onDownloadReport,
}: RecoveryPhotoCardProps) {
  return (
    <article className="photo-card glass-panel">
      <div className="card-heading">
        <div>
          <span className="eyebrow">RECOVERY EVIDENCE</span>
          <h2>Latest recovery photo</h2>
        </div>
        <Camera size={22} />
      </div>
      {device.photo ? (
        <>
          <div className="photo-frame">
            <img src={device.photo.dataUrl} alt="Latest recovery" />
          </div>
          <div className="photo-meta">
            <span>{device.photo.camera || "camera"} camera</span>
            <span>{formatTime(device.photo.timestamp)}</span>
          </div>
          <div className="card-actions">
            <a
              className="primary-button"
              href={device.photo.dataUrl}
              download={`jazz-recovery-${device.photo.camera || "photo"}.jpg`}
            >
              <Download size={17} /> Download Recovery Photo
            </a>
            <button className="secondary-button" onClick={onDownloadReport}>
              <Download size={17} /> Download Recovery Report
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state photo-empty">
          <Camera size={32} />
          <h3>No recovery photo yet</h3>
          <p>Request the front or back camera using the recovery controls above.</p>
        </div>
      )}
    </article>
  );
}
