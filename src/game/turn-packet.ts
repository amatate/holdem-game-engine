import { projectObservation } from '../agents/observation.js';
import type { PlayerObservationV1 } from '../agents/types.js';
import type { DomainEvent } from '../core/events.js';
import type { ActionIntent, LegalActionSet } from '../core/legal-actions.js';
import {
  projectEventsForViewer,
  type PublicGameEvent,
} from '../core/public-events.js';
import type { TournamentState } from '../core/state.js';
import type { DriverBoundary } from './tournament-driver.js';

const INVALID_TURN_PACKET_MESSAGE = 'Invalid turn packet data';

export interface ActionPanel {
  readonly currentBetTo: number;
  readonly facingBet: boolean;
  readonly tableCommittedTotal: number;
  readonly heroContestableTotal: number;
  readonly commands: readonly RenderableCommand[];
}

export type RenderableCommand =
  | Readonly<{
      kind: 'fixed';
      inputs: readonly string[];
      label: string;
      intent: Exclude<ActionIntent, { type: 'raiseTo' }>;
    }>
  | Readonly<{
      kind: 'raise-range';
      inputPattern: 'r <金额>';
      label: string;
      minimum: number;
      maximum: number;
    }>;

export interface PacketBase<
  TPrivateEvents extends readonly unknown[] = readonly [],
> {
  readonly schemaVersion: 1;
  readonly packetIndex: number;
  readonly coreEventRange: Readonly<{
    readonly fromVersionInclusive: number;
    readonly toVersionExclusive: number;
  }>;
  readonly viewerEventsSinceLastPacket: readonly PublicGameEvent[];
  readonly privateEventsSinceLastPacket: TPrivateEvents;
}

export type ClassicDecisionPacket = Readonly<PacketBase & {
  kind: 'decision';
  decisionKey: string;
  observation: Readonly<PlayerObservationV1>;
  actionPanel: Readonly<ActionPanel>;
  abilities: null;
}>;

export type TurnPacket = ClassicDecisionPacket;

export interface ClassicDecisionPacketInput {
  readonly state: Readonly<TournamentState>;
  readonly boundary: Readonly<Extract<DriverBoundary, { kind: 'decision' }>>;
  readonly humanSeatIndex: number;
  readonly packetIndex: number;
  readonly fromCoreVersion: number;
}

