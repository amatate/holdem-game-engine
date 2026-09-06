import type { WebTable } from './protocol.js';

export interface TableReadTool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: true; untrustedContentHint: false };
  execute(input: unknown): unknown;
}
export interface TableToolContext {
  registerTool(tool: TableReadTool, options?: { signal: AbortSignal }): void | Promise<void>;
}

export function installTableReadTool(context: TableToolContext | undefined, readTable: () => WebTable | null): AbortController {
  const lifecycle = new AbortController();
  if (!context?.registerTool) return lifecycle;
  try {
    void Promise.resolve(context.registerTool({
      name: 'read_holdem_table', title: '读取当前可见牌桌',
      description: 'Read the human-visible Hold’em table, legal actions, public results and any private intel legitimately acquired in ability mode. Does not place bets, use abilities or expose other hidden cards.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0) {
          return { error: 'This tool only reads the visible table.' };
        }
        const table = readTable();
        return table === null ? { status: 'no-table' } : structuredClone({ status: 'active', table });
      },
    }, { signal: lifecycle.signal })).catch(() => { /* Optional browser capability; poker remains usable. */ });
  } catch { /* Unsupported implementations must not prevent opening the table. */ }
  return lifecycle;
}
