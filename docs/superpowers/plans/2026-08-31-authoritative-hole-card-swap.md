# 权威底牌更换与完整能力回放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变经典德州行为的前提下，实现从权威牌堆消费下一张牌的底牌更换能力，并让牌堆账本、隐私投影、Session replay、CLI、固定种子会话和人工验收形成完整闭环。

**Architecture:** 核心层新增唯一真实事件 `HoleCardReplaced`，只替换当前行动者的一张底牌、保存换出牌并推进 `dealCursor`；公共牌仍由既有自动发牌逻辑自然顺延。能力层用单个 `HoleCardSwapResolved` 同时表达核心事件、次数消耗和私有知识，复用里程碑 A 的 `prepareAuthorityTransition` / `commitPreparedTransition` 两阶段事务与里程碑 B 的 Session reducer/WeakMap 聚合；GameSession 必须先把候选核心状态、charge、lock、knowledge、Session event、packet 和 cursors 全部构造并冻结，再在一个同步、不可 `await`、不可回调的 commit 点提交。经典 replay 显式拒绝该事件，能力 replay 逐前缀重建全部权威与私有状态。

**Tech Stack:** Node.js 22+、TypeScript 7、ESM、Vitest 4、tsx；无新增 runtime dependency。

**Spec:** `docs/superpowers/specs/2026-08-31-turn-packets-and-ability-lab-design.md`

## Global Constraints

- 本计划只实现已批准规格的里程碑 C；执行前必须完成并验证里程碑 A 与 B。
- `RULES_VERSION = 'holdem-v1'`、`EVENT_SCHEMA_VERSION = 1`、`SESSION_SCHEMA_VERSION = 1`、`ABILITY_RULES_VERSION = 'ability-lab-v1'` 保持不变。
- 新牌严格等于换牌前 `activeHand.deck[activeHand.dealCursor]`；不调用随机源，不 splice 或重排权威牌堆。
- `HoleCardReplaced` 是核心 `DomainEvent`，但不得进入 `CoreEventApplied`；成功换牌只产生一个原子的 `HoleCardSwapResolved` Session event。
- 每个决策最多成功使用一种能力，swap 每场锦标赛最多成功一次；成功能力不替代扑克行动，也不因后续非法扑克行动退还。
- `abilityDiscardedCards` 是 `HandState` 的可选字段；classic 和没有换牌的手局必须连该属性都不存在，不能写为 `undefined` 或空数组。
- `HoleCardReplaced` 对 human viewer、NPC observation 与 spectator 永远静默；人类只能从私有 notice 和更新后的自身 observation 得知换牌结果。
- Agent `decisionIndex` 与 RNG 路径 `agent/<handNumber>/<seatIndex>/<decisionIndex>` 只受 `PlayerActed` 影响，不能因换牌增加。
- `ReplayEnvelopeV1.events` 继续声明为 `readonly DomainEvent[]`，但 classic replay 必须在归约前拒绝 `HoleCardReplaced`。
- Session replay 不读取系统时间或 `Math.random()`，也不重新运行能力随机、权益估算或扑克 Agent。
- authority replay capability 按单局绑定，不进入普通 handle、`SessionStep`、TurnPacket、根导出、CLI 或未来浏览器依赖边界。
- `prepareAuthorityTransition(..., 'ability-swap', ...)` 只能产生未提交的 `PreparedDriverTransition`；直到 GameSession 候选聚合和候选 packet 全部验证通过，核心状态、能力次数、decision lock、private knowledge、Session log、packet index 与 delivery cursors 都不得改变。
- 唯一提交点必须同步执行 `commitPreparedTransition(prepared)` 与一次 `WeakMap.set(handle, frozenAggregate)`；其中不得进行投影、验证、深拷贝、冻结、日志、用户 hook、Participant 调用或任何 `await`。有效 prepared token 在持有 session busy lock 时提交必须是不抛错操作。
- prepare 成功后若 Session reducer、投影、冻结或候选验证失败，必须在异常路径同步调用一次 `discardPreparedTransition(prepared)` 释放 driver lease，再原样抛错；discard 不得更改任何 committed state 或 cursor。
- 每个 RED 必须先运行并确认因预期缺失行为失败；每个 GREEN 必须运行聚焦测试、`npm run check`、`npm run build` 和 `git diff --check`。
- 一个 Step 内的每个表格行、测试 bullet 和伪造案例都视为独立的 2–5 分钟微步骤：一次只新增一个断言并取得对应 RED，再做最小 GREEN；不得把整组案例一次性写完后才运行。
- 不修改 `sources/`、`AGENTS.md`、浏览器 UI、NPC 能力、作弊检测、成长系统或角色平衡。
- 每个任务只提交其 Files 列表中的文件；不得顺带提交已有 `package-lock.json`、规格文档或其他代理的未提交改动。

---

## Dependency Gate

执行本计划前，工作树必须已经包含以下里程碑 A 接口：

```ts
// src/game/tournament-driver.ts
export type DriverTransitionSource =
  | 'automatic'
  | 'npc'
  | 'human-poker'
  | 'ability-swap';

export interface TournamentDriver {
  getBoundary(): Readonly<DriverBoundary>;
  getAuthorityState(): Readonly<TournamentState>;
  preparePausedAction(
    seatIndex: number,
    intent: Readonly<ActionIntent>,
    commandIndex: number,
  ): Promise<PreparedDriverTransition>;
  prepareContinueAfterHand(): Promise<PreparedDriverTransition>;
  prepareAuthorityTransition(
    transition: Readonly<TransitionResult>,
    source: 'ability-swap',
    commandIndex: number,
  ): Promise<PreparedDriverTransition>;
  commitPreparedTransition(
    prepared: PreparedDriverTransition,
  ): Readonly<DriverBoundary>;
  discardPreparedTransition(prepared: PreparedDriverTransition): void;
}
```

`PreparedDriverTransition` 是不可伪造、只可提交或丢弃一次、绑定 driver 与基准 revision 的 token；它只从 `src/game/tournament-driver.ts` 直接导入，不从根导出：

```ts
declare const preparedDriverTransitionBrand: unique symbol;
export interface PreparedDriverTransition {
  readonly [preparedDriverTransitionBrand]: true;
  readonly candidateBoundary: Readonly<DriverBoundary>;
  readonly candidateAuthorityState: Readonly<TournamentState>;
  readonly transitionBatches: readonly Readonly<DriverTransitionBatch>[];
  readonly rejection: Readonly<ActionRejection> | null;
}
```

三个 prepare 方法必须在单一 lease/busy guard 下完成逐事件 replay、每前缀 invariant、transition 深比较、后续自动/NPC 推进、batch 冻结与所有可抛错 hook，但不改变 committed driver state。`commitPreparedTransition()` 只接受当前 driver 发出的最新有效 token，同步替换 state、boundary、event count 和 revision，释放 lease 且不调用外部代码；`discardPreparedTransition()` 只令 token 失效并释放 lease。C 不得恢复“先提交 core、再构造 Session packet”的旧顺序，也不得绕过该 prepared-token 提交器。

工作树还必须已经包含以下里程碑 B 接口：

```ts
// src/game/session-events.ts
export type SessionEvent =
  | CoreEventApplied
  | OpponentCardPeeked
  | OpponentStrengthRead;

export function reduceSessionEvent(
  state: AbilityLabSessionState | null,
  event: Readonly<SessionEvent>,
  humanSeatIndex: number,
): AbilityLabSessionState;

export function projectPrivateAbilityNotice(
  event: Readonly<SessionEvent>,
): PrivateAbilityNotice | null;

// src/game/game-session.ts
export function openGameSession(options: Readonly<OpenGameSessionOptions>): Promise<SessionStep>;
export function getCurrentPacket(handle: GameSessionHandle): Readonly<TurnPacket>;
export function submitSessionCommand(
  handle: GameSessionHandle,
  command: Readonly<SessionCommand>,
): Promise<SessionCommandResult>;
export function continueAfterHandResult(
  handle: GameSessionHandle,
  packetIndex: number,
): Promise<SessionContinueResult>;

// src/game/session-replay.ts
export function replaySession(
  envelope: Readonly<SessionReplayEnvelopeV1>,
): Readonly<SessionReplayResult>;

// src/game/session-authority.ts — direct authority import only; not re-exported from src/index.ts
export function openAuthoritativeGameSession(
  options: Readonly<OpenGameSessionOptions & { mode: 'ability-lab' }>,
): Promise<Readonly<{ step: SessionStep; capability: SessionAuthorityCapability }>>;

// src/game/session-authority.ts — direct import only
export function exportSessionReplay(
  capability: SessionAuthorityCapability,
): Readonly<SessionReplayEnvelopeV1>;
```

运行依赖门禁：

```bash
test -f src/game/tournament-driver.ts
test -f src/game/session-events.ts
test -f src/game/game-session.ts
test -f src/game/session-replay.ts
test -f src/game/session-authority.ts
npm test -- tests/game/tournament-driver.test.ts tests/game/game-session.test.ts tests/game/session-events.test.ts tests/game/session-replay.test.ts
```

Expected: 五个文件存在，里程碑 A/B 聚焦测试全部 PASS。任一接口缺失或测试失败时停止执行 C，先完成前置里程碑。

