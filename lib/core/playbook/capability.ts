// Which sports have a Playbook renderer built. The Playbook (play diagrams +
// editor) draws on a sport-specific surface — today only the basketball court
// (lib/core/playbook/court.ts) exists. Add a sport here the moment its field/
// court renderer ships (Football is next — Phase B of the multi-sport work).
//
// This gates ONLY the Playbook. Upload, playback, sharing, tagging, and the
// content feed are all sport-neutral and must never be gated by this.
import { isFootballSport } from '@/lib/core/upload-meta';

// Basketball plus the whole football family (Football / 7-on-7 / Flag) have a
// renderer today. Add a sport here the moment its field/court renderer ships.
export function sportHasPlaybook(sport: string | null | undefined): boolean {
  if (!sport) return false;
  return sport.toLowerCase() === 'basketball' || isFootballSport(sport);
}
