import React, { useEffect, useState } from "react";
import { Camera, Download, Trash2 } from "lucide-react";
import { api } from "../../services/api";
import type { Device } from "../../types/device";

type RecoveryPhotoCardProps = {
  device: Device;
  formatTime: (value: string | number | null | undefined) => string;
  onDownloadReport: () => void;
  onDeletePhoto: () => void;
};

export function RecoveryPhotoCard({
  device,
  formatTime,
  onDownloadReport,
  onDeletePhoto,
}: RecoveryPhotoCardProps) {
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoError, setPhotoError] = useState("");

  useEffect(() => {
    let active = true;
    setPhotoError("");
    setPhotoUrl(device.photo?.dataUrl || "");
    if (!device.photo || device.photo.dataUrl) return () => { active = false; };
    api(`/api/devices/${device.id}/photo-url`)
      .then((data) => { if (active) setPhotoUrl(String(data.url || "")); })
      .catch((error) => { if (active) setPhotoError(error instanceof Error ? error.message : "Could not load current photo."); });
    return () => { active = false; };
  }, [device.id, device.photo?.timestamp, device.photo?.camera, device.photo?.dataUrl]);

  async function downloadCurrentPhoto() {
    if (device.photo?.dataUrl) {
      const anchor = document.createElement("a");
      anchor.href = device.photo.dataUrl;
      anchor.download = `jazz-recovery-${device.photo.camera || "photo"}.jpg`;
      anchor.click();
      return;
    }
    try {
      const data = await api(`/api/devices/${device.id}/photo-url?download=1`);
      window.location.assign(String(data.url));
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not download current photo.");
    }
  }

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
            {photoUrl ? <img src={photoUrl} alt="Latest recovery photo for the selected device" /> : <div className="empty-state photo-empty"><Camera size={28} /><p>{photoError || "Loading the private recovery photo…"}</p></div>}
          </div>
          <div className="photo-meta">
            <span>{device.photo.camera || "camera"} camera</span>
            <span>{formatTime(device.photo.timestamp)}</span>
          </div>
          <div className="card-actions">
            <button className="primary-button" onClick={() => void downloadCurrentPhoto()} disabled={!photoUrl}>
              <Download size={17} /> Download Current Photo
            </button>
            <button className="secondary-button" onClick={onDownloadReport}>
              <Download size={17} /> Download Recovery Report
            </button>
            <button className="secondary-button" onClick={onDeletePhoto}>
              <Trash2 size={17} /> Delete Current Photo
            </button>
          </div>
          {photoError && <p role="status" className="photo-error">{photoError}</p>}
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