---

## File Map

### Core authority and card ledger

- `src/core/events.ts`: 定义 `HoleCardReplacedEvent`、`ClassicDomainEvent` 并扩展 `DomainEvent`。
- `src/core/state.ts`: 给 `HandState` 增加可选弃牌区，并权威归约换牌事件。
- `src/core/hole-card-replacement.ts` (new): 从当前权威状态构造单事件 replacement transition。
- `src/core/invariants.ts`: 按事件顺序重建当前底牌、能力弃牌、烧牌、公共牌和牌堆消费前缀。
- `src/core/public-events.ts`: 显式 suppress `HoleCardReplaced`。
- `src/agents/observation.ts`: 识别并忽略换牌事件，不增加 action history 或 decision index。
- `src/core/replay.ts`: classic runtime 拒绝换牌事件，并提供主动收窄 helper。
- `src/index.ts`: 导出安全的核心 replacement/helper；不导出 session authority capability。
- `tests/core/hole-card-replacement.test.ts` (new): 固定牌堆、四街、伪造事件和耗尽测试。
- `tests/core/invariants.test.ts`: 牌账本逐前缀与对抗篡改。
- `tests/core/public-events.test.ts`: 全 viewer suppression 与 getter 隔离。
- `tests/agents/observation.test.ts`: NPC ignorance 与 decision index 不变。
- `tests/core/replay.test.ts`: classic rejection 与 envelope helper。

### Atomic ability session and private replay

- `src/game/session-events.ts`: 增加 `HoleCardSwapResolved` 与原子 session reducer 分支。
- `src/game/tournament-driver.ts`: 收紧 A 预留的 `prepareAuthorityTransition(..., 'ability-swap', ...)`，只接受单个合法 `HoleCardReplaced` transition。
- `src/game/game-session.ts`: 预检 swap，暂存核心/charge/lock/knowledge/session event/packet/cursors 全部候选，并在唯一同步 commit 点提交 driver token 与 WeakMap 聚合。
- `src/game/session-replay.ts`: 逐前缀验证并归约 `HoleCardSwapResolved`。
- `src/game/session-authority.ts`: authority-only open 与导出含 swap 私密事件的单局 envelope，不扩大普通 API；safe `game-session.ts` 不反向依赖本模块。
- `src/game/turn-packet.ts`: 投影 swap notice、更新自身 observation、保持 viewer-safe 核心增量为空。
- `src/game/hand-result.ts`: 用当前手私密 swap 事件安全修正人类结算行的最终底牌，不补齐 NPC 隐藏牌。
- `tests/game/swap-ability.test.ts` (new): 成功、拒绝、四街、packet 和未来牌顺延。
- `tests/game/session-atomicity.test.ts` (new): hook/reducer/packet 失败无半提交。
- `tests/game/session-replay.test.ts`: swap 前缀重建和篡改拒绝。
- `tests/game/session-export-surface.test.ts`: 扩展 B 已有的 capability 和 export-surface 门禁。
- `tests/game/hand-result.test.ts`: swap 后弃牌仍显示人类最终底牌，NPC 未亮牌仍为空。

### CLI and final acceptance

- `src/cli/turn-command.ts`: 复验 Plan A 已有的 `u swap <1|2>` → 领域索引解析，不重写合同。
- `src/cli/turn-renderer.ts`: 显示私有换牌结果和同一决策的新手牌。
- `src/cli/index.ts`: 将 swap 命令提交给当前 session，不创建 authority 旁路。
- `tests/cli/turn-command.test.ts`: 复验合法/非法索引；classic 明确拒绝由 session/CLI 组合测试覆盖。
- `tests/cli/turn-renderer.test.ts`: 私有文案、能力锁和普通行动面板。
- `tests/cli/main.test.ts`: 能力成功后仍读取一次扑克行动。
- `tests/integration/ability-session-matrix.test.ts` (new): 2–6 人 × 3 能力的 15 个固定种子完整会话。
- `docs/playtests/ability-lab-6-player.md` (new): 六人能力模式人工验收证据。
- `README.md`: 三种能力命令、模式选择和隐私回放边界。

---

### Task 1: Add the authoritative replacement event and complete card ledger

**Files:**

- Create: `src/core/hole-card-replacement.ts`
- Create: `tests/core/hole-card-replacement.test.ts`
- Modify: `src/core/events.ts:12-19,55-70,165-185`
- Modify: `src/core/state.ts:74-95,407-457,458-518,602-684,744-890`
- Modify: `src/core/invariants.ts:33-108,203-258`
- Modify: `src/core/public-events.ts:215-417`
- Modify: `src/agents/observation.ts:99-185,366-401`
- Modify: `src/core/replay.ts:13-24,62-122`
- Modify: `src/game/session-events.ts`
- Modify: `src/index.ts:1-25`
- Modify: `tests/core/invariants.test.ts:36-43,165-272`
- Modify: `tests/core/public-events.test.ts:64-220,248-290`
- Modify: `tests/agents/observation.test.ts:192-276,630-699`
- Modify: `tests/core/replay.test.ts:55-134,157-205`
- Modify: `tests/game/session-events.test.ts`

**Interfaces:**

- Consumes: `TournamentState`、`TransitionResult`、`reduceDomainEvent`、`Card`、`EVENT_SCHEMA_VERSION`、现有 `deck/dealCursor`。
- Produces: `HoleCardReplacedEvent`、`ClassicDomainEvent`、`replaceHoleCard()`、换牌后的 `abilityDiscardedCards`、完整事件序列牌账本、classic replay guard。
- Preserves: `DeckPrepared.fullOrderedDeck` 身份、下注状态、行动顺序、筹码、Agent decision index 和 classic 序列化形状。

- [ ] **Step 1: Write the fixed-deck replacement RED**

Create `tests/core/hole-card-replacement.test.ts` with a two-seat fixture using `createStandardDeck()`. The initial physical deal is seat 1 then seat 0, twice, so seat 0 owns `deck[1]` and `deck[3]` and the cursor is 4.

```ts
const before = startHand(
  createTournament(CONFIG, SEATS, 'swap-core-v1').state,
  { fixedDeck: createStandardDeck() },
).state;
const deck = before.activeHand!.deck;

expect(before.activeHand!.currentActorSeat).toBe(0);
expect(before.activeHand!.dealCursor).toBe(4);
expect(before.seats[0]!.holeCards).toEqual([deck[1], deck[3]]);
expect(Object.hasOwn(before.activeHand!, 'abilityDiscardedCards')).toBe(false);

const snapshot = structuredClone(before);
const result = replaceHoleCard(before, 0, 0);

expect(before).toEqual(snapshot);
expect(result.events).toEqual([{
  type: 'HoleCardReplaced',
  schemaVersion: 1,
  eventIndex: before.version,
  handId: before.activeHand!.handId,
  seat: 0,
  holeCardIndex: 0,
  discardedCard: deck[1],
  replacementCard: deck[4],
}]);
expect(result.state.seats[0]!.holeCards).toEqual([deck[4], deck[3]]);
expect(result.state.activeHand!.abilityDiscardedCards).toEqual([deck[1]]);
expect(result.state.activeHand!.dealCursor).toBe(5);
expect(result.state.activeHand).toMatchObject({
  phase: 'preflop',
  street: 'preflop',
  currentActorSeat: 0,
  currentBetTo: 2,
  pendingActors: [0, 1],
});
expect(result.state.seats.map(({ stack, committedHand }) => ({ stack, committedHand })))
  .toEqual(before.seats.map(({ stack, committedHand }) => ({ stack, committedHand })));
```

- [ ] **Step 2: Write reducer-forgery and exhaustion RED cases**

From the valid event above, call `reduceDomainEvent()` with one mutation at a time and assert each throws without changing the source state:

```ts
const forgeries: readonly HoleCardReplacedEvent[] = [
  { ...valid, seat: 1 },
  { ...valid, holeCardIndex: 2 as 0 },
  { ...valid, discardedCard: deck[0]! },
  { ...valid, replacementCard: deck[5]! },
  { ...valid, handId: 'other/hand/1' },
];
for (const forged of forgeries) {
  expect(() => reduceDomainEvent(before, forged)).toThrow();
  expect(before).toEqual(snapshot);
}
```

Also construct wrong-phase, null-hole-cards, folded, all-in, eliminated, zero-stack and already-revealed states. For deck exhaustion, start a six-seat hand, call the lower-level `replaceHoleCard` 40 times while alternating indexes `0` and `1`, and assert:

```ts
expect(state.activeHand!.dealCursor).toBe(52);
expect(state.activeHand!.abilityDiscardedCards).toHaveLength(40);
expect(() => replaceHoleCard(state, actor, 0)).toThrow(/deck|exhaust/i);
```

- [ ] **Step 3: Write card-ledger RED cases**

Extend `tests/core/invariants.test.ts` with a helper that reduces every event prefix and calls `assertTournamentInvariants`. After two core replacements in the same decision, assert every prefix passes. Then build exact invalid copies:

