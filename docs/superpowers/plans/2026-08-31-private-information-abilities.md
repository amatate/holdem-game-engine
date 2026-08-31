# 私密信息能力会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在里程碑 A 的经典 TurnPacket 会话之上加入可选的 `ability-lab`，让人类玩家每场比赛各使用一次“偷看”和“读牌”，并保证经典核心、NPC 随机路径、私密信息和精确回放边界不被破坏。

**Architecture:** 核心 `DomainEvent` 与 `TournamentState` 继续只表达标准德州扑克；能力次数、私密知识和成功命令索引进入独立的 `SessionEvent` 流。`GameSession` 使用里程碑 A 的 `preparePausedAction()` / `prepareContinueAfterHand()` 取得尚未提交的 candidate state、boundary 和 frozen batches，先完成 SessionEvent reduction 与 TurnPacket 投影，再通过同步不可 await 的 `commitPreparedTransition()` 和紧随其后的 WeakMap replacement 完成单一不可观察提交；peek/read 使用独立可复现的能力 RNG。TurnPacket 只接收字段白名单投影，含完整牌堆和内部权益统计的 replay 只能通过 authority-only capability 导出。

**Tech Stack:** Node.js 22+、TypeScript 7、ESM、Vitest 4、tsx；无新增 runtime dependency。

**Spec:** `docs/superpowers/specs/2026-08-31-turn-packets-and-ability-lab-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-31-classic-turn-packets-and-cli.md` 的 Milestone A Completion Gate 全部通过后再执行本计划。

## Global Constraints

- 本计划只实现里程碑 B：ability-lab 会话、peek/read、私密投影、known-hand equity 和 session replay；不实现可执行 swap 或 `HoleCardReplaced`。
- 不修改 `src/core/events.ts`、`src/core/state.ts`、`src/core/invariants.ts`、`src/core/public-events.ts`、`src/core/replay.ts`、`src/agents/types.ts`、`src/agents/observation.ts`。
- `Participant`、`PokerAgent`、`PlayerObservationV1`、`DomainEvent`、`TournamentState`、`ReplayEnvelopeV1` 和 `RULES_VERSION = 'holdem-v1'` 保持不变。
- `classic` 在相同 config、seats、runSeed 和扑克行动下必须保持逐字段相同的核心 state、eventLog、牌堆、筹码、回放和 Agent RNG `agent/<hand>/<seat>/<decision>` 路径。
- `ability-lab` 的 peek/read 不产生核心事件；在相同扑克行动下，其核心 state、核心事件和 Agent RNG 必须与不用能力的对照局相同。
- 每种能力每场比赛一次，同一扑克决策点最多成功使用一种；成功能力不替代扑克行动，失败能力命令完全纯净且不得创建或消费 RNG。
- 能力 RNG 路径固定为 `ability/ability-lab-v1/<handNumber>/<decisionIndex>/<acceptedCommandIndex>/peek|read`，不得从 Agent 的 `RandomSource` fork。
- `acceptedCommandIndex` 从 0 开始，只统计成功的人类能力和成功的人类扑克行动；核心 decisionIndex、core eventIndex 和 sessionEventIndex 保持独立。
- 玩家 TurnPacket 不得包含 runSeed、权威 handId、完整牌堆、烧牌、未授权手牌、read 原始 equity/audit 或 authority 对象别名。
- authority replay capability 不得出现在 `SessionStep`、`GameSessionHandle`、CLI、根 `src/index.ts` 或浏览器安全依赖图；普通 handle 不足以导出私密 replay。
- `GameSession` 对能力命令先构造候选 SessionEvent、候选会话状态和候选 TurnPacket，全部验证/投影成功后才一次替换已提交 aggregate；拒绝或异常不得留下半扣次数、半写事件或已移动游标。
- 对扑克行动和 hand-result acknowledgement，所有可失败的 session reduction、packet projection、callback 和校验必须发生在 `commitPreparedTransition()` 前；commit 与 WeakMap replacement 之间不得 `await`、调用用户代码或执行仍可能失败的投影。
- `SessionEvent` reducer 和 replay 不读取系统时间、`Math.random()`，也不重新运行已记录的 read Monte Carlo。
- B 阶段 `AbilityId` 和次数记录保留最终三项 `peek/read/swap`，但 ability-lab TurnPacket 只提供 peek/read 命令；直接提交 swap 暂时固定拒绝为 `malformed-command` 且完全纯净，里程碑 C 再替换为权威实现。
- 不修改 `sources/`、`AGENTS.md`，不加入 NPC 能力、怀疑值、平衡费用、浏览器 UI、长期记忆或新依赖。
- 每项生产行为严格执行 red → green → refactor；先运行聚焦测试并确认预期失败，再做最小实现。
- 一个 Step 内的每个表格行、测试 bullet 和伪造案例都视为独立的 2–5 分钟微步骤：一次只新增一个断言并取得对应 RED，再做最小 GREEN；不得把整组案例一次性写完后才运行。
- 每个任务只提交其 Files 列表中的文件；提交前运行 focused tests、`npm run check`、`npm run build` 和 `git diff --check`。

---

## File Map

### Pure equity and strength classification

- `src/agents/equity.ts`: 抽取 `estimateKnownHandEquity()`，保留现有 `estimateEquity()` 的五字段结果和随机向量。
- `src/game/ability-strength.ts` (new): read 样本数、算法版本、弱中强阈值和 replay audit 校验。
- `tests/agents/equity.test.ts`: known-hand 输入、整数平分、RNG 消费和旧接口回归。
- `tests/game/ability-strength.test.ts` (new): 两个阈值等号、audit 算术与非法统计。

### Session authority and private events

- `src/game/session-types.ts`: 扩展模式、能力状态、能力拒绝码和私密知识类型；根入口只导出 safe 子集。
- `src/game/session-events.ts` (new): `CoreEventApplied`、peek/read 私密事件、字段白名单投影和纯 session reducer。
- `src/game/game-session.ts`: 扩展里程碑 A 的 opaque classic host，接入能力预检、独立 RNG、候选提交和 session 游标。
- `src/game/turn-packet.ts`: 能力面板、私密增量和 ability-lab decision packet；classic packet 形状保持兼容。
- `tests/game/session-events.test.ts` (new): session 双索引、reducer 权威和拒绝纯度。
- `tests/game/game-session-abilities.test.ts` (new): peek/read 生命周期、命令身份、次数和原子性。
- `tests/game/session-privacy.test.ts` (new): 双世界、sentinel、deep-freeze、NPC/spectator 隔离。
- `tests/game/turn-packet.test.ts`: 扩展能力面板、空核心区间、私密游标和 classic null 面板。

### Private exact replay

- `src/game/session-replay.ts` (new): 私密 envelope header、逐 SessionEvent 前缀重建和确定性 packet transcript。
- `src/game/session-authority.ts` (new): authority-only open、capability 到 replay provider 的 WeakMap、私密 envelope 导出；只允许直接 authority import。
- `tests/game/session-replay.test.ts` (new): 前缀重建、tamper、无 ambient RNG/time 和 transcript 等价。
- `tests/game/session-export-surface.test.ts` (new): safe handle 与根/CLI 导出边界。

### CLI and integration

- `src/cli/options.ts`: `--mode classic|ability-lab` 和默认 classic 模式提问。
- `src/cli/turn-renderer.ts`: 能力次数、私密知识、能力结果和安全拒绝文案。
- `src/cli/index.ts`: 将所选 mode 传给既有 GameSession packet loop。
- `tests/cli/options.test.ts`: mode 参数、重复/非法值和默认提问。
- `tests/cli/turn-command.test.ts`: 复验里程碑 A 已解析的 `u peek/read/swap` 命令身份。
- `tests/cli/turn-renderer.test.ts`: 能力结果、累计侧栏和无 audit 泄漏。
- `tests/cli/main.test.ts`: mode 组装、能力成功后同决策重显和 prompt 生命周期。
- `tests/integration/ability-lab-session.test.ts` (new): 真实 2/4 人短局、classic 隔离、NPC RNG 与完整 replay。
- `src/index.ts`: named-export safe session/packet/能力纯函数；不导出 authority capability 或私密 replay。
- `README.md`: 当前源码的 classic 与 ability-lab（peek/read）运行说明。

