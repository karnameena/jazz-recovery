import React, { useEffect, useRef, useState } from "react";
import { Camera, Download, Trash2 } from "lucide-react";
import { apiBlob } from "../../services/api";
import type { Device } from "../../types/device";

type RecoveryPhotoCardProps = {
  device: Device;
  formatTime: (value: string | number | null | undefined) => string;
  onDownloadReport: () => void;
  onDeletePhoto: () => void;
};

function photoExtension(blobType: string) {
  return blobType.toLowerCase() === "image/png" ? "png" : "jpg";
}

export function RecoveryPhotoCard({
  device,
  formatTime,
  onDownloadReport,
  onDeletePhoto,
}: RecoveryPhotoCardProps) {
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [photoLoading, setPhotoLoading] = useState(false);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const displayedUrlRef = useRef("");

  useEffect(() => {
    let active = true;
    let pendingUrl = "";

    setPhotoError("");

    if (!device.photo) {
      setPhotoLoading(false);
      const previousUrl = displayedUrlRef.current;
      displayedUrlRef.current = "";
      setPhotoUrl("");
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return () => {
        active = false;
        if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      };
    }

    // Keep the currently displayed image visible while the latest image is
    // fetched and decoded. Only swap URLs after the replacement is renderable.
    setPhotoLoading(true);
    apiBlob(`/api/devices/${device.id}/photo-content`)
      .then((blob) => new Promise<void>((resolve, reject) => {
        if (!active) { resolve(); return; }
        pendingUrl = URL.createObjectURL(blob);
        const probe = new Image();
        probe.onload = () => {
          if (probe.naturalWidth > 0 && probe.naturalHeight > 0) resolve();
          else reject(new Error("The current recovery photo decoded with zero dimensions."));
        };
        probe.onerror = () => reject(new Error("The current recovery photo could not be decoded as an image."));
        probe.src = pendingUrl;
      }))
      .then(() => {
        if (!active) return;
        if (!pendingUrl) return;
        const previousUrl = displayedUrlRef.current;
        displayedUrlRef.current = pendingUrl;
        setPhotoUrl(pendingUrl);
        pendingUrl = "";
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        setPhotoError("");
      })
      .catch((error) => {
        if (active) {
          setPhotoError(
            error instanceof Error
              ? error.message
              : "Could not load the current recovery photo.",
          );
        }
      })
      .finally(() => {
        if (active) setPhotoLoading(false);
        if (pendingUrl) {
          URL.revokeObjectURL(pendingUrl);
          pendingUrl = "";
        }
      });

    return () => {
      active = false;
      if (pendingUrl) {
        URL.revokeObjectURL(pendingUrl);
        pendingUrl = "";
      }
    };
  }, [
    device.id,
    device.photo?.timestamp,
    device.photo?.camera,
    device.photo?.dataUrl,
    device.photo?.mimeType,
    device.photo?.sizeBytes,
    device.photo?.available,
    reloadAttempt,
  ]);

  useEffect(() => () => {
    const displayedUrl = displayedUrlRef.current;
    displayedUrlRef.current = "";
    if (displayedUrl) URL.revokeObjectURL(displayedUrl);
  }, []);

  async function downloadCurrentPhoto() {
    try {
      const blob = await apiBlob(
        `/api/devices/${device.id}/photo-content?download=1`,
      );
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `jazz-recovery-${device.photo?.camera || "photo"}.${photoExtension(blob.type)}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      setPhotoError(
        error instanceof Error
          ? error.message
          : "Could not download the current recovery photo.",
      );
    }
  }

  function handleDisplayedImageError() {
    const failedUrl = displayedUrlRef.current;
    displayedUrlRef.current = "";
    setPhotoUrl("");
    if (failedUrl) URL.revokeObjectURL(failedUrl);
    setPhotoError("The image could not be displayed. Retry loading the current photo.");
  }

  return (
    <article className="photo-card glass-panel">
      <div className="card-heading">
        <div>
          <span className="eyebrow">RECOVERY EVIDENCE</span>
          <h2>Current recovery photo</h2>
        </div>
        <Camera size={22} />
      </div>

      {device.photo ? (
        <>
          <div className="photo-frame">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={`Current recovery photo from the ${device.photo.camera || "device"} camera`}
                onError={handleDisplayedImageError}
              />
            ) : (
              <div className="empty-state photo-empty" role="status">
                <Camera size={28} />
                <p>
                  {photoLoading
                    ? "Loading and validating the current photo…"
                    : photoError || "The current photo is recorded but its image could not be loaded."}
                </p>
              </div>
            )}
          </div>

          <div className="photo-meta">
            <span>{device.photo.camera || "camera"} camera</span>
            <span>{formatTime(device.photo.timestamp)}</span>
            {device.photo.sizeBytes ? (
              <span>{(device.photo.sizeBytes / 1024).toFixed(0)} KB</span>
            ) : null}
          </div>

          <div className="card-actions">
            <button
              className="primary-button"
              onClick={() => void downloadCurrentPhoto()}
              disabled={!photoUrl}
            >
              <Download size={17} /> Download Current Photo
            </button>
            <button className="secondary-button" onClick={onDownloadReport}>
              <Download size={17} /> Download Recovery Report
            </button>
            <button className="secondary-button" onClick={onDeletePhoto}>
              <Trash2 size={17} /> Delete Current Photo
            </button>
          </div>

          {photoError ? (
            <div className="photo-error" role="alert">
              <p>{photoError}</p>
              <button
                className="secondary-button"
                onClick={() => setReloadAttempt((attempt) => attempt + 1)}
                disabled={photoLoading}
              >
                {photoLoading ? "Retrying…" : "Retry Loading Photo"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="empty-state photo-empty">
          <Camera size={32} />
          <h3>No current recovery photo</h3>
          <p>Request a front or back camera photo using the recovery controls above.</p>
        </div>
      )}
    </article>
  );
}