```ts
const missingDiscard = {
  ...state,
  activeHand: { ...state.activeHand!, abilityDiscardedCards: [] },
};
const duplicatedDiscard = {
  ...state,
  activeHand: {
    ...state.activeHand!,
    abilityDiscardedCards: [
      state.activeHand!.abilityDiscardedCards![0]!,
      state.activeHand!.abilityDiscardedCards![0]!,
    ],
  },
};
const oldHoleRestored = {
  ...state,
  seats: state.seats.map((seat) => seat.seatIndex === actor
    ? { ...seat, holeCards: before.seats[actor]!.holeCards }
    : seat),
};
const cursorDrift = {
  ...state,
  activeHand: { ...state.activeHand!, dealCursor: state.activeHand!.dealCursor - 1 },
};

for (const invalid of [missingDiscard, duplicatedDiscard, oldHoleRestored, cursorDrift]) {
  expect(() => assertTournamentInvariants(invalid)).toThrow(/card|cursor|discard|deck/i);
}
```

Create a no-swap classic hand with an injected empty property and assert it fails, while the untouched classic hand has no own property and passes.

- [ ] **Step 4: Write projection, observation and classic replay RED cases**

Add a `HoleCardReplaced` fixture to the exhaustive `EVENTS_BY_TYPE` object in `tests/core/public-events.test.ts`. Assert all viewers get an empty array and the projector never reads private card getters:

```ts
expect(projectEventsForViewer([replacement], 0)).toEqual([]);
expect(projectEventsForViewer([replacement], 1)).toEqual([]);
expect(projectEventsForViewer([replacement], null)).toEqual([]);

const guarded = new Proxy(replacement, {
  get(target, property, receiver) {
    if (property === 'discardedCard' || property === 'replacementCard') {
      throw new Error('PRIVATE-SWAP-CARD-SENTINEL');
    }
    return Reflect.get(target, property, receiver);
  },
});
expect(projectEventsForViewer([guarded], null)).toEqual([]);
```

In `tests/agents/observation.test.ts`, replace seat 0's card, apply its normal poker action, then project seat 1's decision. Assert the swap event is absent from `actionHistory`, and `decisionIndex` only increased for `PlayerActed`:

```ts
expect(npcObservation.decisionIndex).toBe(1);
expect(npcObservation.actionHistory.filter((event) => event.type === 'playerActed'))
  .toHaveLength(1);
expect(JSON.stringify(npcObservation)).not.toMatch(/HoleCardReplaced|abilityDiscardedCards|2d|3c/);
```

In `tests/core/replay.test.ts`, place the valid replacement in an otherwise header-consistent `ReplayEnvelopeV1` and assert `replayTournament()` rejects before reduction. Add helper tests:

```ts
expect(() => replayTournament(abilityCoreEnvelope)).toThrow(ReplayHeaderError);
expect(() => assertClassicEventLog(classicState.eventLog)).not.toThrow();
expect(() => assertClassicEventLog(swappedState.eventLog)).toThrow(ReplayHeaderError);
expect(createClassicReplayEnvelope(classicState).events).toBe(classicState.eventLog);
expect(() => createClassicReplayEnvelope(swappedState)).toThrow(ReplayHeaderError);
```

In `tests/game/session-events.test.ts`, bypass TypeScript and place that same `HoleCardReplaced` inside a `CoreEventApplied`. Assert `reduceSessionEvent()` rejects before calling the core reducer, leaves the input Session state mutable and byte-for-byte unchanged, and does not append a Session event. This closes the security window in the same commit that widens `DomainEvent`.

- [ ] **Step 5: Run all core RED tests**

```bash
npm test -- tests/core/hole-card-replacement.test.ts tests/core/invariants.test.ts tests/core/public-events.test.ts tests/agents/observation.test.ts tests/core/replay.test.ts tests/game/session-events.test.ts
```

Expected: FAIL because `HoleCardReplacedEvent`, `replaceHoleCard`, the new ledger, classic guard and narrowed Session wrapper do not exist.

- [ ] **Step 6: Define the event, state field and transition factory**

Add to `src/core/events.ts`:

```ts
export interface HoleCardReplacedEvent extends HandEventBase {
  readonly type: 'HoleCardReplaced';
  readonly seat: number;
  readonly holeCardIndex: 0 | 1;
  readonly discardedCard: Card;
  readonly replacementCard: Card;
}

export type DomainEvent =
  | GameStartedEvent
  | HandStartedEvent
  | PositionsAssignedEvent
  | BlindPostedEvent
  | DeckPreparedEvent
  | HoleCardsDealtEvent
  | BettingRoundStartedEvent
  | PlayerActedEvent
  | BettingRoundClosedEvent
  | CardBurnedEvent
  | CommunityCardsDealtEvent
  | HoleCardsRevealedEvent
  | UncalledBetReturnedEvent
  | ShowdownStartedEvent
  | PotConstructedEvent
  | HandEvaluatedEvent
  | PotAwardedEvent
  | PlayerEliminatedEvent
  | HandCompletedEvent
  | HoleCardReplacedEvent
  | GameCompletedEvent;

export type ClassicDomainEvent = Exclude<DomainEvent, HoleCardReplacedEvent>;
```

Add to `HandState` in `src/core/state.ts`:

```ts
readonly abilityDiscardedCards?: readonly Card[];
```

Do not add the property to the `HandStarted` literal. Create `src/core/hole-card-replacement.ts`:

```ts
export function replaceHoleCard(
  state: TournamentState,
  seatIndex: number,
  holeCardIndex: 0 | 1,
): TransitionResult {
  const hand = state.activeHand;
  const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
  const discardedCard = seat?.holeCards?.[holeCardIndex];
  const replacementCard = hand?.deck[hand.dealCursor];
  if (hand === null || discardedCard === undefined || replacementCard === undefined) {
    throw new Error('hole-card replacement requires an available authoritative card');
  }
  const event: HoleCardReplacedEvent = {
    type: 'HoleCardReplaced',
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventIndex: state.version,
    handId: hand.handId,
    seat: seatIndex,
    holeCardIndex,
    discardedCard: { ...discardedCard },
    replacementCard: { ...replacementCard },
  };
  return { state: reduceDomainEvent(state, event), events: [event] };
}
```

- [ ] **Step 7: Implement the authoritative reducer branch**

Add an explicit `HoleCardReplaced` case in `reduceDomainEvent` before street closure. Validate all authority from the state and use state-owned cards for destinations:

```ts
case 'HoleCardReplaced': {
  const hand = state.activeHand;
  const bettingStreet = hand?.phase === 'preflop'
    || hand?.phase === 'flop'
    || hand?.phase === 'turn'
    || hand?.phase === 'river';
  const seat = state.seats.find((candidate) => candidate.seatIndex === event.seat);
  const index = event.holeCardIndex;
  const replacement = hand?.deck[hand.dealCursor];
  const discarded = seat?.holeCards?.[index];
  if (hand === null
    || hand.handId !== event.handId
    || !bettingStreet
    || hand.street !== hand.phase
    || hand.currentActorSeat !== event.seat
    || seat === undefined
    || seat.status !== 'active'
    || seat.stack <= 0
    || seat.holeCards === null
    || hand.revealedHoleCardSeats.includes(event.seat)
    || (index !== 0 && index !== 1)
    || discarded === undefined
    || replacement === undefined
    || !sameCard(discarded, event.discardedCard)
    || !sameCard(replacement, event.replacementCard)) {
    throw new Error('HoleCardReplaced violates authoritative replacement state');
  }
  const replacementCards: [Card, Card] = [
    { ...seat.holeCards[0] },
    { ...seat.holeCards[1] },
  ];
  replacementCards[index] = { ...replacement };
  next = {
    ...state,
    seats: replaceSeat(state.seats, event.seat, (candidate) => ({
      ...candidate,
      holeCards: replacementCards,
    })),
    activeHand: {
      ...hand,
      abilityDiscardedCards: [
        ...(hand.abilityDiscardedCards ?? []),
        { ...discarded },
      ],
      dealCursor: hand.dealCursor + 1,
    },
  };
  break;
}
```

- [ ] **Step 8: Replace the card invariant with event-order reconstruction**

In `assertCardAuthority`, retain full-deck canonical validation, then reconstruct these four destinations. The replacement branch must verify the old slot before changing it:

```ts
const consumed: Card[] = [];
const currentHoles = new Map<number, [Card, Card]>();
const discards: Card[] = [];
const burns: Card[] = [];
const board: Card[] = [];

for (const event of handEvents) {
  if (event.type === 'HoleCardsDealt') {
    const cardsFromThisDeal = new Map<number, Card[]>();
    for (const deal of event.orderedDeals) {
      consumed.push(deal.card);
      const cards = cardsFromThisDeal.get(deal.seat) ?? [];
      cards.push(deal.card);
      cardsFromThisDeal.set(deal.seat, cards);
    }
    for (const [seatIndex, cards] of cardsFromThisDeal) {
      if (cards.length !== 2 || currentHoles.has(seatIndex)) {
        fail('each dealt seat requires exactly one ordered two-card tuple');
      }
      currentHoles.set(seatIndex, [cards[0]!, cards[1]!]);
    }
  } else if (event.type === 'HoleCardReplaced') {
    const cards = currentHoles.get(event.seat);
    if (cards === undefined
      || !sameCard(cards[event.holeCardIndex], event.discardedCard)) {
      fail('replacement discard must match the current authoritative hole-card slot');
    }
    discards.push(event.discardedCard);
    cards[event.holeCardIndex] = event.replacementCard;
    consumed.push(event.replacementCard);
  } else if (event.type === 'CardBurned') {
    burns.push(event.card);
    consumed.push(event.card);
  } else if (event.type === 'CommunityCardsDealt') {
    board.push(...event.cards);
    consumed.push(...event.cards);
  }
}
```

