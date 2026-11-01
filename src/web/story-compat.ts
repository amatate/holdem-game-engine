import type { Checkpoint } from './checkpoint-data.js';
/** Known Second Night v1 builds only. Full deterministic replay and digest check are still mandatory. */
export const SECOND_NIGHT_V1_BUILDS = [
  'ea8224b38859777b21d6d47856d8c3758bb72341819aa01f479fa6aa1bc100b1',
  '3bebf287a40a7b117bf31c693ab6da3d03b485c486ef582884b95bed3c97a10e',
  'd689dd4e647cef43bed7b4b88e32d80ca035474c61dab00ff07adb4fd969848f',
  'e3acbc4e8b77638847401ac62f0728d0ff025f3ba16ae0256e2e9ccef13b0266',
  '0cf21ca788c800b31f1d5246fe5dc1d603a8499348473f7638ab48a1c99eea04',
] as const;
export function compatibleStorySave(saved: Checkpoint, version: string): boolean {
  return saved.engine===version || saved.setup.experience==='second-night'
    && SECOND_NIGHT_V1_BUILDS.some(v=>v===saved.engine);
}
