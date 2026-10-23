import React from "react";
import { Crosshair, Download, ExternalLink, MapPin, Navigation } from "lucide-react";
import type { Device, LocationState } from "../../types/device";

type LocationCardProps = {
  device: Device;
  formatTime: (value: string | number | null | undefined) => string;
  mapEmbedUrl: (location: LocationState) => string;
  googleMapsUrl: (location: LocationState) => string;
  onShareLocation: () => void;
  onDownloadReport: () => void;
};

export function LocationCard({
  device,
  formatTime,
  mapEmbedUrl,
  googleMapsUrl,
  onShareLocation,
  onDownloadReport,
}: LocationCardProps) {
  return (
    <article className="location-card glass-panel">
      <div className="card-heading">
        <div>
          <span className="eyebrow">LAST KNOWN LOCATION</span>
          <h2>Device map</h2>
        </div>
        <MapPin size={22} />
      </div>
      {device.location ? (
        <>
          <div className="map-frame">
            <iframe
              title="Last known device location"
              src={mapEmbedUrl(device.location)}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin"
            />
            <div className="map-overlay">
              <Navigation size={15} /> Last known position
            </div>
          </div>
          <div className="location-meta">
            <div>
              <span>Coordinates</span>
              <strong>
                {device.location.latitude.toFixed(6)},{" "}
                {device.location.longitude.toFixed(6)}
              </strong>
            </div>
            <div>
              <span>Accuracy</span>
              <strong>{device.location.accuracyMeters ?? "--"} m</strong>
            </div>
            <div>
              <span>Location time</span>
              <strong>{formatTime(device.location.timestamp)}</strong>
            </div>
          </div>
          <div className="card-actions">
            <a
              className="primary-button"
              target="_blank"
              rel="noreferrer"
              href={googleMapsUrl(device.location)}
            >
              <ExternalLink size={17} /> Open in Maps
            </a>
            <button className="secondary-button" onClick={onShareLocation}>
              <Navigation size={17} /> Share Location
            </button>
            <button className="secondary-button" onClick={onDownloadReport}>
              <Download size={17} /> Download Report
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <Crosshair size={30} />
          <h3>No location yet</h3>
          <p>Use Get Location to request the latest available position.</p>
        </div>
      )}
    </article>
  );
}
