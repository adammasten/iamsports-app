// Shared football (incl. flag) tagging vocabulary + types. Used by BOTH the web
// tagger (app/tagging-overlay.web.tsx) and the native tagger (the football port),
// so the two never drift — add a term once and both get it. These single-select
// chips fill the structured clip_football fields (one per column).

export type Odk = 'offense' | 'defense' | 'kicking';

// The ODK toggle stamps each clip's possession (saved to clip_football.odk) and is
// sticky across clips; flipping offense<->defense starts a new drive.
export const ODK_SHORT: Record<Odk, string> = { offense: 'OFF', defense: 'DEF', kicking: 'K' };
export const ODK_LABEL: Record<Odk, string> = { offense: 'Offense', defense: 'Defense', kicking: 'Kicking' };

export type FbCtx = { odk: Odk; down: number | null; distance: number | null; drive: number };
export type FbSel = { formation: string | null; play: string | null; result: string | null };

// ── Offense ──────────────────────────────────────────────────────────────────
export const FB_FORMATIONS = ['Shotgun', 'Under Center', 'Pistol', 'Empty', 'I-Form', 'Trips', 'Bunch'];
export const FB_PLAY_TYPES = [
  'Run Inside', 'Run Outside', 'Run Left', 'Run Right', 'Jet Sweep', 'Sweep/Toss',
  'Reverse', 'Option/Read', 'Draw', 'RPO', 'Play Action', 'Screen', 'Pass', 'QB Run',
];
export const FB_RESULT_OFF = ['1st Down', 'TD', 'Complete', 'Incomplete', 'Rush', 'Sack', 'Fumble', 'INT', 'Penalty', 'No Gain'];

// ── Defense ──────────────────────────────────────────────────────────────────
export const FB_FRONTS = ['4-3', '3-4', '4-2-5', 'Nickel', 'Bear', '3-3 Stack'];
export const FB_COVERAGES = ['Cover 0', 'Cover 1', 'Cover 2', 'Cover 3', 'Cover 4', 'Man', 'Zone'];
export const FB_RESULT_DEF = ['Stop', 'TFL', 'Sack', 'INT', 'PBU', 'Forced Fumble', '1st Down Allowed', 'TD Allowed', 'Penalty'];

// ── Special teams / kicking ──────────────────────────────────────────────────
export const FB_ST_UNITS = ['Kickoff', 'Punt', 'FG', 'PAT', 'Return', 'Onside'];
export const FB_RESULT_ST = ['Good', 'Miss', 'Return TD', 'Block', 'Muff', 'Downed'];

// Results depend on which unit is on the field.
export function fbResultsForOdk(odk: Odk): string[] {
  return odk === 'offense' ? FB_RESULT_OFF : odk === 'defense' ? FB_RESULT_DEF : FB_RESULT_ST;
}
