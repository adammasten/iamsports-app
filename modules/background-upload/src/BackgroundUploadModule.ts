import { NativeModule, requireNativeModule } from 'expo';

// Events the native side emits back to JS during a background upload.
export type BackgroundUploadEvents = {
  onProgress: (e: { uploadId: string; progress: number }) => void;        // progress 0..1
  onComplete: (e: { uploadId: string; status: number; etag?: string }) => void;
  onError: (e: { uploadId: string; error?: string; status?: number; body?: string }) => void;
};

declare class BackgroundUploadModuleType extends NativeModule<BackgroundUploadEvents> {
  // Sanity check that the native module is linked + callable.
  ping(): Promise<string>;
  // Upload a local file (file:// uri) to a presigned/signed PUT url via an iOS
  // background URLSession. Survives app backgrounding / screen lock. Resolves once
  // the task is ENQUEUED (not finished) — completion arrives via the onComplete event.
  startUpload(uploadId: string, fileUri: string, uploadUrl: string, headers: Record<string, string>): Promise<void>;
}

export default requireNativeModule<BackgroundUploadModuleType>('BackgroundUpload');
