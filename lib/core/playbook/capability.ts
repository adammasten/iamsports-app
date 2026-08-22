// Which sports have a Playbook renderer built. The Playbook (play diagrams +
// editor) draws on a sport-specific surface — today only the basketball court
// (lib/core/playbook/court.ts) exists. Add a sport here the moment its field/
// court renderer ships (Football is next — Phase B of the multi-sport work).
//
// This gates ONLY the Playbook. Upload, playback, sharing, tagging, and the
// content feed are all sport-neutral and must never be gated by this.
export const PLAYBOOK_SPORTS = ['Basketball'] as const;

export function sportHasPlaybook(sport: string | null | undefined): boolean {
  return !!sport && (PLAYBOOK_SPORTS as readonly string[]).includes(sport);
}
