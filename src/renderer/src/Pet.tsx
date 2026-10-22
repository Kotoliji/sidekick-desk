import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { PetNote, TileStatus } from '../../shared/protocol';
import { NOTE_ICON } from './notes';
import { frame, HEART, PALETTE, SPRITE_H, SPRITE_W } from './octopus';

// A chat waiting on the user matters more than a finished answer, so it stays up longer.
const NOTE_MS = { sidekick: 9000, done: 12000, waiting: 30000, long: 30000, conflict: 45000 } as const;
const DRAG_THRESHOLD = 3;
/** Pressing this long without moving is a hold (the octopus is petted), not a click. */
const HOLD_MS = 280;

function Sprite({ blink, legs, happy }: { blink: boolean; legs: 'a' | 'b'; happy: boolean }) {
  const rects = useMemo(
    () =>
      frame({ blink, legs, happy }).flatMap((row, y) =>
        [...row].map((ch, x) => (ch === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={PALETTE[ch]} />)),
      ),
    [blink, legs, happy],
  );
  return (
    <svg className="octo-sprite" viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`} shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
}

function Heart({ i }: { i: number }) {
  return (
    <svg className="heart" style={{ ['--i' as string]: i }} viewBox="0 0 5 4" shapeRendering="crispEdges" aria-hidden>
      {HEART.flatMap((row, y) => [...row].map((ch, x) => ch === 'x' && <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#ff5c80" />))}
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
  const [happy, setHappy] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean; held: boolean } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const happyTimer = useRef<number | undefined>(undefined);
  const busy = status === 'thinking' || status === 'streaming';

  // Swim faster while Sidekick is working, and wiggle while being petted.
  useEffect(() => {
    const t = setInterval(() => setLegs((l) => (l === 'a' ? 'b' : 'a')), happy ? 160 : busy ? 220 : 520);
    return () => clearInterval(t);
  }, [busy, happy]);

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
    const t = setTimeout(() => setNotes((q) => q.slice(1)), NOTE_MS[current.kind]);
    return () => clearTimeout(t);
  }, [current]);

  const interactive = (on: boolean) => !drag.current && window.sidekick.setInteractive(on);

  // A click opens or closes the chat, a drag moves the octopus, a hold makes it happy.
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = { x: e.screenX, y: e.screenY, moved: false, held: false };
    drag.current = d;
    window.clearTimeout(happyTimer.current);
    holdTimer.current = window.setTimeout(() => {
      d.held = true;
      setHappy(true);
    }, HOLD_MS);
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.screenX - d.x;
    const dy = e.screenY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      window.clearTimeout(holdTimer.current);
      setHappy(false);
    }
    d.moved = true;
    d.x = e.screenX;
    d.y = e.screenY;
    window.sidekick.moveBy(dx, dy);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    window.clearTimeout(holdTimer.current);
    if (!d || d.moved) return;
    if (d.held) {
      // Let the joy linger a moment after letting go.
      happyTimer.current = window.setTimeout(() => setHappy(false), 900);
      return;
    }
    setNotes([]);
    window.sidekick.togglePanel();
  };

  return (
    <div className="pet-root">
      {current && (
        <div
          className="bubble"
          data-kind={current.kind}
          key={current.id}
          onMouseEnter={() => interactive(true)}
          onMouseLeave={() => interactive(false)}
        >
          <button className="bubble-close" onClick={() => setNotes((q) => q.slice(1))} title="Dismiss">
            ×
          </button>
          <button
            className="bubble-body"
            onClick={() => {
              // The chat keeps every note as a card, so clear them all and show it there.
              setNotes([]);
              window.sidekick.showPanel();
            }}
            title="Open the chat"
          >
            <span className="bubble-title">
              {NOTE_ICON[current.kind]}
              {current.title}
              {notes.length > 1 && <span className="bubble-more">+{notes.length - 1}</span>}
            </span>
            <span className="bubble-text">{current.text}</span>
          </button>
        </div>
      )}

      <div
        className={`octo ${excited ? 'is-excited' : ''} ${busy ? 'is-busy' : ''} ${happy ? 'is-happy' : ''}`}
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
        {happy && [0, 1, 2].map((i) => <Heart key={i} i={i} />)}
        <div className="octo-float">
          <Sprite blink={blink} legs={legs} happy={happy} />
        </div>
        <span className="octo-shadow" />
      </div>
    </div>
  );
}