---

### Task 1: Extract the deterministic known-hand equity kernel

**Files:**

- Modify: `src/agents/equity.ts:6-221`
- Modify: `tests/agents/equity.test.ts:124-419`
- Verify: `src/agents/parametric-agent.ts:525-543`
- Verify: `tests/agents/parametric-agent.test.ts`

**Interfaces:**

- Consumes: `Card`、`RandomSource`、`createStandardDeck()`、`shuffleDeck()`、`evaluateBest()`、`compareHandRanks()`。
- Produces: `KnownHandEquityInput`、`KnownHandEquityAudit`、`estimateKnownHandEquity(input, samples, random)`。
- Preserves exactly: `EquityEstimate`、`MAX_EQUITY_SAMPLES`、`estimateEquity(observation, samples, random)` 的五字段对象和固定种子数值。

- [ ] **Step 1: Add known-hand validation and audit RED tests**

Extend `tests/agents/equity.test.ts` with direct inputs:

```ts
const known = (
  holeCards: readonly [string, string],
  board: readonly string[],
  livePlayerCount: number,
): KnownHandEquityInput => ({
  holeCards: holeCards.map(parseCard) as [Card, Card],
  board: board.map(parseCard),
  livePlayerCount,
});

expect(estimateKnownHandEquity(
  known(['2c', '3d'], ['As', 'Ks', 'Qs', 'Js', 'Ts'], 6),
  7,
  createSeededRandom('known-board-tie'),
)).toEqual({
  equity: 1 / 6,
  wins: 0,
  ties: 7,
  losses: 0,
  samples: 7,
  equityUnits: 70,
  equityUnitScale: 60,
  tieSplitCounts: [0, 0, 0, 0, 7],
});
```

Add one royal-flush win and one forced loss. For live counts 2–6, use a board royal and assert the only nonzero tuple slot is `livePlayerCount - 2`, and `equityUnits` is `samples * (60 / livePlayerCount)`.

Reject before RNG consumption:

```ts
const invalidKnownInputs = [
  { ...known(['Ah', 'Kd'], [], 2), livePlayerCount: 1 },
  { ...known(['Ah', 'Kd'], [], 2), livePlayerCount: 7 },
  { ...known(['Ah', 'Kd'], [], 2), livePlayerCount: 2.5 },
  { ...known(['Ah', 'Kd'], [], 2), holeCards: [parseCard('Ah'), parseCard('Ah')] },
  { ...known(['Ah', 'Kd'], ['2c', '3d', '4h'], 2), board: [parseCard('Ah'), parseCard('3d'), parseCard('4h')] },
  { ...known(['Ah', 'Kd'], [], 2), board: [parseCard('2c')] },
];
for (const input of invalidKnownInputs) {
  const tracked = trackedRandom('known-invalid');
  expect(() => estimateKnownHandEquity(input as KnownHandEquityInput, 10, tracked.random)).toThrow('Invalid equity input');
  expect(tracked.calls).toEqual({ nextFloat: 0, nextUint32: 0, fork: 0 });
}
```

- [ ] **Step 2: Lock the legacy wrapper shape and RNG vector**

Retain every existing expected result and add:

```ts
const legacy = estimateEquity(fixtureObservation({
  holeCards: ['As', 'Ks'],
  board: ['Qs', 'Js', 'Ts', '2d', '3c'],
}), 50, createSeededRandom('eq'));
expect(Object.keys(legacy).sort()).toEqual(['equity', 'losses', 'samples', 'ties', 'wins']);
expect(legacy).toEqual({ equity: 1, wins: 50, ties: 0, losses: 0, samples: 50 });
expect(legacy).not.toHaveProperty('equityUnits');
expect(legacy).not.toHaveProperty('tieSplitCounts');
```

Use the existing tracked RNG fixture and retain the exact `samples * (unknownDeckLength - 1)` `nextFloat` count.

- [ ] **Step 3: Run RED before extraction**

```bash
npm test -- tests/agents/equity.test.ts
```

Expected: FAIL because `KnownHandEquityInput` and `estimateKnownHandEquity` are not exported; all pre-existing equity tests remain green.

- [ ] **Step 4: Extract one shared Monte Carlo kernel**

In `src/agents/equity.ts`, add:

```ts
export interface KnownHandEquityInput {
  readonly holeCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly livePlayerCount: number;
}

export interface KnownHandEquityAudit extends EquityEstimate {
  readonly equityUnits: number;
  readonly equityUnitScale: 60;
  readonly tieSplitCounts: readonly [number, number, number, number, number];
}

export function estimateKnownHandEquity(
  input: Readonly<KnownHandEquityInput>,
  samples: number,
  random: RandomSource,
): KnownHandEquityAudit;
```

Validate `samples` first, clone exactly two canonical hole cards, accept only board lengths `0/3/4/5`, require `livePlayerCount` to be a safe integer from 2 through 6, and construct the unknown standard deck after checking all known cards are unique. Set `liveOpponentCount = livePlayerCount - 1`.

Track ties without floating accumulation:

```ts
const tieSplitCounts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
// winnerCount is 2..6 when the known hand shares the global best rank.
tieSplitCounts[winnerCount - 2] += 1;
equityUnits += EQUITY_UNIT_SCALE / winnerCount;
```

Keep shuffle order, opponent deal order and completed-board order byte-for-byte equivalent to the existing loop. Make `estimateEquity()` validate the observation, delegate with `livePlayerCount = liveOpponentCount + 1`, then explicitly return only:

```ts
return {
  equity: audit.equity,
  wins: audit.wins,
  ties: audit.ties,
  losses: audit.losses,
  samples: audit.samples,
};
```

- [ ] **Step 5: Run focused GREEN and legacy Agent regressions**

```bash
npm test -- tests/agents/equity.test.ts tests/agents/parametric-agent.test.ts tests/agents/style-benchmarks.test.ts tests/agents/new-character-styles.test.ts
npm run check
npm run build
git diff --check
```

