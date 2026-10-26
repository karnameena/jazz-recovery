import { Camera, Download } from "lucide-react";
import type { PhotoState } from "../../types/device";

type RecoveryPhotoCardProps = {
  photo: PhotoState | null;
  formatTime: (value: string | number | null | undefined) => string;
  onDownloadReport: () => void;
};

export function RecoveryPhotoCard({
  photo,
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
      {photo ? (
        <>
          <div className="photo-frame">
            <img src={photo.dataUrl} alt="Latest recovery" />
          </div>
          <div className="photo-meta">
            <span>{photo.camera || "camera"} camera</span>
            <span>{formatTime(photo.timestamp)}</span>
          </div>
          <div className="card-actions">
            <a
              className="primary-button"
              href={photo.dataUrl}
              download={`jazz-recovery-${photo.camera || "photo"}.jpg`}
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
          <p>
            Request the front or back camera using the recovery controls above.
          </p>
        </div>
      )}
    </article>
  );
}
