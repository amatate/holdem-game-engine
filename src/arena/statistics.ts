import { createSeededRandom } from '../core/random.js';

export function mean(values: readonly number[]): number {
  if (values.length === 0 || values.some(v => !Number.isFinite(v))) throw new Error('Expected finite samples');
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1))]!;
}

/** Resample independent deal/match blocks, NEVER individual seat rotations. */
export function blockConfidence95(blockMeans: readonly number[], seed: string): readonly [number, number] | null {
  if (blockMeans.length < 30) return null;
  if (blockMeans.some(v => !Number.isFinite(v))) throw new Error('Expected finite block means');
  const random = createSeededRandom(seed, 'arena/bootstrap-v1');
  const estimates: number[] = [];
  for (let repetition = 0; repetition < 2000; repetition += 1) {
    let total = 0;
    for (let i = 0; i < blockMeans.length; i += 1) {
      total += blockMeans[Math.floor(random.nextFloat() * blockMeans.length)]!;
    }
    estimates.push(total / blockMeans.length);
  }
  return [percentile(estimates, .025)!, percentile(estimates, .975)!];
}