Expected: all old vectors and behavior distributions pass; `estimateEquity()` still returns exactly five enumerable keys.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/agents/equity.ts tests/agents/equity.test.ts
git commit -m "refactor: extract known hand equity estimator"
```

---

### Task 2: Define ability strength, private SessionEvents and the pure reducer

**Files:**

- Create: `src/game/ability-strength.ts`
- Create: `src/game/session-events.ts`
- Modify: `src/game/session-types.ts`
- Create: `tests/game/ability-strength.test.ts`
- Create: `tests/game/session-events.test.ts`

**Interfaces:**

- Consumes: Task 1 `KnownHandEquityAudit`; Plan A `SessionCommand`、`TournamentDriver` source names、`TournamentState`、`reduceDomainEvent()`、`assertTournamentInvariants()`。
- Produces: `AbilityId`、`AbilityRejectionCode`、`PrivateKnowledgeEntry`、`AbilityLabSessionState`、`SessionEvent`、`reduceSessionEvent()`、`projectPrivateAbilityNotice()`、read constants/classifier/audit validator。
- Later Task 5 consumes the same reducer for exact replay; Plan C widens `SessionEvent` with `HoleCardSwapResolved` without renaming these interfaces.

- [ ] **Step 1: Write threshold and audit RED tests**

Create `tests/game/ability-strength.test.ts` and lock:

```ts
expect(READ_STRENGTH_SAMPLE_COUNT).toBe(1_000);
expect(READ_STRENGTH_ALGORITHM_VERSION).toBe('known-hand-monte-carlo-v1');
expect(classifyKnownHandStrength(0.399_999, 2)).toBe('weak');
expect(classifyKnownHandStrength(0.4, 2)).toBe('medium');
expect(classifyKnownHandStrength(0.749_999, 2)).toBe('medium');
expect(classifyKnownHandStrength(0.75, 2)).toBe('strong');
expect(classifyKnownHandStrength(0.8 / 6, 6)).toBe('medium');
expect(classifyKnownHandStrength(1.5 / 6, 6)).toBe('strong');
```

Validate a six-way tie audit and reject each isolated corruption:

```ts
const sixWayTie: KnownHandEquityAudit = {
  equity: 1 / 6,
  wins: 0,
  ties: 1000,
  losses: 0,
  samples: 1000,
  equityUnits: 10_000,
  equityUnitScale: 60,
  tieSplitCounts: [0, 0, 0, 0, 1000],
};
expect(validateKnownHandEquityAudit(sixWayTie, 6, 1000)).toEqual(sixWayTie);
expect(() => validateKnownHandEquityAudit({ ...sixWayTie, ties: 999 }, 6, 1000)).toThrow();
expect(() => validateKnownHandEquityAudit({ ...sixWayTie, equityUnits: 9_999 }, 6, 1000)).toThrow();
expect(() => validateKnownHandEquityAudit(sixWayTie, 2, 1000)).toThrow();
```

Also reject NaN/infinite equity, negative/fractional/unsafe counts, wrong tuple length, samples other than the expected value and nonzero tie slots whose winner count exceeds `livePlayerCount`.

- [ ] **Step 2: Write SessionEvent reducer RED tests**

Create `tests/game/session-events.test.ts`. Define final B types in `src/game/session-types.ts`:

```ts
export type AbilityId = 'peek' | 'read' | 'swap';
export type StrengthBand = 'weak' | 'medium' | 'strong';

export type PrivateKnowledgeEntry =
  | Readonly<{ type: 'peek'; targetSeatIndex: number; street: Street; card: Card }>
  | Readonly<{
      type: 'read';
      targetSeatIndex: number;
      street: Street;
      band: StrengthBand;
      algorithmVersion: 'known-hand-monte-carlo-v1';
    }>
  | Readonly<{
      type: 'swap';
      street: Street;
      holeCardIndex: 0 | 1;
      discardedCard: Card;
      replacementCard: Card;
    }>;

export type PrivateAbilityNotice = PrivateKnowledgeEntry;

export interface SessionBaseState {
  readonly mode: 'classic' | 'ability-lab';
  readonly humanSeatIndex: number;
  readonly pokerState: TournamentState;
  readonly acceptedCommandIndex: number;
}

export interface ClassicSessionState extends SessionBaseState {
  readonly mode: 'classic';
}

export type AbilityRejectionCode =
  | 'wrong-mode'
  | 'not-human-turn'
  | 'stale-decision'
  | 'stale-packet'
  | 'ability-spent'
  | 'ability-already-used-this-decision'
  | 'invalid-target'
  | 'target-cards-public'
  | 'invalid-hole-card-index'
  | 'deck-exhausted'
  | 'malformed-command';

export interface AbilityLabSessionState extends SessionBaseState {
  readonly mode: 'ability-lab';
  readonly charges: Readonly<Record<AbilityId, 0 | 1>>;
  readonly privateKnowledge: readonly PrivateKnowledgeEntry[];
  readonly abilityUsedDecisionKey: string | null;
  readonly sessionEventLog: readonly SessionEvent[];
}

export type GameSessionState = ClassicSessionState | AbilityLabSessionState;
```

Extend `OpenGameSessionOptions.mode` from `'classic'` to `'classic' | 'ability-lab'`. Keep Plan A function names and `SessionCommand` unchanged. Widen `SessionCommandResult.rejection` to `AbilityRejectionCode | ActionRejectionCode`.

Create these events in `src/game/session-events.ts`:

```ts
export const SESSION_SCHEMA_VERSION = 1 as const;
export const ABILITY_RULES_VERSION = 'ability-lab-v1' as const;

export type SessionEvent = CoreEventApplied | OpponentCardPeeked | OpponentStrengthRead;

export interface CoreEventApplied {
  readonly type: 'CoreEventApplied';
  readonly schemaVersion: 1;
  readonly sessionEventIndex: number;
  readonly source: 'automatic' | 'npc' | 'human-poker';
  readonly commandIndex: number | null;
  readonly event: DomainEvent;
}

export interface AbilityEventBase {
  readonly schemaVersion: 1;
  readonly sessionEventIndex: number;
  readonly commandIndex: number;
  readonly handNumber: number;
  readonly street: Street;
  readonly decisionKey: string;
  readonly actorSeatIndex: number;
}

export interface OpponentCardPeeked extends AbilityEventBase {
  readonly type: 'OpponentCardPeeked';
  readonly targetSeatIndex: number;
  readonly revealedHoleCardIndex: 0 | 1;
  readonly revealedCard: Card;
}

export interface OpponentStrengthRead extends AbilityEventBase {
  readonly type: 'OpponentStrengthRead';
  readonly targetSeatIndex: number;
  readonly band: StrengthBand;
  readonly algorithmVersion: 'known-hand-monte-carlo-v1';
  readonly sampleCount: 1000;
  readonly livePlayerCount: number;
  readonly estimate: KnownHandEquityAudit;
}
```

Use type-only imports between `session-types.ts` and `session-events.ts` so this type cycle creates no runtime import cycle. Build a real fixed-deck preflop authority prefix and assert:

- `CoreEventApplied(GameStarted)` at index 0 initializes charges `{peek:1,read:1,swap:1}` and command index 0;
- every embedded core event keeps its own contiguous `eventIndex`, while SessionEvent uses its separate contiguous index;
- `automatic/npc` requires `commandIndex:null`;
- `human-poker` requires current `acceptedCommandIndex`, embeds `PlayerActed`, increments it once and clears `abilityUsedDecisionKey`;
- `OpponentCardPeeked` checks the current human decision, target slot/card, charge and lock, then increments command index and adds only the safe knowledge entry;
- `OpponentStrengthRead` validates target/live count/audit/band and does not rerun estimation;
- wrapping `HandCompleted` clears knowledge at that prefix but preserves charges;
- malformed indices, target, card, audit, source or command index throw while the input state remains deep-equal and unfrozen.

- [ ] **Step 3: Run the missing-module RED**

```bash
npm test -- tests/game/ability-strength.test.ts tests/game/session-events.test.ts
```

Expected: FAIL because both production modules and ability state types are missing.

- [ ] **Step 4: Implement read classification and exact audit validation**

In `src/game/ability-strength.ts` export:

```ts
export const READ_STRENGTH_SAMPLE_COUNT = 1_000 as const;
export const READ_STRENGTH_ALGORITHM_VERSION = 'known-hand-monte-carlo-v1' as const;