function freezeRecursively<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor | undefined;
    if (descriptor !== undefined && 'value' in descriptor) {
      freezeRecursively(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function requireSafeInteger(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
  return value as number;
}

function requireRecord(value: unknown): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
  return value as Record<PropertyKey, unknown>;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(INVALID_TURN_PACKET_MESSAGE);
  return value;
}

function snapshotLegalActions(value: unknown): LegalActionSet {
  const legal = requireRecord(value);
  const fold = requireBoolean(Reflect.get(legal, 'fold'));
  const check = requireBoolean(Reflect.get(legal, 'check'));
  const callValue = Reflect.get(legal, 'call');
  const raiseValue = Reflect.get(legal, 'raiseTo');
  const allInValue = Reflect.get(legal, 'allIn');
  const call = callValue === null
    ? null
    : (() => {
        const candidate = requireRecord(callValue);
        return {
          pay: requireSafeInteger(Reflect.get(candidate, 'pay'), 1),
          to: requireSafeInteger(Reflect.get(candidate, 'to'), 1),
          isAllIn: requireBoolean(Reflect.get(candidate, 'isAllIn')),
        };
      })();
  const raiseTo = raiseValue === null
    ? null
    : (() => {
        const candidate = requireRecord(raiseValue);
        const min = requireSafeInteger(Reflect.get(candidate, 'min'), 1);
        const max = requireSafeInteger(Reflect.get(candidate, 'max'), 1);
        if (min > max) throw new Error(INVALID_TURN_PACKET_MESSAGE);
        return { min, max };
      })();
  const allIn = allInValue === null
    ? null
    : (() => {
        const candidate = requireRecord(allInValue);
        const mode = Reflect.get(candidate, 'mode');
        if (mode !== 'call' && mode !== 'shortBet' && mode !== 'fullBet'
          && mode !== 'shortRaise' && mode !== 'fullRaise') {
          throw new Error(INVALID_TURN_PACKET_MESSAGE);
        }
        const safeMode = mode as NonNullable<LegalActionSet['allIn']>['mode'];
        return {
          to: requireSafeInteger(Reflect.get(candidate, 'to'), 1),
          mode: safeMode,
        };
      })();
  return { fold, check, call, raiseTo, allIn };
}

function sameDataTree(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, object>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null
    || typeof right !== 'object' || right === null
    || Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  const previous = seen.get(left);
  if (previous !== undefined) return previous === right;
  seen.set(left, right);
  const rightKeys = Reflect.ownKeys(right);
  for (let index = 0; index < rightKeys.length; index += 1) {
    if (!Object.hasOwn(rightKeys, index)) return false;
    const key = rightKeys[index]!;
    if (!Object.hasOwn(left, key)) return false;
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
    if (leftDescriptor === undefined || rightDescriptor === undefined
      || !('value' in leftDescriptor) || !('value' in rightDescriptor)
      || !sameDataTree(leftDescriptor.value, rightDescriptor.value, seen)) {
      return false;
    }
  }
  return true;
}

function buildActionPanelUnchecked(
  observation: Readonly<PlayerObservationV1>,
): Readonly<ActionPanel> {
  if (!Array.isArray(observation.seats)) throw new Error(INVALID_TURN_PACKET_MESSAGE);
  if (observation.seats.length < 2 || observation.seats.length > 6) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
  const actorSeatIndex = requireSafeInteger(observation.actorSeatIndex);
  const legal = snapshotLegalActions(observation.legalActions);
  const callPay = legal.call?.pay ?? 0;
  const hero = observation.seats[actorSeatIndex];
  if (hero === undefined) throw new Error(INVALID_TURN_PACKET_MESSAGE);
  const contestCap = requireSafeInteger(requireSafeInteger(hero.committedHand) + callPay);
  let currentBetTo = 0;
  let tableCommittedTotal = 0;
  let heroContestableTotal = callPay;
  for (let index = 0; index < observation.seats.length; index += 1) {
    if (!Object.hasOwn(observation.seats, index)) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const seat = observation.seats[index]!;
    const committedStreet = requireSafeInteger(seat.committedStreet);
    const committedHand = requireSafeInteger(seat.committedHand);
    currentBetTo = Math.max(currentBetTo, committedStreet);
    tableCommittedTotal = requireSafeInteger(tableCommittedTotal + committedHand);
    heroContestableTotal = requireSafeInteger(
      heroContestableTotal + Math.min(committedHand, contestCap),
    );
  }

  const commands: RenderableCommand[] = [];
  if (legal.fold) {
    commands.push({ kind: 'fixed', inputs: ['f'], label: '弃牌', intent: { type: 'fold' } });
  }
  if (legal.check) {
    commands.push({
      kind: 'fixed',
      inputs: ['x', 'c'],
      label: '过牌',
      intent: { type: 'check' },
    });
  }
  if (legal.call !== null) {
    commands.push({
      kind: 'fixed',
      inputs: ['c'],
      label: `跟注 ${legal.call.pay}${legal.call.isAllIn ? '（全下）' : ''}`,
      intent: { type: 'call' },
    });
  }
  if (legal.raiseTo !== null) {
    commands.push({
      kind: 'raise-range',
      inputPattern: 'r <金额>',
      label: currentBetTo === 0 ? '下注到' : '加注到',
      minimum: legal.raiseTo.min,
      maximum: legal.raiseTo.max,
    });
  }
  if (legal.allIn !== null && legal.allIn.mode !== 'call') {
    commands.push({
      kind: 'fixed',
      inputs: ['a'],
      label: `全下 ${legal.allIn.to}`,
      intent: { type: 'allIn' },
    });
  }

  return {
    currentBetTo,
    facingBet: legal.call !== null,
    tableCommittedTotal,
    heroContestableTotal,
    commands,
  };
}

export function buildActionPanel(
  observation: Readonly<PlayerObservationV1>,
): Readonly<ActionPanel> {
  try {
    return buildActionPanelUnchecked(observation);
  } catch {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
}

export function createDecisionKey(
  handNumber: number,
  seatIndex: number,
  decisionIndex: number,
): string {
  try {
    const safeHandNumber = requireSafeInteger(handNumber, 1);
    const safeSeatIndex = requireSafeInteger(seatIndex);
    const safeDecisionIndex = requireSafeInteger(decisionIndex);
    if (safeSeatIndex > 5) throw new Error(INVALID_TURN_PACKET_MESSAGE);
    return `hand/${safeHandNumber}/seat/${safeSeatIndex}/decision/${safeDecisionIndex}`;
  } catch {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
}

export function createClassicDecisionPacket(
  input: Readonly<ClassicDecisionPacketInput>,
): Readonly<ClassicDecisionPacket> {
  try {
    const state = input.state;
    const humanSeatIndex = requireSafeInteger(input.humanSeatIndex);
    const packetIndex = requireSafeInteger(input.packetIndex);
    const fromCoreVersion = requireSafeInteger(input.fromCoreVersion);
    const toCoreVersion = requireSafeInteger(state.version);
    if (fromCoreVersion > toCoreVersion
      || input.boundary.kind !== 'decision'
      || input.boundary.seatIndex !== humanSeatIndex) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }

    const observation = projectObservation(state as TournamentState, humanSeatIndex);
    if (!sameDataTree(input.boundary.observation, observation)) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const authorityEvents = state.eventLog;
    if (!Array.isArray(authorityEvents) || authorityEvents.length !== toCoreVersion) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const eventRange: DomainEvent[] = [];
    for (let index = fromCoreVersion; index < toCoreVersion; index += 1) {
      if (!Object.hasOwn(authorityEvents, index)) {
        throw new Error(INVALID_TURN_PACKET_MESSAGE);
      }
      eventRange.push(Reflect.get(authorityEvents, String(index)) as DomainEvent);
    }
    const viewerEvents = projectEventsForViewer(eventRange, humanSeatIndex);
    const packet: ClassicDecisionPacket = {
      schemaVersion: 1,
      kind: 'decision',
      packetIndex,
      decisionKey: createDecisionKey(
        observation.handNumber,
        humanSeatIndex,
        observation.decisionIndex,
      ),
      coreEventRange: {
        fromVersionInclusive: fromCoreVersion,
        toVersionExclusive: toCoreVersion,
      },
      viewerEventsSinceLastPacket: viewerEvents,
      privateEventsSinceLastPacket: [],
      observation,
      actionPanel: buildActionPanelUnchecked(observation),
      abilities: null,
    };
    return freezeRecursively(packet);
  } catch {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
}