Then require:

```ts
if (hand.dealCursor !== consumed.length
  || !sameCards(hand.deck.slice(0, consumed.length), consumed)
  || new Set(consumed.map((card) => card.code)).size !== consumed.length) {
  fail('deal cursor and consumed destinations must map one-to-one onto the deck prefix');
}

if (discards.length === 0) {
  if (Object.hasOwn(hand, 'abilityDiscardedCards')) {
    fail('classic hands must omit the ability discard destination');
  }
} else if (hand.abilityDiscardedCards === undefined
  || !sameCards(hand.abilityDiscardedCards, discards)) {
  fail('ability discard destination must match replacement event order');
}

const destinationCards = [
  ...[...currentHoles.values()].flatMap((cards) => cards),
  ...discards,
  ...burns,
  ...board,
];
const consumedCodes = new Set(hand.deck
  .slice(0, hand.dealCursor)
  .map((card) => card.code));
if (destinationCards.length !== hand.dealCursor
  || new Set(destinationCards.map((card) => card.code)).size !== destinationCards.length
  || destinationCards.some((card) => !consumedCodes.has(card.code))) {
  fail('current holes, ability discards, burns, and board must partition the deck prefix');
}
```

Compare every seat's actual hole cards to `currentHoles`, and retain the existing burn/board equality checks. After a swapped hand completes and `HandStarted` reduces the next hand, assert the new `HandState` again omits the `abilityDiscardedCards` own property. These checks prove both event order and the multiset equation without counting a discarded old card twice as newly consumed.

- [ ] **Step 9: Implement explicit privacy suppression and classic replay rejection**

Add explicit cases:

```ts
// src/core/public-events.ts
case 'HoleCardReplaced':
  return null;

// src/agents/observation.ts snapshotEventLog
case 'HoleCardReplaced':
  snapshots.push({ type, handId });
  break;
```

In `src/game/session-events.ts`, narrow the existing wrapper in this same task:

```ts
export interface CoreEventApplied {
  readonly type: 'CoreEventApplied';
  readonly schemaVersion: 1;
  readonly sessionEventIndex: number;
  readonly source: 'automatic' | 'npc' | 'human-poker';
  readonly commandIndex: number | null;
  readonly event: ClassicDomainEvent;
}
```

Its runtime validator must explicitly reject `event.type === 'HoleCardReplaced'` before `reduceDomainEvent()` is called. Do not defer either the type narrowing or the runtime rejection to Task 2: after this task's commit there must be no representable or cast-based path that wraps replacement as an ordinary core Session event.

The observation action loop remains unchanged, so only `PlayerActed` increments `decisionIndex`.

In `src/core/replay.ts`:

```ts
export function assertClassicEventLog(
  events: readonly DomainEvent[],
): asserts events is readonly ClassicDomainEvent[] {
  if (events.some((event) => event.type === 'HoleCardReplaced')) {
    throw new ReplayHeaderError('classic replay cannot contain ability core events');
  }
}

export function createClassicReplayEnvelope(
  state: TournamentState,
): ReplayEnvelopeV1 {
  assertClassicEventLog(state.eventLog);
  return {
    containsPrivateData: true,
    schemaVersion: EVENT_SCHEMA_VERSION,
    rulesVersion: state.rulesVersion,
    rngVersion: state.rngVersion,
    shuffleVersion: state.shuffleVersion,
    strategyVersion: state.strategyVersion,
    initialConfig: state.config,
    seats: state.seats.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })),
    runSeed: state.runSeed,
    events: state.eventLog,
  };
}
```

Call `assertClassicEventLog(envelope.events)` inside `validateEventStream()` before any core reduction. Export the safe core factory and helper from `src/index.ts`; do not export `session-authority.ts`.

- [ ] **Step 10: Run focused GREEN, classic regression and static checks**

```bash
npm test -- tests/core/hole-card-replacement.test.ts tests/core/invariants.test.ts tests/core/public-events.test.ts tests/agents/observation.test.ts tests/core/replay.test.ts tests/game/session-events.test.ts
npm test -- tests/core/start-hand.test.ts tests/core/street-progression.test.ts tests/core/showdown.test.ts tests/core/automatic-runout.test.ts tests/integration/random-hands.test.ts
npm run check
npm run build
git diff --check
```

Expected: all pass. The existing 100-hand classic gate still runs exactly 100 fixed hands, and no classic state has an own `abilityDiscardedCards` property.

- [ ] **Step 11: Commit the complete core authority layer**

```bash
git add src/core/events.ts src/core/state.ts src/core/hole-card-replacement.ts src/core/invariants.ts src/core/public-events.ts src/core/replay.ts src/agents/observation.ts src/game/session-events.ts src/index.ts tests/core/hole-card-replacement.test.ts tests/core/invariants.test.ts tests/core/public-events.test.ts tests/core/replay.test.ts tests/agents/observation.test.ts tests/game/session-events.test.ts
git commit -m "feat: add authoritative hole-card replacement"
```

---

### Task 2: Make swap one atomic Session event and replayable transaction

**Files:**

- Modify: `src/game/session-events.ts`
- Modify: `src/game/tournament-driver.ts`
- Modify: `src/game/game-session.ts`
- Modify: `src/game/session-replay.ts`
- Modify: `src/game/session-authority.ts`
- Modify: `src/game/turn-packet.ts`
- Modify: `src/game/hand-result.ts`
- Create: `tests/game/swap-ability.test.ts`
- Create: `tests/game/session-atomicity.test.ts`
- Modify: `tests/game/session-replay.test.ts`
- Modify: `tests/game/session-export-surface.test.ts`
- Modify: `tests/game/hand-result.test.ts`

**Interfaces:**

- Consumes: Task 1 `replaceHoleCard()` / `HoleCardReplacedEvent`; A `prepareAuthorityTransition()` / `commitPreparedTransition()` / `discardPreparedTransition()` /不可伪造 prepared token；B `reduceSessionEvent()` / opaque handle / replay skeleton / ability charges。
- Produces: `HoleCardSwapResolved`、swap-hardened `prepareAuthorityTransition()`、single-point live transaction、swap private notice、swap-aware Session replay 和 capability export。
- Does not produce: public core event、额外随机路径、`CoreEventApplied(HoleCardReplaced)`、普通 handle 的 authority escape。

- [ ] **Step 1: Write the exact first-decision atomic swap RED**

Create `tests/game/swap-ability.test.ts` with a two-seat authoritative session, fixed runSeed `swap-session-v1` and paused human seat 0. Do not add a fixed-deck option to the public session API. Before the command, bind `beforeEnvelope = exportSessionReplay(capability)`, locate its unique embedded `DeckPrepared`, and bind `deck = fullOrderedDeck`; bind `discarded = first.packet.observation.holeCards[0]`, `untouched = first.packet.observation.holeCards[1]`, and `replacement = deck[4]`. At the first decision assert the initial core version is 8, then submit:

```ts
const command: SessionCommand = {
  type: 'useAbility',
  ability: 'swap',
  decisionKey: first.packet.decisionKey,
  expectedPacketIndex: first.packet.packetIndex,
  holeCardIndex: 0,
};
const result = await submitSessionCommand(first.handle, command);
expect(result.accepted).toBe(true);
if (!result.accepted || result.step.packet.kind !== 'decision') {
  throw new Error('swap fixture did not return a decision packet');
}

expect(result.step.packet.packetIndex).toBe(first.packet.packetIndex + 1);
expect(result.step.packet.decisionKey).toBe(first.packet.decisionKey);
expect(result.step.packet.coreEventRange).toEqual({
  fromVersionInclusive: 8,
  toVersionExclusive: 9,
});
expect(result.step.packet.viewerEventsSinceLastPacket).toEqual([]);
expect(result.step.packet.privateEventsSinceLastPacket).toEqual([{
  type: 'swap',
  street: 'preflop',
  holeCardIndex: 0,
  discardedCard: discarded,
  replacementCard: replacement,
}]);
expect(result.step.packet.observation.holeCards).toEqual([
  replacement,
  untouched,
]);
expect(result.step.packet.abilities).toMatchObject({
  remaining: { peek: 1, read: 1, swap: 0 },
  usedThisDecision: true,
  availableCommands: [],
});
```

Before using any ability, assert `abilities.availableCommands` now contains the existing peek/read entries plus exactly `{ ability:'swap', command:'u swap <1|2>', label:'更换一张自己的底牌' }`. After any successful ability the same-decision list remains empty; after a later poker decision, swap reappears only if its charge is still 1. This is the C production change that turns B's reserved, non-executable swap into a visible option.

Use `exportSessionReplay(capability)` to inspect authority-only details:

