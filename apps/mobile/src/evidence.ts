import AsyncStorage from "@react-native-async-storage/async-storage";
import { decode } from "base64-arraybuffer";
import { NativeModules } from "react-native";
import { supabase } from "./supabase";

const evidenceKeyPrefix = "flockiq:field-evidence";

export interface PendingEvidence {
  id: string;
  farmId: string;
  flockId: string | null;
  localPath: string;
  localUri: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  deviceCapturedAt: string;
  timezone: string;
  locationSource: "fresh_gps" | "last_known" | "permission_denied" | "none" | string;
  locationStatus: "available" | "approximate_last_known" | "unavailable" | string;
  locationCapturedAt: string | null;
  locationAgeSeconds: number | null;
  notes: string;
  idempotencyKey: string;
  capturedBy: string;
  syncStatus: "pending" | "failed" | "synced";
  uploadState?: "captured" | "uploaded" | "committed";
  error?: string;
}

export interface RemoteEvidence {
  id: string;
  farm_id: string;
  flock_id: string | null;
  signedUrl: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  device_captured_at: string;
  notes: string | null;
}

interface CaptureResult {
  uri: string;
  path: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  deviceCapturedAt: string;
  timezone: string;
  locationSource: string;
  locationStatus: string;
  locationCapturedAt: string | null;
  locationAgeSeconds: number | null;
  sizeBytes: number;
}

interface CaptureContext {
  farmName: string;
  flockName: string;
  operatorLabel: string;
  evidenceId: string;
}

export interface LocationStatus {
  permissionGranted: boolean;
  providerEnabled: boolean;
  fixAvailable: boolean;
  accuracyMeters: number | null;
}

interface NativeCaptureModule {
  capturePhoto(context: CaptureContext): Promise<CaptureResult>;
  getLocationStatus(): Promise<LocationStatus>;
  readFileBase64(path: string): Promise<string>;
  deleteLocalFile(path: string): Promise<boolean>;
}

const nativeCapture = NativeModules.FieldCapture as NativeCaptureModule | undefined;
let queueOperation: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(operation: () => Promise<T>) {
  const next = queueOperation.then(operation, operation);
  queueOperation = next.then(() => undefined, () => undefined);
  return next;
}

async function getEvidenceContext() {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("Sign in before accessing field evidence");
  return { userId, key: `${evidenceKeyPrefix}:${userId}` };
}

async function readEvidence(key: string) {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value as PendingEvidence[] : [];
  } catch {
    return [];
  }
}

async function writeEvidence(key: string, items: PendingEvidence[]) {
  await AsyncStorage.setItem(key, JSON.stringify(items));
}

async function updateEvidence(key: string, id: string, update: (item: PendingEvidence) => PendingEvidence | null) {
  const items = await readEvidence(key);
  const next = items.flatMap((item) => {
    if (item.id !== id) return [item];
    const updated = update(item);
    return updated ? [updated] : [];
  });
  await writeEvidence(key, next);
  return next;
}

export async function captureFieldEvidence(params: { id: string; farmId: string; flockId: string | null; farmName: string; flockName: string; operatorLabel: string; notes: string }) {
  if (!nativeCapture) throw new Error("Camera capture is unavailable in this Android build");
  const context = await getEvidenceContext();
  const result = await nativeCapture.capturePhoto({
    farmName: params.farmName,
    flockName: params.flockName,
    operatorLabel: params.operatorLabel,
    evidenceId: params.id
  });
  if (result.sizeBytes > 9_500_000) throw new Error("Photo is too large. Retake it at a lower camera resolution.");
  const item: PendingEvidence = {
    id: params.id,
    farmId: params.farmId,
    flockId: params.flockId,
    localPath: result.path,
    localUri: result.uri,
    latitude: result.latitude,
    longitude: result.longitude,
    accuracyMeters: result.accuracyMeters,
    deviceCapturedAt: result.deviceCapturedAt,
    timezone: result.timezone,
    locationSource: result.locationSource,
    locationStatus: result.locationStatus,
    locationCapturedAt: result.locationCapturedAt,
    locationAgeSeconds: result.locationAgeSeconds,
    notes: params.notes,
    idempotencyKey: `evidence-${params.id}`,
    capturedBy: context.userId,
    syncStatus: "pending",
    uploadState: "captured"
  };
  try {
    await withQueueLock(async () => {
      const items = await readEvidence(context.key);
      await writeEvidence(context.key, [item, ...items.filter((existing) => existing.id !== item.id)]);
    });
  } catch (error) {
    await nativeCapture.deleteLocalFile(result.path).catch(() => false);
    throw error;
  }
  return item;
}

