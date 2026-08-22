// PlayEditor (web) — draw your own play. Drag the 5 players + ball to set the
// formation, then draw each player's route; name it, tag it, save it to a team.
// Web-only (pointer drag + DOM controls). The live preview reuses the pure
// renderer, so what you draw is exactly what everyone else will see.
//
// Save writes a real play + its first version to Supabase (RLS: is_team_coach).

import { useTeamContext } from '@/context';
import { surfaceSize } from '@/lib/core/playbook/court';
import { fetchCoachTags, fetchLibraryPlay, propagateToTeams, saveLibraryPlay, updateLibraryPlay } from '@/lib/core/playbook/library';
import type { Action, ActionType, PlayDoc, Surface, Token } from '@/lib/core/playbook/playDoc';
import { renderPlaySvg } from '@/lib/core/playbook/renderPlay';
import { ALL_PLAY_TAGS, PLAY_TAG_GROUPS, tagColor } from '@/lib/core/playbook/tags';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

type Sport = 'basketball' | 'football';

// Starting formation per sport — a neutral set the coach then drags into place.
const BASKETBALL_TOKENS = (): Token[] => ([
  { id: 'p1', kind: 'offense', label: '1', pos: { x: 0.50, y: 0.80 } },
  { id: 'p2', kind: 'offense', label: '2', pos: { x: 0.15, y: 0.55 } },
  { id: 'p3', kind: 'offense', label: '3', pos: { x: 0.85, y: 0.55 } },
  { id: 'p4', kind: 'offense', label: '4', pos: { x: 0.30, y: 0.30 } },
  { id: 'p5', kind: 'offense', label: '5', pos: { x: 0.70, y: 0.30 } },
  { id: 'ball', kind: 'ball', pos: { x: 0.53, y: 0.79 } },
]);

// Football: 5 O-line on the LOS (plain circles) + QB/RB + X/Y/Z/TE — a balanced
// spread the coach rearranges into whatever formation they want.
const FOOTBALL_TOKENS = (): Token[] => ([
  { id: 'lt', kind: 'offense', pos: { x: 0.36, y: 0.60 } },
  { id: 'lg', kind: 'offense', pos: { x: 0.43, y: 0.60 } },
  { id: 'c',  kind: 'offense', pos: { x: 0.50, y: 0.60 } },
  { id: 'rg', kind: 'offense', pos: { x: 0.57, y: 0.60 } },
  { id: 'rt', kind: 'offense', pos: { x: 0.64, y: 0.60 } },
  { id: 'qb', kind: 'offense', label: 'QB', pos: { x: 0.50, y: 0.75 } },
  { id: 'rb', kind: 'offense', label: 'RB', pos: { x: 0.42, y: 0.80 } },
  { id: 'te', kind: 'offense', label: 'TE', pos: { x: 0.30, y: 0.595 } },
  { id: 'x',  kind: 'offense', label: 'X', pos: { x: 0.10, y: 0.595 } },
  { id: 'y',  kind: 'offense', label: 'Y', pos: { x: 0.74, y: 0.585 } },
  { id: 'z',  kind: 'offense', label: 'Z', pos: { x: 0.90, y: 0.595 } },
  { id: 'ball', kind: 'ball', pos: { x: 0.50, y: 0.63 } },
]);

const startTokens = (sport: Sport): Token[] => (sport === 'football' ? FOOTBALL_TOKENS() : BASKETBALL_TOKENS());

// Notation choices per sport (both map to the shared ActionType renderer).
const ACTION_TYPES_BY_SPORT: Record<Sport, { type: ActionType; label: string }[]> = {
  basketball: [
    { type: 'move', label: 'Cut' },
    { type: 'dribble', label: 'Dribble' },
    { type: 'pass', label: 'Pass' },
    { type: 'screen', label: 'Screen' },
  ],
  football: [
    { type: 'move', label: 'Route' },
    { type: 'pass', label: 'Pass' },
    { type: 'screen', label: 'Block' },
    { type: 'handoff', label: 'Handoff' },
  ],
};

