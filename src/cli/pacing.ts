export type LinePacer = (message: string) => Promise<void>;

export function createLinePacer(
  write: (line: string) => void,
  wait: (milliseconds: number) => Promise<void>,
  intervalMs: number,
): LinePacer {
  let hasWrittenLine = false;

  return async (message) => {
    if (message.length === 0) return;
    const lines = message.split('\n');
    if (lines.at(-1) === '') lines.pop();

    for (const line of lines) {
      if (hasWrittenLine) await wait(intervalMs);
      write(line);
      hasWrittenLine = true;
    }
  };
}
