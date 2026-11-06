import type { Checkpoint } from './checkpoint-data.js';
/** Known Second Night v1 builds only. Full deterministic replay and digest check are still mandatory. */
export const SECOND_NIGHT_V1_BUILDS = [
  'ea8224b38859777b21d6d47856d8c3758bb72341819aa01f479fa6aa1bc100b1',
  '3bebf287a40a7b117bf31c693ab6da3d03b485c486ef582884b95bed3c97a10e',
  'd689dd4e647cef43bed7b4b88e32d80ca035474c61dab00ff07adb4fd969848f',
  'e3acbc4e8b77638847401ac62f0728d0ff025f3ba16ae0256e2e9ccef13b0266',
  '0cf21ca788c800b31f1d5246fe5dc1d603a8499348473f7638ab48a1c99eea04',
] as const;
/** First Volume release 6e8aa94: source, Node build and published Pages worker.
 * The original first-volume command/view semantics stay frozen; replay and the
 * complete table digest must still match before any continuation is permitted.
 */
export const VOLUME_ONE_RELEASE_BUILDS = [
  '439bdb7040a7888ac3ab79c919427eb6c790cef2478f4a4ca7ce8fe229b44d55',
  '3657e3c88812392f599156703b3399bfef741d7338da84171bbab590e312de22',
  '6314c7818fefab7ec11aff9150b1bae0f2fcb14e958d5d17c0ad1c999a9cdb38',
] as const;
export function compatibleStorySave(saved: Checkpoint, version: string): boolean {
  return saved.engine===version || saved.setup.experience==='second-night'
    && (SECOND_NIGHT_V1_BUILDS.some(v=>v===saved.engine)
      || VOLUME_ONE_RELEASE_BUILDS.some(v=>v===saved.engine));
}
