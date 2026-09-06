import { projectObservation } from '../agents/observation.js';
import type { PlayerObservationV1 } from '../agents/types.js';
import type { DomainEvent } from '../core/events.js';
import type { ActionIntent, LegalActionSet } from '../core/legal-actions.js';
import {
  projectEventsForViewer,
  type PublicGameEvent,
} from '../core/public-events.js';
import type { TournamentSeatInput, TournamentState } from '../core/state.js';
import {
  buildHandResultSummary,
  type HandResultSummary,
} from './hand-result.js';
import type { DriverBoundary } from './tournament-driver.js';
import type { PrivateAbilityKnowledge, AbilityPanel } from './peek-ability.js';

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

export type HandResultPacket = Readonly<PacketBase & {
  kind: 'hand-result';
  handNumber: number;
  handResult: Readonly<HandResultSummary>;
}>;

export type GameResultPacket = Readonly<PacketBase & {
  kind: 'game-result';
  winnerSeatIndex: number;
  finalStacks: readonly Readonly<{ seatIndex: number; stack: number }>[];
}>;

export type AbilityDecisionPacket = Readonly<Omit<ClassicDecisionPacket, 'abilities' | 'privateEventsSinceLastPacket'> & {
  abilities: Readonly<AbilityPanel>;
  privateEventsSinceLastPacket: readonly PrivateAbilityKnowledge[];
}>;

export type DecisionPacket = ClassicDecisionPacket | AbilityDecisionPacket;
export type ClassicTurnPacket = ClassicDecisionPacket | HandResultPacket | GameResultPacket;
export type TurnPacket = ClassicTurnPacket | AbilityDecisionPacket;

export interface ClassicDecisionPacketInput {
  readonly state: Readonly<TournamentState>;
  readonly boundary: Readonly<Extract<DriverBoundary, { kind: 'decision' }>>;
  readonly humanSeatIndex: number;
  readonly packetIndex: number;
  readonly fromCoreVersion: number;
}

export interface HandResultPacketInput {
  readonly state: Readonly<TournamentState>;
  readonly boundary: Readonly<Extract<DriverBoundary, { kind: 'hand-complete' }>>;
  readonly seats: readonly TournamentSeatInput[];
  readonly humanSeatIndex: number;
  readonly packetIndex: number;
  readonly fromCoreVersion: number;
  readonly currentHandViewerEvents: readonly PublicGameEvent[];
}

