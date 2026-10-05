import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';

// Read-only inspection; this script never modifies generated image pixels.
const version = process.argv.includes('--draft') ? 'v1' : 'v2';
const files = ['rock', 'small-ball', 'trapper', 'value-bettor'].map(name => name + '-' + version + '.png').concat('entrance-rain-v1.png');
const paeth = (a, b, c) => {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
};
for (const file of files) {
  const bytes = readFileSync(new URL(file, import.meta.url));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const record = { file, width, height, bytes: bytes.length, colorType: bytes[25] };
  if (file.startsWith('entrance')) {
    assert(width > height, 'Entrance must be landscape');
    console.log(JSON.stringify(record));
    continue;
  }
  assert.equal(width, 1536); assert.equal(height, 1024);
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6); assert.equal(bytes[28], 0);
  const parts = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = width * 4, cellWidth = width / 3;
  assert.equal(raw.length, height * (stride + 1));
  let previous = new Uint8Array(stride);
  const cells = Array.from({ length: 3 }, () => ({ transparent: 0, nearOpaque: 0, bounds: [cellWidth, height, -1, -1], edgePixels: 0 }));
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride), start = y * (stride + 1), filter = raw[start];
    assert(filter >= 0 && filter <= 4);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0, up = previous[x], corner = x >= 4 ? previous[x - 4] : 0;
      row[x] = (raw[start + 1 + x] + [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter]) & 255;
      if (x % 4 !== 3) continue;
      const px = Math.floor(x / 4), localX = px % cellWidth, cell = cells[Math.floor(px / cellWidth)];
      if (row[x] === 0) cell.transparent++;
      if (row[x] >= 250) {
        cell.nearOpaque++;
        cell.bounds[0] = Math.min(cell.bounds[0], localX);
        cell.bounds[1] = Math.min(cell.bounds[1], y);
        cell.bounds[2] = Math.max(cell.bounds[2], localX);
        cell.bounds[3] = Math.max(cell.bounds[3], y);
        if (localX === 0 || localX === cellWidth - 1) cell.edgePixels++;
      }
    }
    previous = row;
  }
  for (const cell of cells) {
    assert(cell.transparent > cellWidth * height * .05, 'Need real alpha-zero negative space');
    assert(cell.nearOpaque > cellWidth * height * .2, 'Need substantially opaque figure interiors');
    if (version === 'v2') assert.equal(cell.edgePixels, 0, 'Figure must not touch either cell boundary');
  }
  console.log(JSON.stringify({ ...record, cells }));
}