export function classifyKnownHandStrength(
  equity: number,
  livePlayerCount: number,
): StrengthBand {
  if (!Number.isFinite(equity) || equity < 0 || equity > 1
    || !Number.isSafeInteger(livePlayerCount)
    || livePlayerCount < 2 || livePlayerCount > 6) {
    throw new Error('Invalid known-hand strength data');
  }
  const fairShare = 1 / livePlayerCount;
  if (equity < 0.8 * fairShare) return 'weak';
  if (equity < 1.5 * fairShare) return 'medium';
  return 'strong';
}
```

`validateKnownHandEquityAudit()` must clone into a fresh object and enforce:

```text
ties = sum(tieSplitCounts)
wins + ties + losses = samples
equityUnits = wins*60 + tie2*30 + tie3*20 + tie4*15 + tie5*12 + tie6*10
equity = equityUnits / (60*samples)
```

Every count is a non-negative safe integer; `equityUnitScale` is exactly 60; tuple slot `winnerCount > livePlayerCount` is zero.

- [ ] **Step 5: Implement the authoritative SessionEvent reducer**

`reduceSessionEvent()` has this exact signature:

```ts
export function reduceSessionEvent(
  state: Readonly<AbilityLabSessionState> | null,
  event: Readonly<SessionEvent>,
  humanSeatIndex: number,
): AbilityLabSessionState;
```

For the first event, only an automatic/null `CoreEventApplied(GameStarted)` at session index 0 is legal. Reduce the embedded event through `reduceDomainEvent(null, event.event)`, initialize all charges, then append the cloned session event.

For subsequent core events, clone/validate the event, reduce it against `state.pokerState`, run `assertTournamentInvariants()`, and commit the resulting pokerState and session log together. For ability events, validate every base field against the pre-event state and derive `decisionKey` with Plan A `createDecisionKey()`; never trust a supplied band or card without comparison to authority.

`projectPrivateAbilityNotice()` returns field-by-field safe clones:

```ts
case 'OpponentCardPeeked':
  return { type: 'peek', targetSeatIndex: event.targetSeatIndex,
    street: event.street, card: cloneCanonicalCard(event.revealedCard) };
case 'OpponentStrengthRead':
  return { type: 'read', targetSeatIndex: event.targetSeatIndex,
    street: event.street, band: event.band,
    algorithmVersion: event.algorithmVersion };
case 'CoreEventApplied':
  return null;
```

Do not spread raw events: read audit and core authority fields must never enter this projector.

- [ ] **Step 6: Run focused GREEN and commit**

```bash
npm test -- tests/game/ability-strength.test.ts tests/game/session-events.test.ts tests/core/reducer-authority.test.ts tests/core/invariants.test.ts
npm run check
npm run build
git diff --check
git add src/game/ability-strength.ts src/game/session-events.ts src/game/session-types.ts tests/game/ability-strength.test.ts tests/game/session-events.test.ts
git commit -m "feat: add private ability session events"
```

---

### Task 3: Extend GameSession and TurnPacket with deterministic peek

**Files:**

- Modify: `src/game/game-session.ts`
- Modify: `src/game/turn-packet.ts`
- Modify: `tests/game/turn-packet.test.ts`
- Create: `tests/game/game-session-abilities.test.ts`
- Create: `tests/game/session-privacy.test.ts`

**Interfaces:**

- Consumes: Plan A opaque handle/delivery API、`preparePausedAction()`、`prepareContinueAfterHand()`、`PreparedDriverTransition` candidate state/boundary/frozen batches and synchronous `commitPreparedTransition()`; Task 2 state, reducer and private projector; `createSeededRandom()`.
- Produces: ability-lab behavior through unchanged safe functions `openGameSession`、`getCurrentPacket`、`submitSessionCommand`、`continueAfterHandResult`; `AbilityPanel` and `createAbilityDecisionPacket()`.
- Preserves: classic aggregate contains no SessionEvent log/charges/knowledge; classic TurnPacket keeps `abilities:null` and empty private increments.

This task relies on the final Plan A internal transaction contract:

```ts
export interface PreparedDriverTransition {
  readonly candidateAuthorityState: Readonly<TournamentState>;
  readonly candidateBoundary: Readonly<DriverBoundary>;
  readonly transitionBatches: readonly Readonly<DriverTransitionBatch>[];
  readonly rejection: Readonly<ActionRejection> | null;
}

prepareOpen(): Promise<PreparedDriverTransition>;
preparePausedAction(
  seatIndex: number,
  intent: Readonly<ActionIntent>,
  commandIndex: number,
): Promise<PreparedDriverTransition>;
prepareContinueAfterHand(): Promise<PreparedDriverTransition>;
commitPreparedTransition(
  prepared: PreparedDriverTransition,
): Readonly<DriverBoundary>;
discardPreparedTransition(
  prepared: PreparedDriverTransition,
): void;
```

`PreparedDriverTransition` carries an internal revision/token that callers cannot forge; prepare performs all revision validation. GameSession calls commit exactly once after all candidate work succeeds. Commit is synchronous and cannot await, call user code or perform new fallible validation/projection.

- [ ] **Step 1: Write ability panel and cursor RED tests**

Extend `src/game/turn-packet.ts` types through tests:

```ts
export interface AbilityPanel {
  readonly remaining: Readonly<Record<AbilityId, 0 | 1>>;
  readonly usedThisDecision: boolean;
  readonly availableCommands: readonly AbilityCommandView[];
  readonly knowledge: readonly PrivateKnowledgeEntry[];
}

export interface AbilityCommandView {
  readonly ability: AbilityId;
  readonly command: string;
  readonly label: string;
}
```

Keep Plan A's generic `PacketBase<TPrivateEvents = readonly []>` unchanged. Ability-lab decision packets specialize it as `PacketBase<readonly PrivateAbilityNotice[]>`; classic decision and hand/game packet variants continue to use the default exact `readonly []` and therefore are not type-widened. Ability-lab decision packets contain an `AbilityPanel`; classic remains `null`.

Add the distinct packet variant and widen the existing union without weakening the classic type:

```ts
export type AbilityDecisionPacket = Readonly<PacketBase<readonly PrivateAbilityNotice[]> & {
  kind: 'decision';
  decisionKey: string;
  observation: Readonly<PlayerObservationV1>;
  actionPanel: Readonly<ActionPanel>;
  abilities: Readonly<AbilityPanel>;
}>;

