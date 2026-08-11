// Shared "is this shared, or Only-you?" derivation — the single source of truth so
// every surface (Film Room now; walls/coaches-corner later) agrees. RN-agnostic
// (lib/core). The Film Room already batch-loads a `destinations` array per card
// (one `shares` query for N cards), so slice 1 just derives from that — no new query.
//
// A later slice adds loadShareStatus(items) — a batch `shares` query — for surfaces
// that render cards WITHOUT preloading destinations. Same output shape, so <ContentCard>
// never changes.

export type ShareStatus = {
  shared: boolean;   // has this content been shared to at least one destination?
  count: number;     // how many destinations (for a "shared to N" affordance if wanted)
};

// Derive from an already-loaded destinations array (Film Room's Destination[]).
export function deriveShareStatus(destinations: unknown[] | null | undefined): ShareStatus {
  const count = destinations?.length ?? 0;
  return { shared: count > 0, count };
}
