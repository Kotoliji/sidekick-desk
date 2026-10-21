import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { PetNote, TileStatus } from '../../shared/protocol';
import { frame, PALETTE, SPRITE_H, SPRITE_W } from './octopus';

const NOTE_MS = 9000;
const DRAG_THRESHOLD = 3;

function Sprite({ blink, legs }: { blink: boolean; legs: 'a' | 'b' }) {
  const rects = useMemo(
    () =>
      frame({ blink, legs }).flatMap((row, y) =>
        [...row].map((ch, x) => (ch === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={PALETTE[ch]} />)),
      ),
    [blink, legs],
  );
  return (
    <svg className="octo-sprite" viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`} shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
}

/** The octopus: floats, blinks, shows notes as speech bubbles, unfolds into the chat on click. */
export function Pet() {
  const [legs, setLegs] = useState<'a' | 'b'>('a');
  const [blink, setBlink] = useState(false);
  const [status, setStatus] = useState<TileStatus>('idle');
  const [notes, setNotes] = useState<PetNote[]>([]);
  const [excited, setExcited] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const busy = status === 'thinking' || status === 'streaming';

  // Swim faster while Sidekick is working.
  useEffect(() => {
    const t = setInterval(() => setLegs((l) => (l === 'a' ? 'b' : 'a')), busy ? 220 : 520);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    let t: number;
    const schedule = () => {
      t = window.setTimeout(() => {
        setBlink(true);
        window.setTimeout(() => setBlink(false), 140);
        schedule();
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => window.sidekick.onStatus(setStatus), []);
  useEffect(
    () =>
      window.sidekick.onNote((n) => {
        setNotes((q) => [...q, n]);
        setExcited(true);
        window.setTimeout(() => setExcited(false), 700);
      }),
    [],
  );

  // Each bubble lingers, then makes room for the next.
  const current = notes[0];
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setNotes((q) => q.slice(1)), NOTE_MS);
    return () => clearTimeout(t);
  }, [current]);

  const interactive = (on: boolean) => !drag.current && window.sidekick.setInteractive(on);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.screenX, y: e.screenY, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.screenX - d.x;
    const dy = e.screenY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.x = e.screenX;
    d.y = e.screenY;
    window.sidekick.moveBy(dx, dy);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      setNotes([]);
      window.sidekick.togglePanel();
    }
  };

  return (
    <div className="pet-root">
      {current && (
        <div className="bubble" key={current.id} onMouseEnter={() => interactive(true)} onMouseLeave={() => interactive(false)}>
          <button className="bubble-close" onClick={() => setNotes((q) => q.slice(1))} title="Dismiss">
            ×
          </button>
          <button
            className="bubble-body"
            onClick={() => {
              setNotes([]);
              window.sidekick.togglePanel();
            }}
          >
            <span className="bubble-title">
              {current.title}
              {notes.length > 1 && <span className="bubble-more">+{notes.length - 1}</span>}
            </span>
            <span className="bubble-text">{current.text}</span>
          </button>
        </div>
      )}

      <div
        className={`octo ${excited ? 'is-excited' : ''} ${busy ? 'is-busy' : ''}`}
        title="Sidekick: click to open, drag to move, right-click for menu"
        onMouseEnter={() => interactive(true)}
        onMouseLeave={() => interactive(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          window.sidekick.petMenu();
        }}
      >
        {busy && (
          <span className="octo-think" aria-label="thinking">
            <i />
            <i />
            <i />
          </span>
        )}
        <div className="octo-float">
          <Sprite blink={blink} legs={legs} />
        </div>
        <span className="octo-shadow" />
      </div>
    </div>
  );
}
