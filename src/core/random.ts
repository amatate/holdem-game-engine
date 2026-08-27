import type { RandomSource } from './types.js';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const MULBERRY32_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 0x1_0000_0000;

function hashSeed(seed: string, path: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (const byte of new TextEncoder().encode(`${seed}\u0000${path}`)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

function appendPath(path: string, label: string): string {
  return path === '' ? label : `${path}/${label}`;
}

export function createSeededRandom(seed: string, path = ''): RandomSource {
  const seedHash = hashSeed(seed, path);
  let state = seedHash;

  const nextUint32 = (): number => {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };

  return {
    algorithm: 'mulberry32-v1',
    seedHash,
    nextUint32,
    nextFloat: () => nextUint32() / UINT32_RANGE,
    fork: (label) => createSeededRandom(seed, appendPath(path, label)),
  };
}
