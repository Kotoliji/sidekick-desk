/**
 * Sidekick's octopus, an original 20×18 pixel sprite.
 * One character per pixel; '.' is transparent.
 */

export const PALETTE: Record<string, string> = {
  o: '#2b1b2e', // outline
  p: '#ff8fa3', // body
  l: '#ffc4ce', // highlight
  d: '#e0607a', // shade
  c: '#ff5c80', // cheeks
  k: '#1d1020', // eyes
  w: '#ffffff', // eye glint
};

const HEAD = [
  '......oooooooo......',
  '....oollppppppoo....',
  '...olllpppppppppo...',
  '..opllpppppppppppo..',
  '..oplppppppppppppo..',
  '.oppppppppppppppppo.',
];

const EYES_OPEN = [
  '.opppwkppppppwkpppo.',
  '.opppkkppppppkkpppo.',
  '.opppkkppppppkkpppo.',
];

const EYES_CLOSED = [
  '.oppppppppppppppppo.',
  '.oppppppppppppppppo.',
  '.opppkkppppppkkpppo.',
];

const FACE = [
  '.opccpppkppkpppccpo.',
  '.opppppppkkppppppdo.',
  '.opppppppppppppppdo.',
  '.opppppppppppppppdo.',
];

// Two tentacle poses; alternating them makes the octopus "swim".
const LEGS_A = [
  '..oppoppoppoppoppo..',
  '..oppoppoppoppoppo..',
  '..oddoddoddoddoddo..',
  '...oo.oo.oo.oo.oo...',
  '....................',
];

const LEGS_B = [
  '..oppoppoppoppoppo..',
  '..oppoppoppoppoppo..',
  '..oddoppoddoppoddo..',
  '...oo.dd.oo.dd.oo...',
  '......oo....oo......',
];

export const SPRITE_W = 20;
export const SPRITE_H = 18;

export function frame(opts: { blink: boolean; legs: 'a' | 'b' }) {
  return [...HEAD, ...(opts.blink ? EYES_CLOSED : EYES_OPEN), ...FACE, ...(opts.legs === 'a' ? LEGS_A : LEGS_B)];
}
