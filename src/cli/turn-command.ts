import type { ActionIntent } from '../core/legal-actions.js';
import type { SessionCommand } from '../game/session-types.js';
import type { ClassicDecisionPacket, RenderableCommand } from '../game/turn-packet.js';
import type { PromptIO } from './prompts.js';

const INVALID_COMMAND_MESSAGE = '无效操作，请输入当前合法命令。';
const CANNOT_CHECK_MESSAGE = '当前不能过牌，请跟注或弃牌。';
const TURN_PROMPT = '请选择操作（f/x/c/r <加注到>/a）：';

export type TurnCommandParseResult =
  | Readonly<{ ok: true; command: Readonly<SessionCommand> }>
  | Readonly<{ ok: false; message: string }>;

function reject(message = INVALID_COMMAND_MESSAGE): TurnCommandParseResult {
  return { ok: false, message };
}

function snapshotFixedIntent(
  intent: Readonly<Exclude<ActionIntent, { type: 'raiseTo' }>>,
): Exclude<ActionIntent, { type: 'raiseTo' }> {
  switch (intent.type) {
    case 'fold': return { type: 'fold' };
    case 'check': return { type: 'check' };
    case 'call': return { type: 'call' };
    case 'allIn': return { type: 'allIn' };
  }
}

function commandForFixedInput(
  input: string,
  commands: readonly Readonly<RenderableCommand>[],
): Exclude<ActionIntent, { type: 'raiseTo' }> | null {
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
    const command = commands[commandIndex]!;
    if (command.kind !== 'fixed') continue;
    for (let inputIndex = 0; inputIndex < command.inputs.length; inputIndex += 1) {
      if (command.inputs[inputIndex] === input) return snapshotFixedIntent(command.intent);
    }
  }
  return null;
}

function hasFixedIntent(
  type: Exclude<ActionIntent, { type: 'raiseTo' }>['type'],
  commands: readonly Readonly<RenderableCommand>[],
): boolean {
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.kind === 'fixed' && command.intent.type === type) return true;
  }
  return false;
}

function acceptedAct(
  packet: Readonly<ClassicDecisionPacket>,
  intent: ActionIntent,
): TurnCommandParseResult {
  return {
    ok: true,
    command: {
      type: 'act',
      decisionKey: packet.decisionKey,
      expectedPacketIndex: packet.packetIndex,
      intent,
    },
  };
}

export function parseTurnCommand(
  input: string,
  packet: Readonly<ClassicDecisionPacket>,
): TurnCommandParseResult {
  const answer = input.trim();
  const targetedAbility = /^u (peek|read) ([0-9]+)$/.exec(answer);
  if (targetedAbility !== null) {
    const targetSeatIndex = Number(targetedAbility[2]);
    if (!Number.isSafeInteger(targetSeatIndex)) return reject();
    const ability = targetedAbility[1] as 'peek' | 'read';
    return {
      ok: true,
      command: {
        type: 'useAbility',
        decisionKey: packet.decisionKey,
        expectedPacketIndex: packet.packetIndex,
        ability,
        targetSeatIndex,
      },
    };
  }
  const swap = /^u swap ([12])$/.exec(answer);
  if (swap !== null) {
    return {
      ok: true,
      command: {
        type: 'useAbility',
        decisionKey: packet.decisionKey,
        expectedPacketIndex: packet.packetIndex,
        ability: 'swap',
        holeCardIndex: swap[1] === '1' ? 0 : 1,
      },
    };
  }
  if (answer === 'f' || answer === 'x' || answer === 'c' || answer === 'a') {
    const intent = commandForFixedInput(answer, packet.actionPanel.commands);
    if (intent !== null) return acceptedAct(packet, intent);
    if (answer === 'x' && hasFixedIntent('call', packet.actionPanel.commands)) {
      return reject(CANNOT_CHECK_MESSAGE);
    }
    return reject();
  }

  const raise = /^r ([0-9]+)$/.exec(answer);
  if (raise !== null) {
    const amount = Number(raise[1]);
    if (Number.isSafeInteger(amount)) {
      for (let index = 0; index < packet.actionPanel.commands.length; index += 1) {
        const command = packet.actionPanel.commands[index]!;
        if (command.kind === 'raise-range'
          && amount >= command.minimum
          && amount <= command.maximum) {
          return acceptedAct(packet, { type: 'raiseTo', amount });
        }
      }
    }
  }
  return reject();
}

export async function promptForTurnCommand(
  packet: Readonly<ClassicDecisionPacket>,
  io: Readonly<PromptIO>,
): Promise<Readonly<SessionCommand>> {
  while (true) {
    const parsed = parseTurnCommand(await io.question(TURN_PROMPT), packet);
    if (parsed.ok) return parsed.command;
    io.write(parsed.message);
  }
}