export interface GameResultPacketInput {
  readonly state: Readonly<TournamentState>;
  readonly boundary: Readonly<Extract<DriverBoundary, { kind: 'game-complete' }>>;
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

function requireSeatIndex(value: unknown): number {
  const seatIndex = requireSafeInteger(value);
  if (seatIndex > 5) throw new Error(INVALID_TURN_PACKET_MESSAGE);
  return seatIndex;
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

function requireNonemptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
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
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  const previous = seen.get(left);
  if (previous !== undefined) return previous === right;
  seen.set(left, right);
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length || !Number.isSafeInteger(left.length)) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!Object.hasOwn(left, index) || !Object.hasOwn(right, index)) return false;
      const leftDescriptor = Object.getOwnPropertyDescriptor(left, String(index));
      const rightDescriptor = Object.getOwnPropertyDescriptor(right, String(index));
      if (leftDescriptor === undefined || rightDescriptor === undefined
        || !('value' in leftDescriptor) || !('value' in rightDescriptor)
        || !sameDataTree(leftDescriptor.value, rightDescriptor.value, seen)) {
        return false;
      }
    }
    const leftKeys = Reflect.ownKeys(left);
    const rightKeys = Reflect.ownKeys(right);
    let leftEnumerableCount = 0;
    let rightEnumerableCount = 0;
    for (let index = 0; index < leftKeys.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(left, leftKeys[index]!);
      if (descriptor?.enumerable === true) leftEnumerableCount += 1;
    }
    for (let index = 0; index < rightKeys.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(right, rightKeys[index]!);
      if (descriptor?.enumerable === true) rightEnumerableCount += 1;
    }
    return leftEnumerableCount === left.length && rightEnumerableCount === right.length;
  }
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  const leftEnumerableKeys: PropertyKey[] = [];
  const rightEnumerableKeys: PropertyKey[] = [];
  for (let index = 0; index < leftKeys.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(left, leftKeys[index]!);
    if (descriptor?.enumerable === true) leftEnumerableKeys.push(leftKeys[index]!);
  }
  for (let index = 0; index < rightKeys.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(right, rightKeys[index]!);
    if (descriptor?.enumerable === true) rightEnumerableKeys.push(rightKeys[index]!);
  }
  if (leftEnumerableKeys.length !== rightEnumerableKeys.length) return false;
  for (let index = 0; index < rightEnumerableKeys.length; index += 1) {
    const key = rightEnumerableKeys[index]!;
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

interface PacketDeliverySnapshot {
  readonly packetIndex: number;
  readonly fromCoreVersion: number;
  readonly toCoreVersion: number;
  readonly viewerEvents: readonly PublicGameEvent[];
}

function snapshotPacketDelivery(
  state: Readonly<TournamentState>,
  humanSeatIndexValue: unknown,
  packetIndexValue: unknown,
  fromCoreVersionValue: unknown,
): PacketDeliverySnapshot {
  const humanSeatIndex = requireSeatIndex(humanSeatIndexValue);
  const packetIndex = requireSafeInteger(packetIndexValue);
  const fromCoreVersion = requireSafeInteger(fromCoreVersionValue);
  const toCoreVersion = requireSafeInteger(state.version);
  if (fromCoreVersion > toCoreVersion) throw new Error(INVALID_TURN_PACKET_MESSAGE);
  const authorityEvents = state.eventLog;
  if (!Array.isArray(authorityEvents) || authorityEvents.length !== toCoreVersion) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
  const eventRange: DomainEvent[] = [];
  for (let index = 0; index < toCoreVersion; index += 1) {
    if (!Object.hasOwn(authorityEvents, index)) throw new Error(INVALID_TURN_PACKET_MESSAGE);
    if (index >= fromCoreVersion) {
      eventRange.push(Reflect.get(authorityEvents, String(index)) as DomainEvent);
    }
  }
  return {
    packetIndex,
    fromCoreVersion,
    toCoreVersion,
    viewerEvents: projectEventsForViewer(eventRange, humanSeatIndex),
  };
}

function validateHandSeatDescriptors(
  descriptors: readonly TournamentSeatInput[],
  candidateSeats: TournamentState['seats'],
): void {
  if (!Array.isArray(descriptors)
    || !Array.isArray(candidateSeats)
    || descriptors.length < 2
    || descriptors.length > 6
    || descriptors.length !== candidateSeats.length) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
  const candidateBySeat = new Map<number, string>();
  const candidatePlayerIds = new Set<string>();
  for (let index = 0; index < candidateSeats.length; index += 1) {
    if (!Object.hasOwn(candidateSeats, index)) throw new Error(INVALID_TURN_PACKET_MESSAGE);
    const candidate = requireRecord(Reflect.get(candidateSeats, String(index)));
    const seatIndex = requireSeatIndex(Reflect.get(candidate, 'seatIndex'));
    const playerId = requireNonemptyString(Reflect.get(candidate, 'playerId'));
    if (seatIndex !== index
      || candidateBySeat.has(seatIndex)
      || candidatePlayerIds.has(playerId)) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    candidateBySeat.set(seatIndex, playerId);
    candidatePlayerIds.add(playerId);
  }
  const descriptorSeats = new Set<number>();
  const descriptorPlayerIds = new Set<string>();
  for (let index = 0; index < descriptors.length; index += 1) {
    if (!Object.hasOwn(descriptors, index)) throw new Error(INVALID_TURN_PACKET_MESSAGE);
    const descriptor = requireRecord(Reflect.get(descriptors, String(index)));
    const seatIndex = requireSeatIndex(Reflect.get(descriptor, 'seatIndex'));
    const playerId = requireNonemptyString(Reflect.get(descriptor, 'playerId'));
    if (seatIndex !== index
      || descriptorSeats.has(seatIndex)
      || descriptorPlayerIds.has(playerId)
      || candidateBySeat.get(seatIndex) !== playerId) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    descriptorSeats.add(seatIndex);
    descriptorPlayerIds.add(playerId);
  }
  for (let seatIndex = 0; seatIndex < descriptors.length; seatIndex += 1) {
    if (!candidateBySeat.has(seatIndex) || !descriptorSeats.has(seatIndex)) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
  }
}

export function projectCurrentHandViewerEvents(
  state: Readonly<TournamentState>,
  humanSeatIndex: number,
): readonly PublicGameEvent[] {
  const activeHand = state.activeHand;
  if (activeHand === null || typeof activeHand.handId !== 'string' || activeHand.handId.length === 0) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
  const authorityEvents = state.eventLog;
  if (!Array.isArray(authorityEvents) || authorityEvents.length !== state.version) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
  let startIndex = -1;
  let endIndex = -1;
  for (let index = 0; index < authorityEvents.length; index += 1) {
    if (!Object.hasOwn(authorityEvents, index)) throw new Error(INVALID_TURN_PACKET_MESSAGE);
    const event = requireRecord(Reflect.get(authorityEvents, String(index)));
    const type = Reflect.get(event, 'type');
    const handId = Reflect.get(event, 'handId');
    if (type === 'HandStarted' && handId === activeHand.handId) {
      if (startIndex !== -1 || endIndex !== -1) throw new Error(INVALID_TURN_PACKET_MESSAGE);
      startIndex = index;
    }
    if (startIndex !== -1 && endIndex === -1 && handId !== activeHand.handId) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    if (type === 'HandCompleted' && handId === activeHand.handId) {
      if (startIndex === -1 || endIndex !== -1) throw new Error(INVALID_TURN_PACKET_MESSAGE);
      endIndex = index;
    }
  }
  if (startIndex < 0 || endIndex < startIndex || endIndex !== authorityEvents.length - 1) {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
  const currentHandAuthorityEvents: DomainEvent[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    currentHandAuthorityEvents.push(
      Reflect.get(authorityEvents, String(index)) as DomainEvent,
    );
  }
  return projectEventsForViewer(currentHandAuthorityEvents, humanSeatIndex);
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
    const humanSeatIndex = requireSeatIndex(input.humanSeatIndex);
    const delivery = snapshotPacketDelivery(
      state,
      humanSeatIndex,
      input.packetIndex,
      input.fromCoreVersion,
    );
    if (input.boundary.kind !== 'decision'
      || input.boundary.seatIndex !== humanSeatIndex) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }

    const observation = projectObservation(state as TournamentState, humanSeatIndex);
    if (!sameDataTree(input.boundary.observation, observation)) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const packet: ClassicDecisionPacket = {
      schemaVersion: 1,
      kind: 'decision',
      packetIndex: delivery.packetIndex,
      decisionKey: createDecisionKey(
        observation.handNumber,
        humanSeatIndex,
        observation.decisionIndex,
      ),
      coreEventRange: {
        fromVersionInclusive: delivery.fromCoreVersion,
        toVersionExclusive: delivery.toCoreVersion,
      },
      viewerEventsSinceLastPacket: delivery.viewerEvents,
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

export function createClassicHandResultPacket(
  input: Readonly<HandResultPacketInput>,
): Readonly<HandResultPacket> {
  try {
    const state = input.state;
    const humanSeatIndex = requireSeatIndex(input.humanSeatIndex);
    const delivery = snapshotPacketDelivery(
      state,
      humanSeatIndex,
      input.packetIndex,
      input.fromCoreVersion,
    );
    if (input.boundary.kind !== 'hand-complete'
      || state.activeHand?.phase !== 'hand-complete'
      || input.boundary.handNumber !== state.handNumber) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    validateHandSeatDescriptors(input.seats, state.seats);
    const events = input.currentHandViewerEvents;
    if (!Array.isArray(events) || events.length < 2
      || !Object.hasOwn(events, 0) || !Object.hasOwn(events, events.length - 1)) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const first = Reflect.get(events, '0') as PublicGameEvent;
    const last = Reflect.get(events, String(events.length - 1)) as PublicGameEvent;
    if (first.type !== 'handStarted' || first.handNumber !== input.boundary.handNumber
      || last.type !== 'handCompleted') {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const authoritativeViewerEvents = projectCurrentHandViewerEvents(state, humanSeatIndex);
    if (!sameDataTree(events, authoritativeViewerEvents)) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const summary = buildHandResultSummary(input.seats, events, humanSeatIndex);
    if (summary.handNumber !== input.boundary.handNumber) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    return freezeRecursively({
      schemaVersion: 1,
      kind: 'hand-result',
      packetIndex: delivery.packetIndex,
      handNumber: input.boundary.handNumber,
      handResult: summary,
      coreEventRange: {
        fromVersionInclusive: delivery.fromCoreVersion,
        toVersionExclusive: delivery.toCoreVersion,
      },
      viewerEventsSinceLastPacket: delivery.viewerEvents,
      privateEventsSinceLastPacket: [],
    });
  } catch {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
}

export function createClassicGameResultPacket(
  input: Readonly<GameResultPacketInput>,
): Readonly<GameResultPacket> {
  try {
    const state = input.state;
    const humanSeatIndex = requireSeatIndex(input.humanSeatIndex);
    const delivery = snapshotPacketDelivery(
      state,
      humanSeatIndex,
      input.packetIndex,
      input.fromCoreVersion,
    );
    if (input.boundary.kind !== 'game-complete'
      || state.activeHand?.phase !== 'game-complete') {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const seats = state.seats;
    if (!Array.isArray(seats) || seats.length < 2 || seats.length > 6) {
      throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const finalStacks: Array<{ seatIndex: number; stack: number }> = [];
    const seenSeatIndexes = new Set<number>();
    let survivorSeatIndex: number | null = null;
    for (let index = 0; index < seats.length; index += 1) {
      if (!Object.hasOwn(seats, index)) throw new Error(INVALID_TURN_PACKET_MESSAGE);
      const seat = Reflect.get(seats, String(index)) as TournamentState['seats'][number];
      const seatIndex = requireSeatIndex(seat.seatIndex);
      const stack = requireSafeInteger(seat.stack);
      if (seenSeatIndexes.has(seatIndex)) throw new Error(INVALID_TURN_PACKET_MESSAGE);
      seenSeatIndexes.add(seatIndex);
      if (stack > 0 && seat.status !== 'eliminated') {
        if (survivorSeatIndex !== null) throw new Error(INVALID_TURN_PACKET_MESSAGE);
        survivorSeatIndex = seatIndex;
      }
      finalStacks.push({ seatIndex, stack });
    }
    for (let seatIndex = 0; seatIndex < seats.length; seatIndex += 1) {
      if (!seenSeatIndexes.has(seatIndex)) throw new Error(INVALID_TURN_PACKET_MESSAGE);
    }
    const winnerSeatIndex = requireSeatIndex(input.boundary.winnerSeatIndex);
    if (survivorSeatIndex !== winnerSeatIndex) throw new Error(INVALID_TURN_PACKET_MESSAGE);
    return freezeRecursively({
      schemaVersion: 1,
      kind: 'game-result',
      packetIndex: delivery.packetIndex,
      winnerSeatIndex,
      finalStacks,
      coreEventRange: {
        fromVersionInclusive: delivery.fromCoreVersion,
        toVersionExclusive: delivery.toCoreVersion,
      },
      viewerEventsSinceLastPacket: delivery.viewerEvents,
      privateEventsSinceLastPacket: [],
    });
  } catch {
    throw new Error(INVALID_TURN_PACKET_MESSAGE);
  }
}
