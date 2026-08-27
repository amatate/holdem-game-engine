import { describe, expect, it } from 'vitest';

import { createSeededRandom } from '../../src/core/random.js';
import {
  EVENT_SCHEMA_VERSION,
  RNG_ALGORITHM_VERSION,
  RULES_VERSION,
  SHUFFLE_ALGORITHM_VERSION,
  STRATEGY_VERSION,
} from '../../src/core/versions.js';

describe('deterministic random source', () => {
  it('repeats the same stream for the same seed and path', () => {
    const a = createSeededRandom('run-1', 'deck/1');
    const b = createSeededRandom('run-1', 'deck/1');

    expect([a.nextUint32(), a.nextUint32()]).toEqual([
      b.nextUint32(),
      b.nextUint32(),
    ]);
  });

  it('locks the versioned hash and Mulberry32 golden vector', () => {
    const rng = createSeededRandom('run-1', 'deck/1');

    expect(rng.seedHash).toBe(4_120_237_477);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()])
      .toEqual([2_338_597_589, 3_202_163_317, 1_263_586_442]);
  });

  it('fork consumption cannot perturb the parent stream', () => {
    const a = createSeededRandom('run-1');
    const b = createSeededRandom('run-1');

    a.fork('agent').nextUint32();
    expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('publishes replay compatibility versions', () => {
    expect({
      eventSchema: EVENT_SCHEMA_VERSION,
      rules: RULES_VERSION,
      rng: RNG_ALGORITHM_VERSION,
      shuffle: SHUFFLE_ALGORITHM_VERSION,
      strategy: STRATEGY_VERSION,
    }).toEqual({
      eventSchema: 1,
      rules: 'holdem-v1',
      rng: 'mulberry32-v1',
      shuffle: 'fisher-yates-v1',
      strategy: 'parametric-v1',
    });
  });
});