export type DecisionPacket = ClassicDecisionPacket | AbilityDecisionPacket;
export type TurnPacket = DecisionPacket | HandResultPacket | GameResultPacket;
```

Add compile-time assertions that `ClassicDecisionPacket['privateEventsSinceLastPacket']` and both result variants remain `readonly []`, while `AbilityDecisionPacket['privateEventsSinceLastPacket']` is `readonly PrivateAbilityNotice[]`.

For a fresh ability state assert:

```ts
expect(packet.abilities).toEqual({
  remaining: { peek: 1, read: 1, swap: 1 },
  usedThisDecision: false,
  availableCommands: [
    { ability: 'peek', command: 'u peek <座位>', label: '偷看一张对手底牌' },
    { ability: 'read', command: 'u read <座位>', label: '读取对手当前牌力' },
  ],
  knowledge: [],
});
```

After one peek event at unchanged core version, assert the next packet has the same decisionKey, `packetIndex + 1`, core range `[v,v)`, no viewer core events, exactly one private notice, `usedThisDecision:true`, no available ability commands and a full one-entry knowledge snapshot. Re-reading returns the same frozen packet object and moves no cursor.

Drive an ability-mode action directly to `hand-result`, then acknowledge into either the next decision or `game-result`. Assert both non-decision packets retain the final `PacketBase` shape, expose no ability panel, have `privateEventsSinceLastPacket:[]`, and nevertheless advance the internal `deliveredSessionEventCount` to the complete candidate `sessionEventLog.length`. The following packet must not rescan or redeliver any `CoreEventApplied` or expired private notice.

- [ ] **Step 2: Write deterministic peek and rejection RED cases**

Open a real heads-up ability-lab session with human provider `null`. For the current packet submit:

```ts
const peek = await submitSessionCommand(step.handle, {
  type: 'useAbility',
  ability: 'peek',
  targetSeatIndex: 1,
  decisionKey: decision.decisionKey,
  expectedPacketIndex: decision.packetIndex,
});
```

Compute the expected slot with exactly one random value:

```ts
const expectedRandom = createSeededRandom(
  seed,
  `ability/ability-lab-v1/${decision.observation.handNumber}/${decision.observation.decisionIndex}/0/peek`,
);
const expectedIndex: 0 | 1 = expectedRandom.nextFloat() < 0.5 ? 0 : 1;
```

Use an authority-only test fixture to verify the notice card equals that target slot. Assert only peek is spent, accepted command becomes 1, core state/version/eventLog are unchanged, and a legal poker action using the new packet remains required.

Table-drive all rejections:

```ts
[
  ['classic', 'wrong-mode'],
  ['no active hand', 'not-human-turn'],
  ['hand-result boundary', 'not-human-turn'],
  ['game-result boundary', 'not-human-turn'],
  ['human folded', 'not-human-turn'],
  ['human all-in', 'not-human-turn'],
  ['human eliminated', 'not-human-turn'],
  ['different current actor', 'not-human-turn'],
  ['old packet', 'stale-packet'],
  ['old decision', 'stale-decision'],
  ['self target', 'invalid-target'],
  ['negative target', 'invalid-target'],
  ['fractional target', 'invalid-target'],
  ['unsafe integer target', 'invalid-target'],
  ['folded target', 'invalid-target'],
  ['eliminated target', 'invalid-target'],
  ['revealed target', 'target-cards-public'],
  ['string target', 'malformed-command'],
  ['missing target field', 'malformed-command'],
  ['null command', 'malformed-command'],
  ['array command', 'malformed-command'],
  ['unknown ability', 'malformed-command'],
] as const
```

Also assert spent peek returns `ability-spent`, a second ability at the same decision returns `ability-already-used-this-decision`, and ability-lab swap returns `malformed-command`. When both packet and decision are stale, assert `stale-packet`. For every row snapshot and compare core state/version/log, Session log, charges, knowledge, acceptedCommandIndex, pending packet, packet/core/session cursors and every ability RNG counter; all remain exactly unchanged and the rejection returns the same pending packet object.

Add a separate state with an unrevealed `all-in` target while the human still has a real decision; peek must succeed. Then add the target seat to `revealedHoleCardSeats` and assert the same command returns `target-cards-public` without reading either target card.

- [ ] **Step 3: Add invalid-then-valid RNG and atomicity RED cases**

Run two otherwise identical sessions:

- control: immediately use legal peek;
- probe: submit malformed, invalid target, stale packet, then the same legal peek.

Assert both legal results reveal the same slot/card. Import `* as turnPacketModule` and use `vi.spyOn(turnPacketModule, 'createAbilityDecisionPacket').mockImplementationOnce(() => { throw new Error('packet-projector-sentinel'); })`; assert the command rejects with that sentinel and the next normal call still sees charge 1, no private event, the old packet and accepted command index 0. Restore the spy before the retry; do not add a test-only production option.

Repeat the throwing projector test for a legal human poker action. Inspect authority through the direct test-only driver seam before and after rejection and assert core version/eventLog, session state, pending packet and all cursors are unchanged. Retry the same poker action after restoring the projector and assert exactly one driver commit and one new packet. Add the equivalent failure case for `continueAfterHandResult()`: packet projection failure leaves the same hand-result pending and does not start the next hand.

- [ ] **Step 4: Run feature RED**

```bash
npm test -- tests/game/turn-packet.test.ts tests/game/game-session-abilities.test.ts tests/game/session-privacy.test.ts
```

Expected: FAIL because Plan A only accepts classic mode and has no ability state/panel.

- [ ] **Step 5: Refactor the private host to a discriminated aggregate**

Preserve the empty enumerable handle and replace Plan A's classic-only aggregate with:

```ts
interface SessionDeliveryState {
  readonly nextPacketIndex: number;
  readonly deliveredCoreVersion: number;
  readonly deliveredSessionEventCount: number;
  readonly pendingPacket: Readonly<TurnPacket>;
}

