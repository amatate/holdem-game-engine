import { Worker } from 'node:worker_threads';
import type { ActionIntent } from '../../core/legal-actions.js';
import type { PlayerObservationV1 } from '../../agents/types.js';

export type DecisionRunner = (observation: PlayerObservationV1, seed: string, budgetMs: number) => Promise<ActionIntent>;

/** The WebSocket event loop never runs the equity calculation. Terminate late workers. */
export function workerDecision(agent: string, samples: number): DecisionRunner {
  return (observation, seed, budgetMs) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./decision-worker.js', import.meta.url), {
      workerData: { observation, agent, samples, seed }, resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const finish = (action?: ActionIntent, reason = 'worker-error') => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      void worker.terminate();
      if (action) resolve(action); else reject(new Error(reason));
    };
    const timer = setTimeout(() => finish(undefined, 'decision-timeout'), Math.max(1, budgetMs));
    worker.once('message', (message: { action?: ActionIntent }) => finish(message.action));
    worker.once('error', () => finish());
    worker.once('exit', () => finish());
  });
}
