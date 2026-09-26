// Client-generated idempotency keys (Slice D3 / plan v2 §3.1).
//
// WHY: create_kid / create_roster_placeholder / reconcile_players are idempotent per
// (caller, request_id). A double-tap, a retry after a timeout, and a resubmit after a dropped
// response all collapse onto ONE row instead of creating a second child. The id must be
// generated ONCE PER FORM OPEN — not per tap — and reset after a success, so the next child
// gets a fresh key.
//
// This is an idempotency key, not a secret: it only has to be unique, and the database scopes
// its uniqueness to the creating user, so guessing another user's key reveals nothing.
// crypto.randomUUID is used where available (web over HTTPS, and Hermes on current Expo SDKs);
// the fallback keeps native working on any runtime that lacks it.
//
// RN-agnostic: no react-native imports, so iOS and web share it.

export function newRequestId(): string {
  const c: any = (globalThis as any)?.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // fall through to the manual path
    }
  }
  // RFC 4122 version 4 shape. getRandomValues when we have it, Math.random otherwise.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
