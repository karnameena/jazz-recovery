export type LocationState = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  timestamp?: number | string | null;
};

export type PhotoState = {
  dataUrl: string;
  camera?: string | null;
  timestamp?: number | string | null;
};

export type Device = {
  id: number;
  deviceId?: string;
  deviceName: string;
  deviceType: string;
  online: boolean;
  battery: number | null;
  charging?: boolean;
  network: string;
  lastSeen: string | null;
  locationServices?: "ON" | "OFF" | "UNKNOWN" | "OFFLINE";
  locationServicesLastConfirmed?: number | null;
  mode: string;
  location: LocationState | null;
  photo: PhotoState | null;
};
