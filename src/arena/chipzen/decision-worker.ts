import { parentPort, workerData } from 'node:worker_threads';
import { arenaAgent } from '../agents.js';
import { deepFreezeObservation } from '../../agents/observation.js';
import { createSeededRandom } from '../../core/random.js';
import type { PlayerObservationV1 } from '../../agents/types.js';

const data = workerData as { observation: PlayerObservationV1; agent: string; samples: number; seed: string };
try {
  const decision = await arenaAgent(data.agent, data.samples).create().decide({
    observation: deepFreezeObservation(data.observation), random: createSeededRandom(data.seed),
  });
  parentPort!.postMessage({ action: decision.action });
} catch { parentPort!.postMessage({ error: 'strategy-error' }); }
