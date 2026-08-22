// PlayPlayer (web) — interactive play viewer. Press ▶ and the players slide
// along their routes; scrub the slider to move through the play by hand; Step
// advances one action at a time; Reset snaps back to the starting alignment.
//
// Web-only (uses a rAF loop + DOM slider). The frame comes from the pure
// renderPlayFrameSvg(doc, t) — this component only owns time + the controls.
// Native falls back to the static PlayPlayer.tsx (no SVG animator on device yet).

import { surfaceSize } from '@/lib/core/playbook/court';
import type { PlayDoc } from '@/lib/core/playbook/playDoc';
import { renderPlayFrameSvg } from '@/lib/core/playbook/renderPlay';
import { useEffect, useRef, useState } from 'react';
// react-dom ships no bundled types in this RN project; it's present at runtime
// on web (this is a .web.tsx file). Portal lifts the fullscreen overlay above
// every card's stacking context.
// @ts-ignore
import { createPortal } from 'react-dom';

const DURATION_MS = 4200; // full play, start → finish

export default function PlayPlayer({ doc, allowFullscreen = true }: { doc: PlayDoc; allowFullscreen?: boolean }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fs, setFs] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | undefined>(undefined);
  const last = useRef(0);
  const steps = Math.max(1, doc.actions.length);

  // redraw the current frame whenever time (or the play) changes
  useEffect(() => { if (holder.current) holder.current.innerHTML = renderPlayFrameSvg(doc, t); }, [doc, t]);

  // rAF advance while playing; auto-stop at the end
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / DURATION_MS;
      last.current = now;
      setT(prev => {
        const next = prev + dt;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing]);

  // Close fullscreen on Escape.
  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFs(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fs]);

  const { w, h } = surfaceSize(doc.surface);
  const playPause = () => { setT(p => (p >= 1 ? 0 : p)); setPlaying(p => !p); };
  const reset = () => { setPlaying(false); setT(0); };
  const step = () => { setPlaying(false); setT(p => Math.min(1, (Math.floor(p * steps + 1e-6) + 1) / steps)); };

  return (
    <div style={{ width: '100%' }}>
      <div
        ref={holder}
        onDoubleClick={() => { if (allowFullscreen) setFs(true); }}
        title={allowFullscreen ? 'Double-click for full screen' : undefined}
        style={{ width: '100%', aspectRatio: `${w} / ${h}`, borderRadius: 10, overflow: 'hidden', background: doc.surface === 'field' ? '#2f6b3a' : '#f4ead4', cursor: allowFullscreen ? 'zoom-in' : 'default' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button onClick={playPause} style={btnPrimary}>{playing ? '❚❚ Pause' : t >= 1 ? '↻ Replay' : '▶ Play'}</button>
        <input
          type="range" min={0} max={1000} value={Math.round(t * 1000)}
          onChange={e => { setPlaying(false); setT(Number((e.target as HTMLInputElement).value) / 1000); }}
          style={{ flex: 1, accentColor: '#ff6a2c', cursor: 'pointer' }}
          aria-label="Scrub play"
        />
        <button onClick={step} style={btnGhost}>Step</button>
        <button onClick={reset} style={btnGhost}>Reset</button>
        {allowFullscreen ? <button onClick={() => setFs(true)} style={btnGhost} title="Full screen" aria-label="Full screen">⛶</button> : null}
      </div>

      {fs && typeof document !== 'undefined'
        ? createPortal(
            <div
              onClick={() => setFs(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(6,12,20,0.92)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            >
              <div onClick={e => e.stopPropagation()} style={{ width: 'min(94vw, 1100px)', maxHeight: '92vh', overflow: 'auto', position: 'relative' }}>
                {doc.name ? <div style={{ color: '#f1f4f6', fontSize: 18, fontWeight: 800, marginBottom: 10, paddingRight: 40 }}>{doc.name}</div> : null}
                <button onClick={() => setFs(false)} style={{ ...btnGhost, position: 'absolute', top: 0, right: 0, fontSize: 18, padding: '4px 12px' }} aria-label="Close full screen">✕</button>
                <PlayPlayer doc={doc} allowFullscreen={false} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const btnBase: React.CSSProperties = {
  border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap',
};
const btnPrimary: React.CSSProperties = { ...btnBase, background: '#ff6a2c', color: '#160b02' };
const btnGhost: React.CSSProperties = { ...btnBase, background: 'transparent', color: '#9db0bd', border: '1px solid #25333f' };
