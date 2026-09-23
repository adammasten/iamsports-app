// WHO MAY PUT A CLIP IN A REEL — the client-side mirror of the database function
// public.may_reel_clip(uuid). RN-agnostic, no imports, so both taggers' surfaces
// (make-highlight, export) share ONE rule instead of each keeping its own.
//
// The database is the authority: highlight_reels INSERT/UPDATE carry a WITH CHECK
// that runs may_reel_clip() over source_clip_ids, and the reel row is reserved
// BEFORE the render. This module exists so the UI never offers a clip the server
// will reject — not as the security boundary.
//
// KEEP THE TWO IN SYNC. If this logic changes, change may_reel_clip() with it.

export type EligibilityTag = {
  bundle: number;                 // clip_tags.bundle_number (0 = clip-level)
  category: string;
  playerId: string | null;        // tags.player_id
  polarity: string | null;        // tags.tag_polarity
};

export type EligibilityClip = {
  teamId: string | null;
  origin: 'team' | 'personal' | null;
  createdByUserId: string | null;
  tags: EligibilityTag[];
};

export type EligibilityContext = {
  userId: string | null;
  /** Teams where this user is admin / head_coach / coach. */
  coachTeamIds: Set<string>;
  /** Player ids this user is a linked guardian for — or, for a single-kid reel, just that kid. */
  linkedPlayerIds: Set<string>;
};

// A parent qualifies only when their linked player and a POSITIVE tag share the
// SAME bundle, and that bundle is > 0. That is what stops:
//   • another kid's positive bundle qualifying my kid, and
//   • a clip-level positive (a team Touchdown at bundle 0) qualifying anyone.
function hasOwnPositiveAction(clip: EligibilityClip, linkedPlayerIds: Set<string>): boolean {
  if (linkedPlayerIds.size === 0) return false;
  const myBundles = new Set<number>();
  for (const t of clip.tags) {
    if (t.bundle > 0 && t.category === 'players' && t.playerId && linkedPlayerIds.has(t.playerId)) {
      myBundles.add(t.bundle);
    }
  }
  if (myBundles.size === 0) return false;
  return clip.tags.some(
    (t) => myBundles.has(t.bundle) && t.polarity === 'positive' && t.category !== 'players',
  );
}

export function mayReelClip(clip: EligibilityClip, ctx: EligibilityContext): boolean {
  // Coach/admin on the clip's team — unrestricted (positive, neutral, negative).
  if (clip.teamId && ctx.coachTeamIds.has(clip.teamId)) return true;
  // My own personal clip — unrestricted for me, whatever its polarity. This is the
  // Film Room workflow: film I may watch, clipped by me, mine to use.
  if (clip.origin === 'personal' && clip.createdByUserId && clip.createdByUserId === ctx.userId) return true;
  // Otherwise it is someone else's team/coach clip: positive-own-action only.
  return hasOwnPositiveAction(clip, ctx.linkedPlayerIds);
}

// Convenience for callers holding raw `clip_tags ( bundle_number, tags (...) )` rows.
export function toEligibilityTags(clipTags: any[]): EligibilityTag[] {
  return (clipTags || [])
    .map((ct: any) => {
      const t = ct?.tags;
      if (!t) return null;
      return {
        bundle: ct.bundle_number ?? 0,
        category: t.category,
        playerId: t.player_id ?? null,
        polarity: t.tag_polarity ?? null,
      } as EligibilityTag;
    })
    .filter(Boolean) as EligibilityTag[];
}