interface InternalGameSessionAggregate {
  readonly driver: TournamentDriver;
  readonly humanSeatIndex: number;
  readonly authority: Readonly<GameSessionState>;
  readonly delivery: Readonly<SessionDeliveryState>;
}
```

Retain Plan A's module-private `activeSessionOperations: WeakSet<object>` as the only reentrancy guard; do not reintroduce a mutable `busy` field into the immutable aggregate.

When ability-lab first opens, call `createTournamentDriver()` then `prepareOpen()` and wrap `prepared.transitionBatches` into SessionEvents before publishing the handle: non-`PlayerActed` initialization events use `source:'automatic'`; any non-human `PlayerActed` reached before the first human pause uses `source:'npc'`; all use `commandIndex:null`. Reduce them in core order and verify the mirrored `pokerState` exactly equals `prepared.candidateAuthorityState`. Build/freeze the first packet, complete aggregate and `SessionStep` from that candidate, then use the same synchronous driver-commit plus WeakMap-set critical section as classic open. Never call `driver.getAuthorityState()` or publish a handle before this commit. If any pre-commit operation throws, discard the prepared lease and return no handle.

For later poker commands and hand acknowledgements, call `preparePausedAction()` or `prepareContinueAfterHand()` and consume `prepared.transitionBatches` without committing the driver. Convert every batch event, in order, to `CoreEventApplied` with its exact source/commandIndex and reduce it into a local candidate ability state. Build and validate the successor packet against `prepared.candidateAuthorityState` and `prepared.candidateBoundary`. Only after every fallible operation succeeds, call synchronous `commitPreparedTransition(prepared)` and immediately replace the WeakMap aggregate with the already-built candidate; there is no `await`, user callback, allocation-dependent projection or validation between those two synchronous assignments.

At every boundary kind, set the candidate delivery cursor to the full candidate `sessionEventLog.length`, never to the number of projected notices. Decision packets use `createAbilityDecisionPacket`; hand/game boundaries reuse the safe A summary/result payload but explicitly project the pending session slice into `privateEventsSinceLastPacket` (normally empty after core-only progress) and then advance the cursor. This rule applies equally when one accepted human action runs through NPC/automatic batches directly to a result boundary.

If a prepared poker intent has `rejection !== null`, synchronously discard it and return the unchanged pending packet. Wrap every accepted prepare path in `try/catch/finally`: any callback, SessionEvent reduction, projection, clone, freeze or validation failure before commit must call `discardPreparedTransition(prepared)` exactly once; a successful commit consumes the token and requires no discard. Add retry assertions proving the session WeakSet and driver lease are both released after every failure.

Milestone B must reject an unexpected `source:'ability-swap'` batch before commit; only Plan C is allowed to translate that source into `HoleCardSwapResolved`.

Classic continues to build delivery increments directly from the driver's core log and never creates a session log. Its Plan A implementation must use the same prepared transaction boundary; B must not reintroduce direct mutating `submitPausedAction()` or `continueAfterHand()` calls.

- [ ] **Step 6: Implement the ability decision packet projector**

Add:

```ts
export function createAbilityDecisionPacket(options: Readonly<{
  packetIndex: number;
  fromCoreVersion: number;
  fromSessionEventIndex: number;
  state: Readonly<AbilityLabSessionState>;
}>): Readonly<AbilityDecisionPacket>;
```

Slice the complete core log by core versions and project through `projectEventsForViewer()`. Separately scan `sessionEventLog[fromSessionEventIndex..length)` and call `projectPrivateAbilityNotice()`; advance the session cursor to the complete log length, not the number of notices returned. Clone the accumulated knowledge as a full snapshot. Recursively freeze a new object with no authority alias.

- [ ] **Step 7: Implement validation-first peek and atomic commit**

In `submitSessionCommand()`, validate in this order before creating RNG:

1. mode ability-lab;
2. current boundary is human decision and human is active/funded;
3. expected packet index;
4. decision key;
5. ability charge;
6. current-decision lock;
7. target safe integer, not human, physical, active/all-in, two hidden cards.

Create the path from the pre-command state and use one `nextFloat()` to select the slot. Build `OpponentCardPeeked`, reduce it into a candidate state, build the candidate packet and candidate delivery state, then replace the WeakMap aggregate once. Do not mutate arrays or decrement a charge before packet construction succeeds.

- [ ] **Step 8: Prove private projection and classic isolation GREEN**

In `tests/game/session-privacy.test.ts`, reuse fixed-deck double worlds from `tests/agents/hidden-information.test.ts` through pure session reducer/packet fixtures:

- same authorized peek card, different other target card, burn and future deck;
- compare only through the ability-result packet;
- spectator events, NPC observation and viewer-safe core increments are equal;
- player packet contains the authorized card but not the other card, deck, burn, runSeed or authority handId;
- mutating packet root, notices, card, ability panel, remaining map or knowledge throws `TypeError` and authority input stays unchanged.

Run:

```bash
npm test -- tests/game/turn-packet.test.ts tests/game/game-session.test.ts tests/game/game-session-abilities.test.ts tests/game/session-privacy.test.ts tests/agents/hidden-information.test.ts
npm run check
npm run build
git diff --check
```

- [ ] **Step 9: Commit Task 3**

```bash
git add src/game/game-session.ts src/game/turn-packet.ts tests/game/turn-packet.test.ts tests/game/game-session-abilities.test.ts tests/game/session-privacy.test.ts
git commit -m "feat: add deterministic private peek ability"
```

---

### Task 4: Add known-hand strength read without authority leakage

**Files:**

- Modify: `src/game/game-session.ts`
- Modify: `src/game/ability-strength.ts`
- Modify: `tests/game/game-session-abilities.test.ts`
- Modify: `tests/game/session-privacy.test.ts`
- Verify: `src/agents/equity.ts`

**Interfaces:**

- Consumes: Task 1 `estimateKnownHandEquity()`; Task 2 read constants/classifier and `OpponentStrengthRead`; Task 3 candidate ability commit path.
- Produces: successful `ability:'read'` through the unchanged `submitSessionCommand()` API.
- Produces: direct-import-only `buildKnownHandEquityInput(state, targetSeatIndex)`; it is not re-exported by `src/index.ts`.
- Security boundary: generation sees only target's two authority cards plus public board/live count; TurnPacket receives no target cards or audit.

```ts
export function buildKnownHandEquityInput(
  state: Readonly<TournamentState>,
  targetSeatIndex: number,
): Readonly<KnownHandEquityInput>;
```

- [ ] **Step 1: Write deterministic read and threshold integration RED tests**

Use fixed state fixtures on preflop/flop/turn/river. For each street, submit read and independently compute:

```ts
const random = createSeededRandom(
  seed,
  `ability/ability-lab-v1/${handNumber}/${decisionIndex}/${acceptedCommandIndex}/read`,
);
const livePlayerCount = state.seats.filter(
  (seat) => seat.status === 'active' || seat.status === 'all-in',
).length;
const estimate = estimateKnownHandEquity({
  holeCards: target.holeCards!,
  board: state.activeHand!.board,
  livePlayerCount,
}, READ_STRENGTH_SAMPLE_COUNT, random);
const band = classifyKnownHandStrength(estimate.equity, livePlayerCount);
```

Assert the authority SessionEvent contains the exact audit, while the packet notice is exactly:

```ts
{
  type: 'read',
  targetSeatIndex: target.seatIndex,
  street,
  band,
  algorithmVersion: 'known-hand-monte-carlo-v1',
}
```

and has no additional keys.

- [ ] **Step 2: Prove unknown opponents and future cards are not read**

Create two authority worlds with the same target cards/current board/live statuses but different other live players' real cards, burn cards and future deck. Call `buildKnownHandEquityInput(state, targetSeatIndex)` directly, then use each result through the same read path and assert identical input, audit, band and random consumption. Add throwing getters for `burnedCards`, future deck suffix and non-target holeCards; the helper must still succeed and must not read them. Assert it rejects a missing/folded/eliminated target, a target without exactly two canonical private cards, an invalid board, or a live-player count outside 2–6 with one fixed safe error. Assert the helper is absent from `src/index.ts`.

Create another pair with different target cards known to fall in the same band. Through the ability-result packet assert the human output is equal and contains neither hand, raw equity, sample counters, seed nor tie tuple.

- [ ] **Step 3: Write cross-ability and persistence RED cases**

Assert:

- read spends only read;
- repeated read later returns `ability-spent`;
- peek then read at the same decision returns `ability-already-used-this-decision`;
- after the required poker action and a later human decision, the still-unused other information ability succeeds;
- an illegal poker action after successful read does not refund read or clear the current decision lock;
- after `HandCompleted`, both peek/read knowledge disappear while their zero charges remain zero.

- [ ] **Step 4: Run read RED**

```bash
npm test -- tests/game/game-session-abilities.test.ts tests/game/session-privacy.test.ts tests/game/ability-strength.test.ts tests/agents/equity.test.ts
```

Expected: peek tests pass; read success cases fail because GameSession has no read resolver.

- [ ] **Step 5: Implement read using a narrow known-hand input**

Implement `buildKnownHandEquityInput()` in `ability-strength.ts`. It validates the target and copies only the target's two cards, current public board and count of `active`/`all-in` seats. Use dense numeric loops, own-index checks and `cloneCanonicalCard()`; do not invoke authority-owned `map/filter/iterator` methods and do not inspect deck, burns or non-target hole cards:

```ts
const input: KnownHandEquityInput = {
  holeCards: [
    cloneCanonicalCard(target.holeCards[0]),
    cloneCanonicalCard(target.holeCards[1]),
  ],
  board: clonePublicBoard(hand.board),
  livePlayerCount: countLiveSeats(state.seats),
};
```

After the same common validation used by peek, GameSession calls only this helper to build the estimator input. Create a fresh ability RNG at the exact read path, run exactly 1,000 samples, classify, then build one `OpponentStrengthRead` with the audit. Reduce candidate state, build candidate packet and commit through the same all-or-nothing helper as peek. Do not duplicate the authority-read logic in `game-session.ts`, manufacture a `PlayerObservationV1` for the target or call `projectObservation()` with a non-actor.

- [ ] **Step 6: Run focused GREEN and Agent RNG equivalence**

Add a probe Participant that records `observation` and `random.seedHash`. Run three same-seed sessions with identical poker actions: no ability, peek, read. Assert every NPC record and every core event are equal.

```bash
npm test -- tests/game/game-session-abilities.test.ts tests/game/session-privacy.test.ts tests/game/ability-strength.test.ts tests/agents/equity.test.ts tests/game/classic-controller-golden.test.ts
npm run check
npm run build
git diff --check
```

- [ ] **Step 7: Commit Task 4**

```bash
git add src/game/game-session.ts src/game/ability-strength.ts tests/game/game-session-abilities.test.ts tests/game/session-privacy.test.ts
git commit -m "feat: add private opponent strength reads"
```

---

### Task 5: Add capability-gated private session replay

**Files:**

- Create: `src/game/session-replay.ts`
- Create: `src/game/session-authority.ts`
- Modify: `src/game/game-session.ts`
- Create: `tests/game/session-replay.test.ts`
- Create: `tests/game/session-export-surface.test.ts`
- Verify: `src/index.ts`

**Interfaces:**

- Consumes: Task 2 `SessionEvent`/reducer; Task 3 packet builders and internal ability state; Plan A packet boundary semantics.
- Produces: `SessionReplayEnvelopeV1`、`SessionReplayResult`、`replaySession()`、direct-import-only `openAuthoritativeGameSession()`、`SessionAuthorityCapability`、`exportSessionReplay()`。
- Root and CLI must not export/import any authority interface or `SessionReplayEnvelopeV1` value producer.

- [ ] **Step 1: Write exact envelope and prefix RED tests**

Define in `src/game/session-replay.ts`:

```ts
export interface SessionReplayEnvelopeV1 {
  readonly containsPrivateData: true;
  readonly schemaVersion: 1;
  readonly mode: 'ability-lab';
  readonly rulesVersion: 'holdem-v1';
  readonly rngVersion: 'mulberry32-v1';
  readonly shuffleVersion: 'fisher-yates-v1';
  readonly strategyVersion: 'parametric-v1';
  readonly abilityRulesVersion: 'ability-lab-v1';
  readonly readStrengthAlgorithmVersion: 'known-hand-monte-carlo-v1';
  readonly initialConfig: TournamentConfig;
  readonly seats: readonly TournamentSeatInput[];
  readonly runSeed: string;
  readonly humanSeatIndex: number;
  readonly events: readonly SessionEvent[];
}

