import { NativeModule, requireNativeModule } from 'expo';

export type UploadPart = { partNumber: number; url: string };

// Events the native side emits back to JS during a background upload.
export type BackgroundUploadEvents = {
  onProgress: (e: { uploadId: string; progress: number }) => void;  // progress 0..1
  onComplete: (e: {
    uploadId: string;
    status?: number;                                  // single-PUT: HTTP status
    etag?: string;                                    // single-PUT: object ETag
    parts?: { partNumber: number; etag: string }[];   // multipart: per-part ETags → send to 'complete'
  }) => void;
  onError: (e: { uploadId: string; error?: string; status?: number; part?: number; body?: string }) => void;
};

declare class BackgroundUploadModuleType extends NativeModule<BackgroundUploadEvents> {
  // Sanity check that the native module is linked + callable.
  ping(): Promise<string>;

  // Single presigned/signed PUT via a background URLSession. Survives backgrounding /
  // lock. Resolves once ENQUEUED; result arrives via onComplete/onError.
  startUpload(uploadId: string, fileUri: string, uploadUrl: string, headers: Record<string, string>): Promise<void>;

  // Multipart: split the file at `partSize` boundaries and upload each part to its
  // presigned S3 UploadPart URL (from the multipart-upload Edge Function). onComplete
  // fires with `parts` (partNumber + ETag) — pass those to the 'complete' action.
  startMultipartUpload(uploadId: string, fileUri: string, partSize: number, parts: UploadPart[]): Promise<void>;
}

export default requireNativeModule<BackgroundUploadModuleType>('BackgroundUpload');