```ts
const afterEnvelope = exportSessionReplay(capability);
const tail = afterEnvelope.events.slice(8);
expect(tail).toHaveLength(1);
expect(tail[0]).toMatchObject({
  type: 'HoleCardSwapResolved',
  schemaVersion: 1,
  sessionEventIndex: 8,
  commandIndex: 0,
  handNumber: 1,
  street: 'preflop',
  decisionKey: 'hand/1/seat/0/decision/0',
  actorSeatIndex: 0,
  authorityEvent: {
    type: 'HoleCardReplaced',
    eventIndex: 8,
    seat: 0,
    holeCardIndex: 0,
    discardedCard: discarded,
    replacementCard: replacement,
  },
});
expect(tail.some((event) => event.type === 'CoreEventApplied')).toBe(false);
```

- [ ] **Step 2: Write rejection purity and one-ability-per-decision RED cases**

Use the same initial packet for invalid commands: indices `-1`, `2`, `0.5`, string and unsafe integer cast at runtime; stale packet; stale decision; wrong mode; non-human turn; exhausted swap; and second ability in the same decision. For every rejection capture the current packet and authority envelope before submission and assert both are unchanged afterward.

After a successful swap, submit an illegal `check` while facing the blind. Assert the swap remains consumed and the returned packet is the same post-swap packet. Then submit `call` and assert the next `CoreEventApplied` uses `commandIndex: 1` while the core `decisionIndex` increases only once.

Add a swap-then-fold hand in `tests/game/hand-result.test.ts`. At `hand-result`, assert the human row contains `[replacement, untouched]`, not the original dealt pair, even though no `HoleCardsRevealed` exists for the folded human. An unrevealed NPC row remains `holeCards/category/bestFive:null`. Corrupting the private swap's discarded slot/card or applying another seat's swap must fail closed instead of rewriting a row.

Add a swap-then-showdown hand. The complete viewer stream contains both the original `ownHoleCardsDealt` pair and the final `holeCardsRevealed` pair. Assert the derived swap chain starts from the original own-deal tuple, reaches the replacement tuple, and exactly matches the reveal; the hand-result row is emitted once with the replacement tuple. A forged reveal that matches neither the derived final tuple nor the authoritative evaluation must fail closed. This prevents double-applying the swap when the generic summary already saw the showdown reveal.

- [ ] **Step 3: Write four-street and future-board RED vectors**

Use four separate fixed-seed authoritative sessions. For each, read its actual ordered deck from the private envelope's `DeckPrepared`; never expose that deck through the safe session API. Reach the human decision on each street by checking/calling without changing the deck. Assert:

| Swap street | Cursor before | Replacement | Already dealt board stays | Next public consumption |
|---|---:|---|---|---|
| preflop | 4 | `deck[4]` | `[]` | burn `deck[5]`, flop `deck[6..8]` |
| flop | 8 | `deck[8]` | `deck[5..7]` | turn burn `deck[9]`, turn `deck[10]` |
| turn | 10 | `deck[10]` | flop + `deck[9]` | river burn `deck[11]`, river `deck[12]` |
| river | 12 | `deck[12]` | all five board cards | no future board card |

For the preflop vector, complete showdown and assert:

```ts
expect(finalHand.board).toEqual([
  deck[6], deck[7], deck[8], deck[10], deck[12],
]);
expect(finalHand.burnedCards).toEqual([deck[5], deck[9], deck[11]]);
expect(finalHand.dealCursor).toBe(13);
expect(revealedHeroCards).toEqual([deck[4], deck[3]]);
expect(JSON.stringify(spectatorEventsAfterSwap)).not.toContain(deck[1]!.code);
```

The final privacy assertion is deliberately limited to spectator projection or the post-swap viewer-safe increment. The full human-viewer log legitimately contains the original `ownHoleCardsDealt` event and therefore is not an appropriate “old card never appeared” oracle.

- [ ] **Step 4: Write failure-atomicity RED cases**

Create `tests/game/session-atomicity.test.ts`. Reuse the hoisted Vitest `createTournamentDriver` wrapper pattern from Plan A/B to compose a throwing `onAcceptedTransition` hook into the real driver's options; do not add an authority hook to `OpenGameSessionOptions` or any safe public session type. Make that hook throw while `prepareAuthorityTransition()` is preparing the first `source:'ability-swap'` batch. Capture `getCurrentPacket(handle)`, `driver.getAuthorityState()` and `exportSessionReplay(capability)` before the command. Assert the Promise rejects and all three snapshots remain exactly equal. Retry with the hook succeeding and assert the replacement is still `deck[4]`, proving the failed preparation consumed neither core state nor randomness.

Add a separate reducer-failure injection by spying on the exported pure `reduceSessionEvent()` before opening/importing the session host, letting driver preparation succeed, then throwing `swap-session-reducer-sentinel` for `HoleCardSwapResolved`. Assert the prepared lease is discarded, core/session/capability/packet snapshots remain identical, and after restoring the reducer the same command succeeds with the same commandIndex, packetIndex and replacement card. The test-only module wrapper must delegate every non-target event to the real reducer and be restored after the case.

Import `* as turnPacketModule` and use `vi.spyOn(turnPacketModule, 'createAbilityDecisionPacket').mockImplementationOnce(() => { throw new Error('swap-packet-projector-sentinel'); })` so packet construction throws after driver preparation but before the commit point. Assert the error is preserved and core state, current packet, swap charge, decision lock, private knowledge, Session event log, accepted command index, packet index and both delivery cursors all retain their exact pre-command values. Restore the spy, retry, and assert the same replacement and indexes as the clean first attempt; this also proves the failure path discarded the prepared lease.

Forge a swap transition with two authority events and assert the non-root driver wrapper rejects it without returning a prepared token:

```ts
await expect(driver.prepareAuthorityTransition(
  { state: forgedState, events: [event, event] },
  'ability-swap',
  0,
)).rejects.toThrow(/single|HoleCardReplaced|ability-swap/i);
expect(driver.getAuthorityState()).toEqual(before);
```

Finally, prepare one valid swap directly in the driver test harness and prove token semantics: forged token, token from another driver, stale-base token and a second commit of the same token all reject before mutation. For a current valid token, `commitPreparedTransition(prepared)` must complete synchronously, call no hook, and return `prepared.candidateBoundary`.

- [ ] **Step 5: Write Session replay and authority-boundary RED cases**

In `tests/game/session-replay.test.ts`, replay every prefix through swap, poker action, future board, showdown, `HandCompleted` and game completion. Assert reconstructed fields at the swap prefix:

```ts
expect(replayed.state.pokerState.version).toBe(9);
expect(replayed.state.acceptedCommandIndex).toBe(1);
expect(replayed.state.charges.swap).toBe(0);
expect(replayed.state.abilityUsedDecisionKey)
  .toBe('hand/1/seat/0/decision/0');
expect(replayed.state.privateKnowledge).toContainEqual({
  type: 'swap',
  street: 'preflop',
  holeCardIndex: 0,
  discardedCard: discarded,
  replacementCard: replacement,
});
expect(replayed.state.pokerState.activeHand!.dealCursor).toBe(5);
expect(replayed.state.pokerState.activeHand!.abilityDiscardedCards)
  .toEqual([discarded]);
```

At the `HandCompleted` prefix assert `privateKnowledge` is empty, `charges.swap` remains `0`, and the completed hand still retains its authoritative discard ledger for audit. At the following `HandStarted` prefix assert the new hand omits the `abilityDiscardedCards` own property.

Tamper each wrapper field and each inner authority field separately: session index, command index, hand number, street, decision key, actor, event index, hand id, seat, hole index, discarded card and replacement card. Every case must reject. Cast a `HoleCardReplaced` into `CoreEventApplied.event` at runtime and assert rejection before core reduction.

For one valid mutable swap event, snapshot it, reduce it, then mutate both nested card objects and the wrapper. Assert the reduced state/event log is unchanged and recursively frozen while the caller's event remains mutable, unfrozen and equal to its pre-reduction snapshot before the deliberate mutation. This prevents authority aliases and reverse-freezing.

In `tests/game/session-export-surface.test.ts` assert:

```ts
const publicApi = await import('../../src/index.js');
expect('exportSessionReplay' in publicApi).toBe(false);
expect('openAuthoritativeGameSession' in publicApi).toBe(false);
expect(JSON.stringify(step)).not.toMatch(/runSeed|fullOrderedDeck|abilityDiscardedCards/);
expect(() => exportSessionReplay(handle as never)).toThrow(/capability|authority/i);
expect(exportSessionReplay(capability).events)
  .toContainEqual(expect.objectContaining({ type: 'HoleCardSwapResolved' }));
```

The repository has no browser entry in this phase. Make the static boundary test walk imports reachable from `src/index.ts` and the TurnPacket/client-safe modules and assert none resolve to `src/game/session-authority.ts`; do not create a browser application solely for this check.

- [ ] **Step 6: Run Session RED tests**

```bash
npm test -- tests/game/swap-ability.test.ts tests/game/session-atomicity.test.ts tests/game/session-replay.test.ts tests/game/session-export-surface.test.ts tests/game/hand-result.test.ts
```

Expected: FAIL because `HoleCardSwapResolved`, live swap dispatch, replay validation and private notice projection are absent.

