import type { RenderBlock } from './turn-renderer.js';

export interface SemanticPacingRuntime {
  readonly write: (message: string) => void;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export async function playRenderBlocks(
  blocks: readonly Readonly<RenderBlock>[],
  runtime: Readonly<SemanticPacingRuntime>,
): Promise<void> {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.delayBeforeMs > 0) await runtime.sleep(block.delayBeforeMs);
    runtime.write(block.text);
  }
}
