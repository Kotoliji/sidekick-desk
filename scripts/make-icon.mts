/**
 * Renders the octopus sprite into build/icon.png (256×256) for the installer and exe.
 * Run: npx tsx scripts/make-icon.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { frame, PALETTE, SPRITE_H, SPRITE_W } from '../src/renderer/src/octopus.ts';

const SIZE = 256;
const CELL = Math.floor(SIZE / Math.max(SPRITE_W, SPRITE_H)); // 12px per sprite pixel
const offX = Math.floor((SIZE - SPRITE_W * CELL) / 2);
const offY = Math.floor((SIZE - SPRITE_H * CELL) / 2);

const rgba = Buffer.alloc(SIZE * SIZE * 4); // transparent
frame({ blink: false, legs: 'a' }).forEach((row, y) =>
  [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const hex = PALETTE[ch];
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let dy = 0; dy < CELL; dy++)
      for (let dx = 0; dx < CELL; dx++) {
        const p = ((offY + y * CELL + dy) * SIZE + offX + x * CELL + dx) * 4;
        rgba.set([r, g, b, 255], p);
      }
  }),
);

// Minimal PNG: signature, IHDR, one IDAT (filter 0 per row), IEND.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
const raw = Buffer.concat(Array.from({ length: SIZE }, (_, y) => Buffer.concat([Buffer.from([0]), rgba.subarray(y * SIZE * 4, (y + 1) * SIZE * 4)])));

mkdirSync('build', { recursive: true });
writeFileSync(
  'build/icon.png',
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
);
console.log('build/icon.png written');