- [ ] **Step 7: Define the atomic Session event and reducer branch**

In `src/game/session-events.ts`:

```ts
export interface HoleCardSwapResolved extends AbilityEventBase {
  readonly type: 'HoleCardSwapResolved';
  readonly authorityEvent: HoleCardReplacedEvent;
}

export type SessionEvent =
  | CoreEventApplied
  | OpponentCardPeeked
  | OpponentStrengthRead
  | HoleCardSwapResolved;
```

Task 1 already narrowed `CoreEventApplied.event` to `ClassicDomainEvent` and installed the runtime rejection. Task 2 must preserve that guard while widening only `SessionEvent` with the atomic wrapper above.

The `reduceSessionEvent` branch first reads and validates every wrapper/card field into local primitives and canonical card clones, builds a new `clonedEvent`, validates all metadata against the pre-event core state, requires `charges.swap === 1`, requires no ability already used for the decision, applies `reduceDomainEvent(state.pokerState, clonedEvent.authorityEvent)`, then returns one candidate state. It must never append the caller-owned event or freeze caller objects, and it must not mutate a WeakMap, driver or delivery cursor:

```ts
return {
  ...state,
  pokerState: reduceDomainEvent(state.pokerState, clonedEvent.authorityEvent),
  acceptedCommandIndex: state.acceptedCommandIndex + 1,
  charges: { ...state.charges, swap: 0 },
  abilityUsedDecisionKey: clonedEvent.decisionKey,
  privateKnowledge: [...state.privateKnowledge, {
    type: 'swap',
    street: clonedEvent.street,
    holeCardIndex: clonedEvent.authorityEvent.holeCardIndex,
    discardedCard: { ...clonedEvent.authorityEvent.discardedCard },
    replacementCard: { ...clonedEvent.authorityEvent.replacementCard },
  }],
  sessionEventLog: [...state.sessionEventLog, clonedEvent],
};
```

Keep the Task 1 runtime `CoreEventApplied` rejection green; do not add a second path that accepts or directly reduces a wrapped `HoleCardReplaced`.

In `src/game/hand-result.ts`, add a non-root-exported-by-index builder with this exact boundary:

```ts
export function buildAbilityHandResultSummary(
  seats: readonly TournamentSeatInput[],
  viewerEvents: readonly PublicGameEvent[],
  humanSeatIndex: number,
  currentHandSwapEvents: readonly Readonly<HoleCardSwapResolved>[],
): Readonly<HandResultSummary>;
```

The builder first calls the existing `buildHandResultSummary(seats, viewerEvents)` for settlement arithmetic, categories, best-five cards and NPC visibility. Independently scan the complete current-hand viewer stream with dense index loops and capture exactly one human `ownHoleCardsDealt` tuple as the swap-chain base; never use the summary row or a later reveal as that base. Validate each current-hand swap event in order, require `actorSeatIndex === humanSeatIndex`, require the discarded card to match the current derived slot, and replace only that slot with a canonical clone.

If the human never revealed, replace only the human summary row's cards with the derived final tuple. If a human `holeCardsRevealed` exists, require its tuple and the generic summary row to equal the derived final tuple and keep it unchanged; this makes showdown validation idempotent instead of applying the swap twice. Never populate another seat's missing cards or alter category, bestFive, pot or stack arithmetic. Return a new recursively frozen summary without freezing inputs. GameSession and `replaySession()` use this builder for ability-mode hand-result packets with only the completed hand's `HoleCardSwapResolved` events. Classic mode continues to call the original builder unchanged.

- [ ] **Step 8: Tighten the reserved prepared transition seam to one swap event**

In `src/game/tournament-driver.ts`, keep A's direct-import-only method signature unchanged:

```ts
prepareAuthorityTransition(
  transition: Readonly<TransitionResult>,
  source: 'ability-swap',
  commandIndex: number,
): Promise<PreparedDriverTransition>;
```

Inside A's existing `prepareAuthorityTransition` body, add the C-specific guard before its call to the shared candidate-transition helper: source is exactly `ability-swap`; transition has exactly one event of type `HoleCardReplaced`; event index equals current version; event seat equals the current paused decision seat; and `transition.state` is the result of reducing that event. Preserve A's existing non-negative command-index check, busy lease, callback order, local candidate replay and `advance:false` boundary construction. Do not create a second driver mutation method.

`advance:false` produces a candidate decision boundary for the same seat and same core `decisionIndex`. It performs replay/invariants, deep transition comparison, batch creation and every awaitable hook, but changes no committed driver field. The returned object must be recursively frozen, registered in the driver's private prepared-token registry, bound to the current base revision, expose `rejection:null`, and be invalidated by commit or discard. `prepareAuthorityTransition`, `PreparedDriverTransition`, `commitPreparedTransition` and `discardPreparedTransition` remain absent from `src/index.ts`.

- [ ] **Step 9: Implement live GameSession staging and swap projection**

In the `useAbility/swap` branch, perform all common checks before reading the deck. Validate runtime `holeCardIndex`, charge, ability lock and deck availability, then create the core transition with `replaceHoleCard`. Construct the exact `HoleCardSwapResolved` using pre-transition metadata and call `prepareAuthorityTransition(transition, 'ability-swap', acceptedCommandIndex)`; preparation must not change the committed core or Session aggregate and must return `rejection:null`.

Pass the event through `reduceSessionEvent` to produce candidate authority state. Require its `pokerState` to equal `prepared.candidateAuthorityState`, then construct the private notice, refreshed observation, packet, packet transcript and the complete candidate aggregate. The candidate must include, and freeze before commit, all of these fields:

Update the ability-panel projector in `turn-packet.ts` so an unused swap contributes the exact `u swap <1|2>` command entry alongside peek/read. Command availability is derived only from charges plus the current-decision lock; it never exposes the deck, discard ledger or authority event.

```ts
interface PreparedAbilitySessionCommit {
  readonly preparedDriver: PreparedDriverTransition;
  readonly aggregate: InternalGameSessionAggregate;
  readonly result: SessionCommandResult;
}
```

Use this exact module-private composition boundary; it receives the pre-command aggregate explicitly and never rereads the committed WeakMap during staging:

```ts
function buildAndValidateSwapCandidate(options: Readonly<{
  handle: GameSessionHandle;
  previous: Readonly<InternalGameSessionAggregate>;
  prepared: Readonly<PreparedDriverTransition>;
  swapEvent: Readonly<HoleCardSwapResolved>;
}>): Readonly<PreparedAbilitySessionCommit> {
  const { handle, previous, prepared, swapEvent } = options;
  if (prepared.rejection !== null || prepared.candidateBoundary.kind !== 'decision') {
    throw new Error('Invalid prepared swap transition');
  }

  const authority = reduceSessionEvent(
    previous.authority as Readonly<AbilityLabSessionState>,
    swapEvent,
    previous.humanSeatIndex,
  );
  assertDeepStateEqual(authority.pokerState, prepared.candidateAuthorityState);
  if (authority.acceptedCommandIndex
      !== previous.authority.acceptedCommandIndex + 1) {
    throw new Error('Invalid prepared swap command index');
  }

  const packet = createAbilityDecisionPacket({
    packetIndex: previous.delivery.nextPacketIndex,
    fromCoreVersion: previous.delivery.deliveredCoreVersion,
    fromSessionEventIndex: previous.delivery.deliveredSessionEventCount,
    state: authority,
  });
  if (packet.kind !== 'decision'
      || packet.decisionKey !== prepared.candidateBoundary.decisionKey
      || packet.coreEventRange.fromVersionInclusive
        !== previous.delivery.deliveredCoreVersion
      || packet.coreEventRange.toVersionExclusive
        !== prepared.candidateAuthorityState.version) {
    throw new Error('Invalid prepared swap packet');
  }

  const delivery: Readonly<SessionDeliveryState> = deepFreezeValue({
    nextPacketIndex: previous.delivery.nextPacketIndex + 1,
    deliveredCoreVersion: prepared.candidateAuthorityState.version,
    deliveredSessionEventCount: authority.sessionEventLog.length,
    pendingPacket: packet,
  });
  const aggregate = Object.freeze({
    driver: previous.driver,
    humanSeatIndex: previous.humanSeatIndex,
    authority,
    delivery,
  });
  const result: SessionCommandResult = Object.freeze({
    accepted: true,
    step: Object.freeze({ handle, packet }),
  });
  return Object.freeze({
    preparedDriver: prepared,
    aggregate,
    result,
  });
}
```

`assertDeepStateEqual` is the same detached structural comparison used by the driver/session mirror; `deepFreezeValue` freezes only value data and must never traverse or freeze `previous.driver`, the caller-owned event, or a committed authority object. Before returning, also assert that the single new Session tail is the cloned `HoleCardSwapResolved`, that `prepared.transitionBatches` contains exactly the suppressed replacement event, and that the session/core delivery cursors equal the candidate log length/version. These are explicit guards around existing B helpers, not a second rules implementation.

The candidate aggregate contains the updated core mirror, `charges.swap: 0`, decision lock, private knowledge, one appended `HoleCardSwapResolved`, `acceptedCommandIndex + 1`, `nextPacketIndex + 1`, advanced delivered-core/session cursors and the already-built packet. Before commit, assert the candidate event log tail, packet core range and both cursors agree with `prepared.transitionBatches` and `prepared.candidateAuthorityState.version`.