export async function getLocationStatus(): Promise<LocationStatus> {
  if (!nativeCapture) return { permissionGranted: false, providerEnabled: false, fixAvailable: false, accuracyMeters: null };
  return nativeCapture.getLocationStatus();
}

export async function getEvidenceQueue() {
  const { key } = await getEvidenceContext();
  return withQueueLock(async () => (await readEvidence(key)).filter((item) => item.syncStatus !== "synced"));
}

export async function syncEvidenceQueue() {
  return withQueueLock(async () => {
    if (!nativeCapture) throw new Error("Native evidence module is unavailable");
    const { userId, key } = await getEvidenceContext();
    const items = await readEvidence(key);

    for (const original of items.filter((item) => item.syncStatus !== "synced")) {
      if (original.capturedBy && original.capturedBy !== userId) continue;
      try {
        const storagePath = `${original.farmId}/${userId}/${original.id}.jpg`;
        if (original.uploadState !== "uploaded" && original.uploadState !== "committed") {
          const base64 = await nativeCapture.readFileBase64(original.localPath);
          const { error: uploadError } = await supabase.storage.from("field-evidence").upload(storagePath, decode(base64), { contentType: "image/jpeg", upsert: false });
          const conflict = uploadError && String((uploadError as { statusCode?: string | number }).statusCode) === "409";
          if (uploadError && !conflict) throw uploadError;
          await updateEvidence(key, original.id, (item) => ({ ...item, capturedBy: userId, uploadState: "uploaded", syncStatus: "pending" }));
        }

        const metadataParams = {
          evidence_id: original.id,
          target_farm_id: original.farmId,
          target_flock_id: original.flockId,
          object_path: storagePath,
          captured_latitude: original.latitude,
          captured_longitude: original.longitude,
          captured_accuracy: original.accuracyMeters,
          captured_at: original.deviceCapturedAt,
          captured_timezone: original.timezone,
          captured_notes: original.notes,
          captured_location_status: {
            status: original.locationStatus ?? (original.latitude == null ? "unavailable" : "available"),
            source: original.locationSource ?? (original.latitude == null ? "none" : "legacy"),
            location_captured_at: original.locationCapturedAt ?? null,
            location_age_seconds: original.locationAgeSeconds ?? null,
            accuracy_meters: original.accuracyMeters ?? null
          },
          sync_key: original.idempotencyKey
        };
        const { error: metadataError } = await supabase.rpc("finalize_field_evidence", metadataParams);
        const missingLocationStatusParam = metadataError && ["PGRST202", "42883"].includes(String(metadataError.code));
        if (missingLocationStatusParam) {
          const legacyParams: Omit<typeof metadataParams, "captured_location_status"> & { captured_location_status?: unknown } = { ...metadataParams };
          delete legacyParams.captured_location_status;
          const { error: legacyError } = await supabase.rpc("finalize_field_evidence", legacyParams);
          if (legacyError) throw legacyError;
        } else if (metadataError) {
          throw metadataError;
        }
        await updateEvidence(key, original.id, (item) => ({ ...item, uploadState: "committed", syncStatus: "pending" }));
        const deleted = await nativeCapture.deleteLocalFile(original.localPath);
        if (!deleted) throw new Error("Upload succeeded, but local cleanup will be retried");
        await updateEvidence(key, original.id, () => null);
      } catch (error) {
        await updateEvidence(key, original.id, (item) => ({ ...item, syncStatus: "failed", error: error instanceof Error ? error.message : "Evidence sync failed" }));
      }
    }
    return (await readEvidence(key)).filter((item) => item.syncStatus !== "synced");
  });
}

export async function fetchVisibleEvidence(farmId: string): Promise<RemoteEvidence[]> {
  const { data, error } = await supabase.from("field_evidence")
    .select("id, farm_id, flock_id, storage_path, latitude, longitude, accuracy_meters, device_captured_at, notes")
    .eq("farm_id", farmId).is("deleted_at", null).order("device_captured_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not load uploaded photos: ${error.message}`);
  if (!data?.length) return [];
  const paths = data.map((item) => item.storage_path);
  const signed = await supabase.storage.from("field-evidence").createSignedUrls(paths, 900);
  if (signed.error) throw new Error(`Could not stream uploaded photos: ${signed.error.message}`);
  const urls = new Map((signed.data ?? []).map((item, index) => [paths[index], item.signedUrl]));
  return data.flatMap((item) => {
    const signedUrl = urls.get(item.storage_path);
    return signedUrl ? [{ ...item, signedUrl }] : [];
  });
}
