import { expect, it } from 'vitest';
import { installTableReadTool, type TableToolContext, type TableReadTool } from '../../src/web/agent-tools.js';

it('makes the currently visible table readable without adding a hidden state or mutation channel', async () => {
  let registered: TableReadTool | undefined;
  const context: TableToolContext = { registerTool(tool) { registered = tool; } };
  installTableReadTool(context, () => null);
  expect(registered?.name).toBe('read_holdem_table');
  expect(registered?.annotations.readOnlyHint).toBe(true);
  expect(registered?.execute({})).toEqual({ status: 'no-table' });
  expect(registered?.execute({ action: 'allIn' })).toEqual({ error: 'This tool only reads the visible table.' });
  expect(() => installTableReadTool(undefined, () => null)).not.toThrow();
});