Use one module-private commit function with no fallible work:

```ts
function commitAbilitySessionCandidate(
  handle: GameSessionHandle,
  driver: TournamentDriver,
  candidate: Readonly<PreparedAbilitySessionCommit>,
): SessionCommandResult {
  driver.commitPreparedTransition(candidate.preparedDriver);
  sessions.set(handle, candidate.aggregate);
  return candidate.result;
}
```

The session busy lock prevents any driver/session operation between prepare and commit. `commitPreparedTransition()` has already validated token ownership/freshness during preparation and is specified not to throw for the current token; `handle` was validated before preparation, so the `WeakMap.set` is also non-throwing. Do not project, compare, clone, freeze, log, call user code or `await` inside `commitAbilitySessionCandidate`. This is the only point at which `HoleCardReplaced`, charge, lock, knowledge, Session event, packet and cursors become visible.

Wrap every operation after prepare and before commit so a failure cannot strand the lease:

```ts
let prepared: PreparedDriverTransition | null = null;
try {
  prepared = await driver.prepareAuthorityTransition(
    transition,
    'ability-swap',
    authority.acceptedCommandIndex,
  );
  const candidate = buildAndValidateSwapCandidate({
    handle,
    previous,
    prepared,
    swapEvent,
  });
  const result = commitAbilitySessionCandidate(handle, driver, candidate);
  prepared = null;
  return result;
} catch (error) {
  if (prepared !== null) driver.discardPreparedTransition(prepared);
  throw error;
}
```

After a successful commit set the local reference to `null` before returning, so the catch path cannot discard an already-consumed token.

Project only the safe notice:

```ts
case 'HoleCardSwapResolved':
  return {
    type: 'swap',
    street: event.street,
    holeCardIndex: event.authorityEvent.holeCardIndex,
    discardedCard: cloneCanonicalCard(event.authorityEvent.discardedCard),
    replacementCard: cloneCanonicalCard(event.authorityEvent.replacementCard),
  };
```

The TurnPacket core cursor advances across the authority event even though `projectEventsForViewer()` returns no viewer event.

- [ ] **Step 10: Complete Session replay and bound capability export**

In `replaySession`, pass `HoleCardSwapResolved` through the same `reduceSessionEvent`; do not create a replay-only reducer. After each event assert core invariants and the core event index, Session event index and accepted command index. Extend B's ability-event packet trigger exactly as follows so replay emits the refreshed same-decision packet:

```ts
if (event.type === 'OpponentCardPeeked'
  || event.type === 'OpponentStrengthRead'
  || event.type === 'HoleCardSwapResolved') {
  emitDecisionPacket();
}
```

Regenerate the packet transcript from reconstructed boundaries rather than storing packets in the envelope. The post-swap replay packet must use the same half-open core/session cursor edges, private notice and updated hero observation as the live packet.

Keep `SessionAuthorityCapability` instances in a module-local WeakMap bound to exactly one session host/handle, not to one immutable aggregate snapshot. Its provider dynamically resolves that host's current aggregate on every export, so commands that replace the WeakMap aggregate are visible in later envelopes without changing the capability. `exportSessionReplay(capability)` returns a recursively frozen clone with the approved header and current full private Session event log. Neither authority function is re-exported from `src/index.ts` or imported by CLI.

- [ ] **Step 11: Run Session GREEN and cross-layer checks**

```bash
npm test -- tests/game/swap-ability.test.ts tests/game/session-atomicity.test.ts tests/game/session-replay.test.ts tests/game/session-export-surface.test.ts tests/game/hand-result.test.ts
npm test -- tests/game/tournament-driver.test.ts tests/game/game-session.test.ts tests/game/session-events.test.ts tests/game/turn-packet.test.ts
npm run check
npm run build
git diff --check
```

Expected: all pass; no public packet contains `HoleCardReplaced`, `abilityDiscardedCards`, full deck, burn cards, authority hand id or runSeed.

- [ ] **Step 12: Commit atomic swap and replay**

```bash
git add src/game/session-events.ts src/game/tournament-driver.ts src/game/game-session.ts src/game/session-replay.ts src/game/session-authority.ts src/game/turn-packet.ts src/game/hand-result.ts tests/game/swap-ability.test.ts tests/game/session-atomicity.test.ts tests/game/session-replay.test.ts tests/game/session-export-surface.test.ts tests/game/hand-result.test.ts
git commit -m "feat: add atomic swap ability replay"
```

---

### Task 3: Render and exercise the existing swap command without leaking authority

**Files:**

- Verify: `src/cli/turn-command.ts`
- Modify: `src/cli/turn-renderer.ts`
- Verify: `src/cli/index.ts`
- Verify: `tests/cli/turn-command.test.ts`
- Modify: `tests/cli/turn-renderer.test.ts`
- Modify: `tests/cli/main.test.ts`

**Interfaces:**

- Consumes: B `parseTurnCommand(input, packet)`、`TurnPacket`、Task 2 safe `SessionCommand`/private swap notice。
- Produces: 明确中文换牌结果、能力面板中的 swap 命令和同一决策的普通扑克行动验收；`u swap 1|2` 语法解析已经由 Plan A 提供。
- Preserves: classic 命令、语义节奏、decision panel 立即显示、CLI 不导入 authority-only 模块。

- [ ] **Step 1: Lock the existing parser contract and write renderer RED cases**

In `tests/cli/turn-command.test.ts`:

```ts
expect(parseTurnCommand('u swap 1', abilityPacket)).toEqual({
  ok: true,
  command: {
    type: 'useAbility',
    ability: 'swap',
    decisionKey: abilityPacket.decisionKey,
    expectedPacketIndex: abilityPacket.packetIndex,
    holeCardIndex: 0,
  },
});
expect(parseTurnCommand('u swap 2', abilityPacket)).toEqual({
  ok: true,
  command: {
    type: 'useAbility',
    ability: 'swap',
    decisionKey: abilityPacket.decisionKey,
    expectedPacketIndex: abilityPacket.packetIndex,
    holeCardIndex: 1,
  },
});
```

Assert `u swap 0`, `u swap 3`, `u swap 1.5`, `u swap A`, extra arguments and missing arguments retain Plan A's `{ok:false,message}` parse result and never reach `submitSessionCommand`. These parser assertions must already PASS before any C production change; they prevent a second, incompatible parser contract from being introduced.

In `tests/cli/turn-renderer.test.ts`, render the Task 2 result packet and assert:

```ts
expect(text).toContain('私有情报：手牌 1：2♦ → 3♣（翻牌前更换）');
expect(text).toContain('你的手牌：3♣ 2♠');
expect(text).toContain('本决策已使用能力，请完成扑克行动');
expect(text).not.toContain('u peek');
expect(text).not.toContain('u read');
expect(text).not.toContain('u swap');
expect(text).not.toMatch(/HoleCardReplaced|abilityDiscardedCards|dealCursor|runSeed/);
```

- [ ] **Step 2: Write CLI loop RED behavior**

Stub `openGameSession` to return one decision packet, then a successful swap decision packet, then a successful normal action packet. Feed inputs `u swap 1` and `c`. Assert `submitSessionCommand` receives two commands with packet indexes 0 and 1 and the same decision key, and the prompt remains open after the ability result.

Also feed `u swap 1` in classic mode and assert the CLI displays `经典模式不能使用能力。` rather than a generic invalid action.

- [ ] **Step 3: Run CLI RED tests**

```bash
npm test -- tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/cli/main.test.ts
```

Expected: the existing parser assertions PASS; renderer assertions FAIL because swap notices are not rendered yet. The generic B packet-loop assertion should pass once Task 2 makes swap executable; if it fails, reduce it to the missing renderer/loop behavior without changing the parser return type.

- [ ] **Step 4: Implement safe rendering only**

Do not modify `parseTurnCommand()`: Plan A already matches the complete token shape and returns `TurnCommandParseResult`. Render cards only from `PrivateAbilityNotice` and the current packet observation. Do not inspect handle or import `session-authority.ts`. The B CLI loop already returns to any successor decision packet after a successful ability; keep that generic behavior and verify that only a successful `act` command allows the driver to advance.

- [ ] **Step 5: Run CLI GREEN and pacing regression**

```bash
npm test -- tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/cli/main.test.ts tests/cli/semantic-pacing.test.ts tests/cli/pacing.test.ts
npm run check
npm run build
git diff --check
```

Expected: all pass; swap result and decision panel are immediate and do not add a one-second delay.

- [ ] **Step 6: Commit the CLI closure**

```bash
git add src/cli/turn-renderer.ts tests/cli/turn-renderer.test.ts tests/cli/main.test.ts
git commit -m "feat: expose private swap command in cli"
```

---

### Task 4: Prove the 15 fixed sessions and dual-world privacy boundary

**Files:**

- Create: `tests/integration/ability-session-matrix.test.ts`
- Modify: `tests/agents/hidden-information.test.ts`

**Interfaces:**