export default function PlayEditor({ editId }: { editId?: string }) {
  const { userId } = useTeamContext();
  const [sport, setSport] = useState<Sport>('basketball');
  const surface: Surface = sport === 'football' ? 'field' : 'half';
  const { w, h } = surfaceSize(surface);
  const actionTypes = ACTION_TYPES_BY_SPORT[sport];

  const [tokens, setTokens] = useState<Token[]>(() => startTokens('basketball'));
  const [actions, setActions] = useState<Action[]>([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState('');
  const [coachTags, setCoachTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Route-drawing state. When drawFor is set we're placing points for that token.
  const [drawFor, setDrawFor] = useState<string | null>(null);
  const [drawType, setDrawType] = useState<ActionType>('move');
  const [drawPts, setDrawPts] = useState<{ x: number; y: number }[]>([]);
  // Current BEAT — routes drawn now share this beat and animate together.
  // "New beat" advances it so the next routes happen after.
  const [currentBeat, setCurrentBeat] = useState(1);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragId = useRef<string | null>(null);

  useEffect(() => { if (userId) fetchCoachTags(userId).then(setCoachTags).catch(() => {}); }, [userId]);
  // Edit mode: preload the existing library play.
  useEffect(() => {
    if (!editId) return;
    fetchLibraryPlay(editId).then(p => {
      if (!p.doc) return;
      if (p.doc.sport === 'football' || p.doc.sport === 'basketball') setSport(p.doc.sport);
      setTokens(p.doc.tokens); setActions(p.doc.actions ?? []);
      setName(p.doc.name ?? ''); setNote(p.doc.note ?? ''); setTags(p.tags);
    }).catch(e => setErr(e?.message ?? String(e)));
  }, [editId]);

  // Switch sport (new play only) — swap to that sport's surface + starting
  // formation. Discards the current formation/routes, so it's a fresh start.
  function changeSport(s: Sport) {
    if (s === sport) return;
    setSport(s);
    setTokens(startTokens(s));
    setActions([]);
    setDrawFor(null); setDrawPts([]); setDrawType('move'); setCurrentBeat(1);
  }
  const addTag = (t: string) => { const v = t.trim(); if (!v) return; setTags(s => (s.some(x => x.toLowerCase() === v.toLowerCase()) ? s : [...s, v])); setTagQuery(''); };

  // Live document = committed actions + the in-progress route (so you see it draw).
  const doc: PlayDoc = useMemo(() => {
    const draft: Action[] = drawFor && drawPts.length >= 1
      ? [{ id: 'draft', type: drawType, fromToken: drawFor, step: currentBeat, path: drawPts.length >= 2 ? drawPts : [tokens.find(t => t.id === drawFor)!.pos, drawPts[0]] }]
      : [];
    return { schema_version: 1, sport, surface, name: name || 'Untitled play', tokens, actions: [...actions, ...draft] };
  }, [sport, surface, name, tokens, actions, drawFor, drawPts, drawType, currentBeat]);

  useEffect(() => {
    if (!boxRef.current) return;
    const svg = renderPlaySvg(doc)
      .replace(/ width="\d+" height="\d+"/, '')
      .replace('<svg ', '<svg style="width:100%;height:100%;display:block;pointer-events:none" ');
    boxRef.current.innerHTML = svg;
  }, [doc]);

  function toNorm(e: React.PointerEvent) {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }

  function onDown(e: React.PointerEvent) {
    const n = toNorm(e);
    if (drawFor) { setDrawPts(p => [...p, n]); return; }   // draw mode: drop a point
    // move mode: grab the nearest token within ~5%
    let best: string | null = null, bestD = 0.06;
    tokens.forEach(t => { const d = Math.hypot(t.pos.x - n.x, t.pos.y - n.y); if (d < bestD) { bestD = d; best = t.id; } });
    if (best) { dragId.current = best; try { (e.target as Element).setPointerCapture(e.pointerId); } catch {} }
  }
  function onMove(e: React.PointerEvent) {
    if (!dragId.current) return;
    const n = toNorm(e);
    setTokens(ts => ts.map(t => (t.id === dragId.current ? { ...t, pos: n } : t)));
  }
  function onUp() { dragId.current = null; }

  function commitDraw() {
    if (drawFor && drawPts.length >= 1) {
      const start = tokens.find(t => t.id === drawFor)!.pos;
      const path = drawPts.length >= 2 ? drawPts : [start, drawPts[0]];
      setActions(a => [...a, { id: 'a' + a.length, type: drawType, fromToken: drawFor!, path, step: currentBeat }]);
    }
    setDrawFor(null); setDrawPts([]);
  }
  function toggleTag(t: string) { setTags(s => (s.includes(t) ? s.filter(x => x !== t) : [...s, t])); }

  async function save() {
    setErr(null); setSaved(null);
    if (!name.trim()) { setErr('Give the play a name.'); return; }
    if (!userId) { setErr('You’re not signed in.'); return; }
    setSaving(true);
    try {
      const finalDoc: PlayDoc = { schema_version: 1, sport, surface, name: name.trim(), note: note.trim() || undefined, tokens, actions };
      if (editId) {
        await updateLibraryPlay({ id: editId, doc: finalDoc, tags });
        const n = await propagateToTeams({ libraryPlayId: editId, doc: finalDoc, tags, userId });
        setSaved(`Updated in My Playbook${n > 0 ? ` — and pushed to ${n} team${n === 1 ? '' : 's'}` : ''}.`);
      } else {
        await saveLibraryPlay({ doc: finalDoc, tags, userId });
        setSaved('Saved to My Playbook.');
      }
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setSaving(false); }
  }

  const playerTokens = tokens.filter(t => t.kind === 'offense');

  return (
    <div style={S.wrap}>
      {/* Court */}
      <div style={S.courtCol}>
        <div
          ref={boxRef}
          style={{ ...S.court, background: surface === 'field' ? '#2f6b3a' : '#f4ead4', aspectRatio: `${w} / ${h}`, cursor: drawFor ? 'crosshair' : 'grab' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        <div style={S.hint}>
          {drawFor
            ? `Click points on the ${surface === 'field' ? 'field' : 'court'} to trace the ${actionTypes.find(a => a.type === drawType)?.label ?? drawType} for ${tokens.find(t => t.id === drawFor)?.label || tokens.find(t => t.id === drawFor)?.id.toUpperCase() || ''} — then Finish route.`
            : 'Drag players & the ball to set your formation. Then pick a player below to draw a route.'}
        </div>
      </div>

      {/* Controls */}
      <div style={S.panel}>
        <div style={S.field}>
          <label style={S.label}>Sport</label>
          <div style={S.chipRow}>
            {(['basketball', 'football'] as Sport[]).map(s => (
              <button
                key={s}
                onClick={() => { if (!editId) changeSport(s); }}
                style={{ ...S.chip, ...(sport === s ? S.chipOn : {}), ...(editId ? { cursor: 'default', opacity: sport === s ? 1 : 0.35 } : {}) }}
              >{s === 'football' ? '🏈 Football' : '🏀 Basketball'}</button>
            ))}
          </div>
          <span style={S.beatHint}>{editId ? 'Sport is fixed once a play is created.' : 'Switching sport starts a fresh formation.'}</span>
        </div>

        <div style={S.field}>
          <label style={S.label}>Play name</label>
          <input style={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Horns — quick hitter" />
        </div>

        <div style={S.field}>
          <label style={S.label}>Draw a route</label>
          <div style={{ ...S.chipRow, alignItems: 'center' }}>
            <span style={S.beatTag}>Beat {currentBeat}</span>
            <span style={S.beatHint}>routes you draw now move together</span>
            <button onClick={() => setCurrentBeat(b => b + 1)} style={S.ghostSm}>＋ New beat</button>
            {currentBeat > 1 ? <button onClick={() => setCurrentBeat(b => Math.max(1, b - 1))} style={S.ghostSm}>◄ Beat {currentBeat - 1}</button> : null}
          </div>
          {drawFor ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={S.chipRow}>
                {actionTypes.map(a => (
                  <button key={a.type} onClick={() => setDrawType(a.type)} style={{ ...S.chip, ...(drawType === a.type ? S.chipOn : {}) }}>{a.label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={commitDraw} style={S.primarySm}>Finish route ({drawPts.length} pts)</button>
                <button onClick={() => { setDrawFor(null); setDrawPts([]); }} style={S.ghostSm}>Cancel</button>
                {drawPts.length > 0 ? <button onClick={() => setDrawPts(p => p.slice(0, -1))} style={S.ghostSm}>Undo pt</button> : null}
              </div>
            </div>
          ) : (
            <div style={S.chipRow}>
              {playerTokens.map(t => (
                <button key={t.id} onClick={() => { setDrawFor(t.id); setDrawPts([]); }} style={S.chip}>{t.label ? t.label : t.id.toUpperCase()}</button>
              ))}
            </div>
          )}
          {actions.length > 0 ? (
            <div style={{ ...S.chipRow, marginTop: 8 }}>
              {actions.map((a, i) => (
                <button key={i} onClick={() => setActions(list => list.filter((_, j) => j !== i))} style={{ ...S.chip, ...S.routeChip }}>
                  B{a.step ?? i + 1} · {tokens.find(t => t.id === a.fromToken)?.label} · {a.type} ✕
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={S.field}>
          <label style={S.label}>Coach’s notes</label>
          <textarea style={{ ...S.input, minHeight: 60, resize: 'vertical' }} value={note} onChange={e => setNote(e.target.value)} placeholder="What you’re teaching…" />
        </div>

        {(() => {
          const pool = Array.from(new Set([...ALL_PLAY_TAGS, ...coachTags]));
          const q = tagQuery.trim().toLowerCase();
          const matches = q ? pool.filter(t => t.toLowerCase().includes(q) && !tags.includes(t)).slice(0, 24) : [];
          const canCreate = !!q && !pool.some(t => t.toLowerCase() === q) && !tags.some(t => t.toLowerCase() === q);
          return (
            <div style={S.field}>
              <label style={S.label}>Tags</label>
              {tags.length > 0 ? (
                <div style={S.chipRow}>
                  {tags.map(t => (
                    <button key={t} onClick={() => toggleTag(t)} style={{ ...S.tag, background: tagColor(t), color: '#0e1b2c', borderColor: tagColor(t) }}>{t}  ✕</button>
                  ))}
                </div>
              ) : null}
              <input
                style={S.input}
                placeholder="Search tags, or type your own…"
                value={tagQuery}
                onChange={e => setTagQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) addTag(matches[0]); else if (canCreate) addTag(tagQuery); } }}
              />
              {q ? (
                <div style={S.chipRow}>
                  {matches.map(t => <button key={t} onClick={() => addTag(t)} style={S.tag}>{t}</button>)}
                  {canCreate ? <button onClick={() => addTag(tagQuery)} style={{ ...S.tag, borderColor: '#1D9E75', color: '#3ec48c' }}>＋ Create “{tagQuery.trim()}”</button> : null}
                  {matches.length === 0 && !canCreate ? <span style={S.beatHint}>already added</span> : null}
                </div>
              ) : (
                PLAY_TAG_GROUPS.map(g => {
                  const avail = g.tags.filter(t => !tags.includes(t));
                  if (avail.length === 0) return null;
                  return (
                    <div key={g.key} style={{ marginBottom: 8 }}>
                      <div style={S.tagGroupLabel}>{g.label}</div>
                      <div style={S.chipRow}>{avail.map(t => <button key={t} onClick={() => addTag(t)} style={S.tag}>{t}</button>)}</div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {err ? <div style={S.err}>{err}</div> : null}
        {saved ? (
          <div style={S.ok}>
            {saved}{' '}
            <button onClick={() => router.push('/my-playbook')} style={S.linkBtn}>Go to My Playbook →</button>
          </div>
        ) : null}

        <button onClick={save} disabled={saving} style={{ ...S.primary, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editId ? 'Update play' : 'Save play'}</button>
        <button onClick={() => { setTokens(startTokens(sport)); setActions([]); setName(''); setNote(''); setTags([]); setSaved(null); setErr(null); setCurrentBeat(1); setDrawFor(null); setDrawPts([]); }} style={S.ghost}>Reset</button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' },
  courtCol: { flex: '1 1 340px', minWidth: 300, maxWidth: 560 },
  court: { width: '100%', background: '#f4ead4', borderRadius: 12, touchAction: 'none', userSelect: 'none' },
  hint: { color: '#9db0bd', fontSize: 12.5, marginTop: 8, lineHeight: 1.5 },
  panel: { flex: '1 1 320px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { color: '#ff6a2c', fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' },
  input: { background: '#16232f', border: '1px solid #25333f', borderRadius: 8, color: '#f1f4f6', padding: '10px 12px', fontSize: 14, fontFamily: 'system-ui, sans-serif' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: { background: '#16232f', border: '1px solid #25333f', borderRadius: 999, color: '#c7d2dc', padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  chipOn: { background: '#ff6a2c', borderColor: '#ff6a2c', color: '#160b02' },
  routeChip: { borderColor: '#3a4b5a' },
  beatTag: { background: '#6c5ce7', color: '#fff', borderRadius: 999, padding: '5px 11px', fontSize: 12.5, fontWeight: 800 },
  beatHint: { color: '#7e8b98', fontSize: 11.5 },
  tagGroupLabel: { color: '#7e8b98', fontSize: 11, fontWeight: 700, marginBottom: 5 },
  tag: { background: '#16232f', border: '1px solid #25333f', borderRadius: 999, color: '#c7d2dc', padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  primary: { background: '#ff6a2c', border: 'none', borderRadius: 10, color: '#160b02', padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  primarySm: { background: '#1D9E75', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ghost: { background: 'transparent', border: '1px solid #25333f', borderRadius: 10, color: '#9db0bd', padding: '11px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  ghostSm: { background: 'transparent', border: '1px solid #25333f', borderRadius: 8, color: '#9db0bd', padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  err: { background: '#2a1416', border: '1px solid #5c2a2a', borderRadius: 8, color: '#ffb4a8', padding: 12, fontSize: 13.5 },
  ok: { background: '#12271e', border: '1px solid #1D9E75', borderRadius: 8, color: '#9be9c9', padding: 12, fontSize: 13.5 },
  linkBtn: { background: 'none', border: 'none', color: '#ff6a2c', fontWeight: 800, cursor: 'pointer', fontSize: 13.5 },
};