export interface SessionReplayResult {
  readonly state: Readonly<AbilityLabSessionState>;
  readonly packets: readonly Readonly<TurnPacket>[];
}

export class SessionReplayVersionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SessionReplayVersionError';
  }
}

export class SessionReplayValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SessionReplayValidationError';
  }
}

export function replaySession(
  envelope: Readonly<SessionReplayEnvelopeV1>,
): Readonly<SessionReplayResult>;
```

Capture a live session containing peek, a legal human action, NPC actions, a later read and `HandCompleted`. For every event prefix ending at a valid packet boundary, assert `replaySession({...envelope, events: prefix})` reproduces the captured state and packet transcript through that boundary. For the full envelope assert all packet indexes and core ranges exactly equal live delivery.

- [ ] **Step 2: Write tamper and ambient-source RED tests**

Individually mutate:

- every header version and mode;
- config/seats/runSeed/human seat versus embedded GameStarted;
- sessionEventIndex, embedded eventIndex and commandIndex;
- CoreEventApplied source combination;
- peek target, slot or card;
- read live count, sample count, tuple, units, equity, band or algorithm version.

Each must throw `SessionReplayVersionError` for unsupported versions or `SessionReplayValidationError` for authority/header/event failures. Spy on `Math.random`, `Date.now` and `estimateKnownHandEquity`; all throw if called, while replay still succeeds.

- [ ] **Step 3: Write capability and export-surface RED tests**

In `src/game/session-authority.ts` define all authority-facing entry points:

```ts
declare const sessionAuthorityBrand: unique symbol;
export interface SessionAuthorityCapability {
  readonly [sessionAuthorityBrand]: true;
}

export function exportSessionReplay(
  capability: SessionAuthorityCapability,
): Readonly<SessionReplayEnvelopeV1>;

export function openAuthoritativeGameSession(
  options: Readonly<OpenGameSessionOptions & { mode: 'ability-lab' }>,
): Promise<Readonly<{
  step: SessionStep;
  capability: SessionAuthorityCapability;
}>>;
```

Assert ordinary `openGameSession()` returns no capability; fabricated objects and a normal handle are rejected by `exportSessionReplay`; an issued capability exports a recursively frozen, non-aliased envelope whose event log matches the live ability state.

`src/game/game-session.ts` may expose only this non-root, `@internal` host seam for the authority module; it must not import `session-authority.ts` or `session-replay.ts` at runtime:

```ts
export interface AuthoritySessionSnapshot {
  readonly initialConfig: TournamentConfig;
  readonly seats: readonly TournamentSeatInput[];
  readonly runSeed: string;
  readonly humanSeatIndex: number;
  readonly state: Readonly<AbilityLabSessionState>;
}

export function openGameSessionForAuthority(
  options: Readonly<OpenGameSessionOptions & { mode: 'ability-lab' }>,
): Promise<Readonly<{
  step: SessionStep;
  readSnapshot: () => Readonly<AuthoritySessionSnapshot>;
}>>;
```

The ordinary root-exported `openGameSession()` calls the same private host path but never returns `readSnapshot`. Neither `AuthoritySessionSnapshot` nor `openGameSessionForAuthority` is root-exported.

Read `src/index.ts` and CLI source as text and walk runtime imports starting at `src/index.ts`, `src/cli/index.ts` and the safe `src/game/game-session.ts`; assert that safe reachable graph contains neither authority module. Also assert the root/CLI text contains none of:

```ts
[
  'openAuthoritativeGameSession',
  'openGameSessionForAuthority',
  'AuthoritySessionSnapshot',
  'SessionAuthorityCapability',
  'exportSessionReplay',
  "./game/session-authority.js",
  "./game/session-replay.js",
]
```

- [ ] **Step 4: Run missing-module RED**

```bash
npm test -- tests/game/session-replay.test.ts tests/game/session-export-surface.test.ts
```

Expected: FAIL because replay and authority modules do not exist.

- [ ] **Step 5: Implement deterministic replay and transcript regeneration**

Validate the header before reduction using `validateTournamentInputs()`. Require exactly one embedded GameStarted, compare its config/seats/runSeed and four core versions with the envelope, then reduce every event with `reduceSessionEvent()`.

Unsupported schema/rules/RNG/shuffle/strategy/ability/read-algorithm versions throw `SessionReplayVersionError` with fixed messages. Every malformed header, index, event, embedded authority mismatch or transcript inconsistency throws `SessionReplayValidationError` with a fixed message and never serializes the envelope or nested payload.

Regenerate packets rather than storing them:

```ts
for (const event of envelope.events) {
  state = reduceSessionEvent(state, event, envelope.humanSeatIndex);
  if (event.type === 'OpponentCardPeeked' || event.type === 'OpponentStrengthRead') {
    emitDecisionPacket();
  } else if (event.type === 'CoreEventApplied') {
    const phase = state.pokerState.activeHand?.phase;
    if (phase === 'hand-complete') emitHandResultPacket();
    else if (phase === 'game-complete') emitGameResultPacket();
    else if (state.pokerState.activeHand?.currentActorSeat === envelope.humanSeatIndex) {
      emitDecisionPacket();
    }
  }
}
```

Use the same half-open core/session cursors and packet builders as live delivery. Do not emit a second decision for consecutive events at the same boundary: before emitting, compare the prospective boundary with the last packet's core right edge, session right edge and decision key.

- [ ] **Step 6: Implement WeakMap capability providers**

In `src/game/session-authority.ts`, keep:

```ts
type ReplayProvider = () => Readonly<SessionReplayEnvelopeV1>;
const providers = new WeakMap<object, ReplayProvider>();
```

`openAuthoritativeGameSession()` lives in `session-authority.ts`. It calls `openGameSessionForAuthority()`, creates a frozen empty capability locally, and registers a provider that calls `readSnapshot()` and constructs the current envelope on demand. The capability is bound to the session host/handle, not the immutable aggregate that happened to exist at open; `readSnapshot()` must dynamically resolve the current WeakMap aggregate on every export. No capability-issuer function is exported: arbitrary callers cannot register their own provider. The capability has no enumerable fields and contains no state property. `exportSessionReplay()` validates WeakMap membership, calls the provider, structured-clones, recursively freezes and returns the clone.

The safe dependency direction is one-way: `session-authority.ts -> game-session.ts`; `game-session.ts` has no runtime import of `session-authority.ts` or `session-replay.ts`. `openGameSessionForAuthority()` and its snapshot closure are direct-import internals used only by the authority host and tests, absent from `src/index.ts` and the CLI bundle entry.

- [ ] **Step 7: Run replay, privacy and full static GREEN**

```bash
npm test -- tests/game/session-replay.test.ts tests/game/session-export-surface.test.ts tests/game/session-events.test.ts tests/game/session-privacy.test.ts tests/core/replay.test.ts
npm run check
npm run build
git diff --check
```

- [ ] **Step 8: Commit Task 5**

```bash
git add src/game/session-replay.ts src/game/session-authority.ts src/game/game-session.ts tests/game/session-replay.test.ts tests/game/session-export-surface.test.ts
git commit -m "feat: add capability gated ability replay"
```

---

### Task 6: Wire ability-lab into the terminal and prove milestone B isolation

**Files:**

- Modify: `src/cli/options.ts`
- Modify: `src/cli/turn-renderer.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/options.test.ts`
- Modify: `tests/cli/turn-command.test.ts`
- Modify: `tests/cli/turn-renderer.test.ts`
- Modify: `tests/cli/main.test.ts`
- Create: `tests/integration/ability-lab-session.test.ts`
- Modify: `src/index.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: safe public session API, `AbilityPanel`, private notices and Plan A packet loop/semantic pacing.
- Produces: CLI `--mode classic|ability-lab`、`promptForGameMode()`、safe ability rendering and an automated milestone B gate.
- Does not expose: session authority state, replay capability, raw SessionEvent, read audit or runSeed beyond the existing intentional opening seed line.

