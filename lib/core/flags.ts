// Feature flags. Deliberately a hardcoded allowlist rather than a preferences system:
// per CLAUDE.md invariant 6 the background uploader ships ON for Adam's account only
// and OFF for everyone else, and widens only after real-device testing. Building a
// settings surface for a flag that has one user would be the wrong shape.

const BACKGROUND_UPLOAD_USER_IDS = new Set<string>([
  '7f1122bd-f2e6-4006-adf7-728ff3709cc5', // Adam
]);

/**
 * Native-iOS background multipart upload. Callers must ALSO confirm they are on a
 * native iOS build with the module present — web stays on TUS and is not in scope.
 */
export function isBackgroundUploadAllowed(userId?: string | null): boolean {
  return !!userId && BACKGROUND_UPLOAD_USER_IDS.has(userId);
}