- Consumes: 完整 `openAuthoritativeGameSession`、三种能力命令、passive Participant、`replaySession`、`assertTournamentInvariants`。
- Produces: 2–6 人 × peek/read/swap 的确定性结束证据，以及 swap 当下 NPC/spectator 不可见的双世界证据。

- [ ] **Step 1: Write the 15-case matrix acceptance test**

Create exactly these cases:

```ts
const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const;
const ABILITIES = ['peek', 'read', 'swap'] as const;
const CASES = PLAYER_COUNTS.flatMap((playerCount) =>
  ABILITIES.map((ability) => ({
    playerCount,
    ability,
    seed: `ability-session-v1-${playerCount}-${ability}`,
  })));

expect(CASES).toHaveLength(15);
expect(new Set(CASES.map(({ seed }) => seed)).size).toBe(15);
```

Use `startingStack:20`, `handsPerLevel:4`, blinds `1/2, 2/4, 4/8, 8/16`, human seat 0 and deterministic passive NPCs. At the first legal human decision, successfully use the designated ability, then use check/call/fold policy until `game-result`. Ack every `hand-result` before continuing.

For every case assert:

```ts
expect(finalPacket.kind).toBe('game-result');
expect(eventCount).toBeLessThanOrEqual(20_000);
expect(successfulAbilityUses).toBe(1);
expect(finalState.seats.reduce((sum, seat) => sum + seat.stack, 0))
  .toBe(playerCount * 20);
expect(finalState.seats.filter((seat) => seat.stack > 0)).toHaveLength(1);
expect(() => assertTournamentInvariants(finalState)).not.toThrow();
expect(replaySession(exportSessionReplay(capability)).state).toEqual(liveAuthority);
```

For swap cases additionally verify every replayed core prefix, final discard count 1 in the swap hand, unique canonical cards and final showdown use of the replacement card.

- [ ] **Step 2: Write the swap dual-world acceptance test**

Extend `tests/agents/hidden-information.test.ts` with two fixed decks where the human's replacement card and discarded card differ but the NPC's own hand, board and public action prefix match. Compare through the packet immediately after swap and after the human's normal poker action, before another public card is dealt:

```ts
expect(projectEventsForViewer([swapEventA], null)).toEqual([]);
expect(projectEventsForViewer([swapEventB], null)).toEqual([]);
expect(npcObservationA).toEqual(npcObservationB);
expect(npcDecisionA).toEqual(npcDecisionB);
expect(npcObservationA.decisionIndex).toBe(npcObservationB.decisionIndex);
expect(JSON.stringify(npcObservationA)).not.toContain(discardedA.code);
expect(JSON.stringify(npcObservationB)).not.toContain(discardedB.code);
```

The human private notices may differ. After a later community deal, the worlds may diverge because cursor shifting is an allowed public consequence.

- [ ] **Step 3: Run the post-feature integration gate**

```bash
npm test -- tests/integration/ability-session-matrix.test.ts tests/agents/hidden-information.test.ts
```

Expected: PASS if Tasks 1–3 are complete. This is an integration/acceptance gate rather than a new production-behavior RED. If it fails, first reduce the failure to a focused regression in the owning core, session or CLI task, capture that focused RED, and make the smallest production fix there before returning to this matrix.

- [ ] **Step 4: Keep all matrix support test-only**

Keep all session driving inside the test helper; do not add a second production tournament controller or a random ability simulator. Use the real public session API for play and the direct-import authority API only for test verification. If Step 3 already passes, make no production change in this step.

When checking core prefixes, rebuild from null with each embedded classic event and each `HoleCardSwapResolved.authorityEvent`, calling `assertTournamentInvariants` after every reduction.

- [ ] **Step 5: Run integration GREEN and classic 100-hand gate**

```bash
npm test -- tests/integration/ability-session-matrix.test.ts tests/agents/hidden-information.test.ts tests/integration/random-hands.test.ts tests/integration/selectable-tournaments.test.ts
npm run check
npm run build
git diff --check
```

Expected: 15/15 ability sessions finish deterministically; the existing 100 classic random hands and 2–6 selectable tournaments remain green.

- [ ] **Step 6: Commit integration evidence**

```bash
git add tests/integration/ability-session-matrix.test.ts tests/agents/hidden-information.test.ts
git commit -m "test: cover fixed ability session matrix"
```

---

### Task 5: Run full regression, document commands, and record six-player human acceptance

**Files:**

- Create: `docs/playtests/ability-lab-6-player.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: completed Tasks 1–4 and the existing terminal runtime。
- Produces: reproducible user commands, six-player human acceptance record, final automated verification evidence。
- Does not claim: automated tests prove fun, sustained play, browser readiness or production deployment。

- [ ] **Step 1: Update the README with final mode and command contract**

Document these exact commands:

```bash
npm run play -- --mode classic --players 4 --seed classic-demo
npm run play -- --mode ability-lab --players 6 --seed ability-swap-demo
```

Document poker commands `f/x/c/r <金额>/a` and ability commands:

```text
u peek <座位>
u read <座位>
u swap <1|2>
```

State that each ability succeeds once per tournament, at most one ability succeeds per poker decision, and swap changes later undealt cards. State that ordinary replay is classic-only and private ability replay is authority-only.

- [ ] **Step 2: Run the complete automated verification gate**

```bash
npm test
npm run check
npm run build
git diff --check
```

Expected: every test file passes, TypeScript reports no error, build succeeds, and diff check emits no whitespace error. Record the actual test-file and test-case counts in the playtest document; do not copy an older count.

- [ ] **Step 3: Launch the six-player human playtest**

Run:

```bash
npm run play -- --mode ability-lab --players 6 --seed ability-swap-demo
```

During one real terminal tournament:

1. Use peek at one human decision and finish the poker action.
2. Use read at a later human decision and finish the poker action.
3. Use swap at a third human decision and confirm the displayed hand changes immediately.
4. Reach at least the next public street after swap and confirm the table remains understandable.
5. Inspect one showdown/settlement table and one hand-result-to-next-hand pause.
6. Confirm ordinary NPC actions are grouped, street/showdown/settlement pauses remain clear, and the decision panel appears immediately.

- [ ] **Step 4: Write the factual playtest record**

Create `docs/playtests/ability-lab-6-player.md` only after the real run. Use the title `# Ability Lab 六人桌人工验收` and the headings `## 实际操作`, `## 观察`, and `## 结论`. Under the title, record the actual execution date, the exact command, the tested commit SHA, and the observed test-file/test-case counts plus check/build results; do not pre-populate invented values.

Under `实际操作`, record one factual row for each ability. Peek records street, target seat, revealed card and subsequent poker action; Read records street, target seat, returned strength band and subsequent poker action; Swap records street, hole-card slot, discarded card, replacement card and subsequent poker action.

Under `观察`, record an explicit pass/fail and concrete evidence for each of these six observations: NPC action grouping; new-street/showdown/settlement pauses; immediate post-swap hand refresh; correct next-public-street progression; settlement readability across winner/investment/refund/side pot; and absence of private-data leakage in the outputs actually inspected.

Under `结论`, record only `人工验收：通过` when all six observations passed. Otherwise record `人工验收：不通过` and list each reproducible issue with its exact seed and action sequence. When no issue was observed, state `未解决问题：无`.

Do not mark acceptance as passed unless all six observations were made in the real process. If the player is eliminated before all abilities are exercised, rerun the same seed or use a newly recorded seed and state that fact.

- [ ] **Step 5: Re-run docs-sensitive checks and inspect scope**

```bash
npm run check
npm run build
git diff --check
git status --short
```

Expected: checks pass; status contains only the intended README/playtest changes plus any pre-existing unrelated changes that remain unstaged.

- [ ] **Step 6: Commit documentation and human acceptance evidence**

```bash
git add README.md docs/playtests/ability-lab-6-player.md
git commit -m "docs: record ability lab acceptance"
```

---

## Final Verification Checklist

- [ ] `HoleCardReplaced` can only consume the current authoritative next card for the funded current actor.
- [ ] `abilityDiscardedCards` appears only after a real replacement and resets by property omission next hand.
- [ ] Every swapped core prefix satisfies the 52-card ledger and chip conservation.
- [ ] Existing automatic burn/community logic naturally shifts future cards through `dealCursor`.
- [ ] Showdown reveals and evaluates only final hole cards.
- [ ] Public projection and NPC observation suppress the replacement event and its cards.
- [ ] Agent decision index and RNG path ignore ability events.
- [ ] Classic replay rejects replacement events before reduction; classic golden output remains identical.
- [ ] One successful swap produces one `HoleCardSwapResolved`, consumes one charge and increments one accepted command index.
- [ ] Failed swap commands and failed transaction hooks leave core, session, packet, cursors and capability export unchanged.
- [ ] Session replay rejects every inconsistent wrapper or authority card and reconstructs every valid prefix exactly.
- [ ] Root/CLI/client-safe import graph cannot reach the authority export module.
- [ ] `u swap 1|2` works, malformed indexes are pure, and the normal poker action remains required.
- [ ] All 15 fixed ability sessions finish and replay exactly.
- [ ] Existing 100-hand classic gate, full suite, type-check and build pass.
- [ ] A real six-player ability-lab run is recorded separately from automated evidence.