- [ ] **Step 1: Write mode parser and prompt RED tests**

Change the safe CLI type to:

```ts
export interface ParsedCliOptions {
  readonly seed: string;
  readonly playerCount: number | null;
  readonly mode: 'classic' | 'ability-lab' | null;
}

export function promptForGameMode(
  io: Readonly<PromptIO>,
): Promise<'classic' | 'ability-lab'>;
```

Assert:

```ts
expect(parseCliOptions(['--mode', 'classic'], seed)).toEqual({
  seed: 'generated-seed', playerCount: null, mode: 'classic',
});
expect(parseCliOptions(['--mode', 'ability-lab'], seed)).toEqual({
  seed: 'generated-seed', playerCount: null, mode: 'ability-lab',
});
```

Reject missing, duplicate, uppercase and unknown mode before seed generation. Prompt exact text `请选择模式（1 经典模式 / 2 能力实验，直接回车默认 1）：`; accept empty/`1` as classic, `2` as ability-lab, and reprompt all other input with `模式无效，请输入 1 或 2。`.

- [ ] **Step 2: Write renderer and packet-loop RED cases**

For a peek-result decision packet, assert the renderer includes:

```text
能力结果：你偷看到座位 2 的一张底牌是 K♣。
本手情报：座位 2｜翻牌前｜K♣
剩余能力：偷看 0｜读牌 1｜换牌 1
本决策已使用能力，请完成扑克行动。
```

For read, assert it includes only `座位 2｜翻牌｜牌力：中等` and never includes `equity`、`samples`、`tieSplitCounts`、真实目标手牌或 seed。

Extend rejection rendering with fixed Chinese messages for every `AbilityRejectionCode`; messages must be selected by code and never interpolate the raw command or authority data.

In `tests/cli/main.test.ts`, stub open → decision → successful ability-result decision with same decisionKey → successful poker action → result. Assert the CLI prompts twice and does not call `continueAfterHandResult` between the two decision packets.

- [ ] **Step 3: Write the real-session milestone RED**

Create `tests/integration/ability-lab-session.test.ts` with two deterministic tables:

- 2 players: use peek at the first human decision, then passive poker actions;
- 4 players: use read at the first human decision, then passive poker actions.

Drive each session until game-result with a 20,000-command guard. Assert contiguous packet indexes/core ranges, exactly one successful requested ability, hand-result acknowledgement, chip conservation and one champion.

Run paired classic/ability sessions with the same poker actions and instrumented NPCs. Assert peek/read sessions have the same complete core event log and identical NPC observation/RNG seedHash sequence as their no-ability controls. Export through the direct authority test entry, replay, and compare the full packet transcript.

- [ ] **Step 4: Run CLI/integration RED**

```bash
npm test -- tests/cli/options.test.ts tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/cli/main.test.ts tests/integration/ability-lab-session.test.ts
```

Expected: the existing `turn-command` characterization for `u peek/read/swap` remains green because Plan A already parses those commands. New mode-option, renderer, main-loop and real-session cases fail; existing classic CLI cases remain green.

- [ ] **Step 5: Implement mode selection and safe rendering**

Parse `--mode` alongside `--seed/--players` with the same duplicate/missing-value discipline. In `main()`, resolve player count and mode before opening the session, then pass the selected mode without adding an authority callback.

The existing `parseTurnCommand()` already parses `u peek/read/swap`; do not execute abilities in the parser. Render `privateEventsSinceLastPacket` as one-time result lines and `abilities.knowledge` as the complete current snapshot. On hand/game packets clear the displayed side panel by rendering no cached client state.

- [ ] **Step 6: Restrict root exports explicitly**

Keep Plan A safe session exports and add only safe/pure symbols:

```ts
export type {
  AbilityId,
  AbilityRejectionCode,
  PrivateAbilityNotice,
  PrivateKnowledgeEntry,
  StrengthBand,
} from './game/session-types.js';
export type {
  AbilityCommandView,
  AbilityPanel,
} from './game/turn-packet.js';
export {
  READ_STRENGTH_ALGORITHM_VERSION,
  READ_STRENGTH_SAMPLE_COUNT,
  classifyKnownHandStrength,
} from './game/ability-strength.js';
```

Do not export `AbilityLabSessionState`、`SessionEvent`、`SessionReplayEnvelopeV1`、`replaySession`、`openGameSessionForAuthority`、`AuthoritySessionSnapshot`、`openAuthoritativeGameSession`、`SessionAuthorityCapability` or `exportSessionReplay`.

- [ ] **Step 7: Update current-source documentation**

In `README.md`, add exact examples:

```bash
npm run play -- --players 4 --mode classic --seed demo-classic
npm run play -- --players 4 --mode ability-lab --seed demo-abilities
```

Document only currently implemented peek/read, each once per tournament and one ability per poker decision. State that swap is reserved for the next milestone and is not yet executable; do not claim all three abilities or a new GitHub release are complete.

- [ ] **Step 8: Run the complete milestone B gate**

```bash
npm test -- tests/agents/equity.test.ts tests/game/ability-strength.test.ts tests/game/session-events.test.ts tests/game/game-session.test.ts tests/game/game-session-abilities.test.ts tests/game/turn-packet.test.ts tests/game/session-privacy.test.ts tests/game/session-replay.test.ts tests/game/session-export-surface.test.ts tests/cli/options.test.ts tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/cli/main.test.ts tests/integration/ability-lab-session.test.ts tests/game/classic-controller-golden.test.ts tests/integration/classic-turn-session.test.ts
npm test
npm run check
npm run build
git diff --check
```

Expected: all tests pass; classic hashes and full legacy suite are unchanged; no forbidden core file appears in `git diff --name-only`.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/cli/options.ts src/cli/turn-renderer.ts src/cli/index.ts src/index.ts README.md tests/cli/options.test.ts tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/cli/main.test.ts tests/integration/ability-lab-session.test.ts
git commit -m "feat: expose private information ability mode"
```

---

## Milestone B Completion Gate

Do not start plan C until all are true:

1. Plan A completion gate remains green, including classic state/event hashes and the written classic playtest result.
2. `estimateEquity()` retains its old five-field shape, fixed results and RNG consumption; known-hand audit uses exact 60-unit split accounting.
3. Peek/read each succeed once, never replace a poker action, and all invalid uses leave core/session/delivery/RNG unchanged.
4. Same-action no-ability/peek/read sessions have identical core event logs and NPC observation/RNG sequences.
5. TurnPacket/private knowledge expose only authorized fields, are recursively frozen/non-aliased and clear on `HandCompleted`.
6. Every SessionEvent prefix reconstructs the exact ability state; replay regenerates the live packet transcript without Monte Carlo, ambient RNG or time.
7. A normal GameSessionHandle cannot export the private envelope, and root/CLI source contains no authority replay dependency.
8. Full tests, type-check, build and whitespace checks pass, and no forbidden core/observation/public-event file changed.
9. B's staged swap command remains unavailable and pure; Plan C may now add `HoleCardSwapResolved` and the sole core `HoleCardReplaced` transition through the existing session reducer/capability boundary.
