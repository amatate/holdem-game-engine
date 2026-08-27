# TypeScript 德州扑克底层引擎 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个零运行时依赖、支持 2–6 人、可确定性回放的 TypeScript 无限注德州扑克引擎，并让玩家能在终端与三名不同牌风 AI 完成单桌淘汰赛。

**Architecture:** 使用纯规则核心维护权威状态并通过领域事件变更；控制器只编排参与者，AI 仅消费白名单观察对象，CLI 仅展示与收集输入。发牌、AI 和 equity 采样使用互相隔离的确定性随机流，所有下注、边池、摊牌与淘汰均由核心处理。

**Tech Stack:** Node.js 22+（本机 26.7.0）、npm 11、TypeScript 7.0.2、Vitest 4.1.11、tsx 4.23.12、@types/node 22.19.21；ESM；正式运行零第三方依赖。Task 2 增加固定版本的测试 oracle devDependency。

**Spec:** `docs/superpowers/specs/2026-08-27-texas-holdem-engine-design.md`

## Global Constraints

- 开始每个任务前先读取本计划与规格中对应章节；不得修改 `AGENTS.md` 或任何未来出现的 `sources/` 内容。
- 生产包必须保持零 runtime dependencies；TypeScript、Vitest、tsx 和 Node 类型仅为 devDependencies。
- 所有筹码为非负安全整数；加注统一使用本街累计目标 `raiseTo`，不接受“额外加多少”的歧义语义。
- 规则核心支持 2–6 个固定物理座位、dead button、HU 特例、短码盲注、short all-in reopen、退款、任意层边池、平分和奇数筹码。
- V1 不加入角色能力、作弊、联网、图形界面、GTO、长期记忆、真钱或肉鸽升级。
- 发牌、角色决策、equity 与下注尺寸随机流必须隔离；核心与 AI 禁止直接调用 `Math.random()` 和 `Date.now()`。
- 每次状态转换产生领域事件；被拒绝的行动不改变状态、事件数量或版本。
- 每个任务严格执行 red → green → refactor；失败测试必须先运行并确认失败原因，再写实现。
- 每个任务结束时运行该任务列出的完整验证命令，仅提交该任务范围内文件。

---

## File Map

### Project and exports

- `package.json`: ESM 包配置、脚本、Node 版本和 devDependencies。
- `package-lock.json`: 精确锁定开发工具版本。
- `tsconfig.json`: 严格类型检查基线。
- `tsconfig.build.json`: 生成 `dist/` 与声明文件。
- `tsconfig.browser.json`: 无 Node 全局类型的浏览器入口传递类型检查。
- `vitest.config.ts`: Node 测试环境和测试目录。
- `src/index.ts`: Node 与通用公共 API。
- `src/browser.ts`: 不导出 CLI 或 Node 专属模块的浏览器 API。

### Rules core

- `src/core/types.ts`: Card、chips、seat、phase、state 与公共基础类型。
- `src/core/versions.ts`: 事件、规则、随机数、洗牌与策略版本常量。
- `src/core/random.ts`: 版本化 seed hash、Mulberry32 V1 与可 fork 随机源。
- `src/core/cards.ts`: 标准牌组、解析、校验与洗牌。
- `src/core/hand-evaluator.ts`: 五张牌评价、七选五与排名比较。
- `src/core/config.ts`: 比赛配置验证与默认盲注等级。
- `src/core/events.ts`: 领域事件联合类型和事件 reducer 入口。
- `src/core/public-events.ts`: 面向指定观看座位的公开事件白名单投影。
- `src/core/state.ts`: TournamentState、HandState、SeatState 与初始化。
- `src/core/positions.ts`: 初始位置、dead button、盲注与 HU 转换。
- `src/core/legal-actions.ts`: 精确合法动作与 raise-to 边界。
- `src/core/reducer.ts`: 行动验证、规范化与下注状态转换。
- `src/core/dealing.ts`: 烧牌、3/1/1 发牌和自动阶段推进。
- `src/core/pots.ts`: 贡献分层、未跟注退款与 eligible 集合。
- `src/core/settlement.ts`: fold/showdown 结算、派彩、奇数筹码与淘汰。
- `src/core/replay.ts`: 事件重放和版本校验。
- `src/core/invariants.ts`: 筹码、牌、行动者、底池和终止不变量。
- `src/core/simulation.ts`: 随机合法行动和规则随机测试驱动器。

### Agents

- `src/agents/types.ts`: PlayerObservationV1、DecisionContext、PokerAgent 与 StyleProfile。
- `src/agents/observation.ts`: 白名单观察投影与深冻结。
- `src/agents/equity.ts`: 只基于已知牌的确定性蒙特卡洛 equity。
- `src/agents/parametric-agent.ts`: 参数化可解释决策策略。
- `src/agents/characters.ts`: 岩石、猎手、疯狗、跟注站配置。

### Game and CLI

- `src/game/participant.ts`: Human、agent 与 scripted participant 统一接口。
- `src/game/tournament-controller.ts`: 编排单手、下一手、比赛结束和回放保存。
- `src/cli/index.ts`: `npm run play` 入口与参数解析。
- `src/cli/renderer.ts`: 中文牌桌与行动渲染。
- `src/cli/prompts.ts`: Node readline 合法输入循环。
- `scripts/simulate.ts`: 固定 seed 的纯 AI 比赛。
- `scripts/stress.ts`: 可选 10,000 手牌压力测试。
- `README.md`: 安装、测试、模拟、游玩和边界声明。

---

### Task 1: Project scaffold, deterministic RNG, and cards

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/core/types.ts`
- Create: `src/core/versions.ts`
- Create: `src/core/random.ts`
- Create: `src/core/cards.ts`
- Create: `src/index.ts`
- Test: `tests/core/random.test.ts`
- Test: `tests/core/cards.test.ts`

**Interfaces:**
- Produces: `CardCode`, `Card`, `Suit`, `Rank`, `RandomSource`, version constants, `createSeededRandom(seed, path?)`, `createStandardDeck()`, `parseCard(code)`, `shuffleDeck(deck, rng)`.
- Consumes: no project code.

- [ ] **Step 1: Create the package and compiler configuration**

Use this exact `package.json` shape; `npm install` will write the lock file:

```json
{
  "name": "holdem-game-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "play": "tsx src/cli/index.ts",
    "simulate": "tsx scripts/simulate.ts",
    "test:stress": "tsx scripts/stress.ts"
  },
  "devDependencies": {
    "@types/node": "22.19.21",
    "tsx": "4.23.12",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

`tsconfig.json` must enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2023"`, and include `src`, `tests`, and `scripts`. `tsconfig.build.json` extends it, excludes tests/scripts, emits declarations and source maps to `dist`. Add `node_modules/`, `dist/`, `coverage/`, and `*.log` to `.gitignore`.

- [ ] **Step 2: Install the exact development tools**

Run: `npm install`

Expected: `package-lock.json` is created; `npm ls --depth=0` lists TypeScript 7.0.2, Vitest 4.1.11, tsx 4.23.12, and @types/node 22.19.21 with no errors. Pinning Node 22 types prevents code compiled on the local Node 26 runtime from silently depending on Node 26-only APIs.

- [ ] **Step 3: Write failing RNG and deck tests**

```ts
import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../../src/core/random.js';
import { createStandardDeck, parseCard, shuffleDeck } from '../../src/core/cards.js';

describe('deterministic primitives', () => {
  it('repeats the same stream for the same seed and path', () => {
    const a = createSeededRandom('run-1', 'deck/1');
    const b = createSeededRandom('run-1', 'deck/1');
    expect([a.nextUint32(), a.nextUint32()]).toEqual([
      b.nextUint32(),
      b.nextUint32(),
    ]);
  });

  it('locks the versioned hash and Mulberry32 golden vector', () => {
    const rng = createSeededRandom('run-1', 'deck/1');
    expect(rng.seedHash).toBe(4_120_237_477);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()])
      .toEqual([2_338_597_589, 3_202_163_317, 1_263_586_442]);
  });

  it('fork consumption cannot perturb the parent stream', () => {
    const a = createSeededRandom('run-1');
    const b = createSeededRandom('run-1');
    a.fork('agent').nextUint32();
    expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('creates 52 unique cards and shuffles reproducibly', () => {
    const deck = createStandardDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => card.code)).size).toBe(52);
    expect(shuffleDeck(deck, createSeededRandom('same')).map((card) => card.code))
      .toEqual(shuffleDeck(deck, createSeededRandom('same')).map((card) => card.code));
  });

  it('parses valid cards and rejects invalid card text', () => {
    expect(parseCard('As')).toEqual({ code: 'As', rank: 14, suit: 's' });
    expect(() => parseCard('1x')).toThrow(/invalid card/i);
  });
});
```

- [ ] **Step 4: Run the tests and confirm the imports fail**

Run: `npm test -- tests/core/random.test.ts tests/core/cards.test.ts`

Expected: FAIL because `src/core/random.ts` and `src/core/cards.ts` do not exist.

- [ ] **Step 5: Implement deterministic primitives**

Use these public types and algorithms:

```ts
export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type CardCode = `${'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A'}${Suit}`;
export interface Card { readonly code: CardCode; readonly rank: Rank; readonly suit: Suit }

export interface RandomSource {
  readonly algorithm: 'mulberry32-v1';
  readonly seedHash: number;
  nextUint32(): number;
  nextFloat(): number;
  fork(label: string): RandomSource;
}
```

Implement FNV-1a 32-bit hashing over `${seed}\u0000${path}` and Mulberry32 with unsigned arithmetic. A fork derives a new path from immutable seed/path data and must not consume the parent. `shuffleDeck` returns a copied Fisher–Yates shuffle. `parseCard` maps T/J/Q/K/A to 10/11/12/13/14 and rejects invalid codes. `createStandardDeck` iterates ranks 2 through A and suits c/d/h/s exactly once.

Hash the UTF-8 bytes, not UTF-16 code units, and expose the derived unsigned `seedHash` for audit/replay diagnostics. Add assertions that shuffling never mutates its input and two distinct fixed seeds produce distinct orders. Duplicate-card rejection is tested at the Task 2 evaluator boundary and Task 3 fixed-deck boundary rather than claimed by `parseCard`.

Export immutable literal constants `EVENT_SCHEMA_VERSION = 1`, `RULES_VERSION = 'holdem-v1'`, `RNG_ALGORITHM_VERSION = 'mulberry32-v1'`, `SHUFFLE_ALGORITHM_VERSION = 'fisher-yates-v1'`, and `STRATEGY_VERSION = 'parametric-v1'`. Tests assert their exact values because replay compatibility depends on them.

- [ ] **Step 6: Run task verification**

Run: `npm test -- tests/core/random.test.ts tests/core/cards.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: exit 0 with no TypeScript diagnostics.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts .gitignore src/core/types.ts src/core/versions.ts src/core/random.ts src/core/cards.ts src/index.ts tests/core/random.test.ts tests/core/cards.test.ts
git commit -m "chore: scaffold deterministic TypeScript core"
```

---

### Task 2: Auditable five-card and seven-card hand evaluator

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/core/hand-evaluator.ts`
- Modify: `src/index.ts`
- Test: `tests/core/hand-evaluator.test.ts`
- Test: `tests/core/hand-evaluator-oracle.test.ts`
- Test: `tests/fixtures/hand-ranks.ts`

**Interfaces:**
- Consumes: `Card`, `CardCode`, `parseCard` from Task 1.
- Produces: `HandCategory`, `HandRank`, `evaluateFive(cards)`, `evaluateBest(cards)`, `compareHandRanks(a, b)`.

- [ ] **Step 1: Install the pinned independent test oracle and write failing tests**

Run: `npm install --save-dev --save-exact pokersolver@2.1.4`

Expected: it appears only under `devDependencies`. Record `pokersolver` 2.1.4, its MIT license and upstream `https://github.com/goldfire/pokersolver` in the oracle test header; no source is copied into the engine.

Create fixtures for these exact vectors, ordered from category value then kickers:

```ts
export const HAND_CASES = [
  { cards: ['As','Ks','Qs','Js','Ts'], vector: [8,14], category: 'straight-flush' },
  { cards: ['9s','8s','7s','6s','5s'], vector: [8,9], category: 'straight-flush' },
  { cards: ['Ah','Ad','Ac','As','Kd'], vector: [7,14,13], category: 'four-of-a-kind' },
  { cards: ['Kh','Kd','Kc','2s','2d'], vector: [6,13,2], category: 'full-house' },
  { cards: ['Ah','Jh','8h','4h','2h'], vector: [5,14,11,8,4,2], category: 'flush' },
  { cards: ['As','2d','3h','4c','5s'], vector: [4,5], category: 'straight' },
  { cards: ['Qh','Qd','Qc','9s','2d'], vector: [3,12,9,2], category: 'three-of-a-kind' },
  { cards: ['Jh','Jd','4c','4s','Ad'], vector: [2,11,4,14], category: 'two-pair' },
  { cards: ['Th','Td','As','7c','3d'], vector: [1,10,14,7,3], category: 'one-pair' },
  { cards: ['As','Jd','8c','5s','2d'], vector: [0,14,11,8,5,2], category: 'high-card' }
] as const;
```

Add tests that `evaluateBest` selects the best five from seven, that a board royal flush ties all players, and that two equal ranks compare as zero regardless of suit.

In `hand-evaluator-oracle.test.ts`, load `pokersolver` through `node:createRequire` behind a small locally typed adapter. Build at least 128 fixed, evaluator-independent seven-card inputs covering every category, A2345, board plays, all kicker layers and ties. Compare our category plus pairwise ordering/tie result against `Hand.solve`/`Hand.winners`; the oracle must never call our evaluator to generate its expected result. Include repeated-card rejection in both five- and seven-card APIs.

- [ ] **Step 2: Run the evaluator test and confirm failure**

Run: `npm test -- tests/core/hand-evaluator.test.ts tests/core/hand-evaluator-oracle.test.ts`

Expected: FAIL because `hand-evaluator.ts` does not exist.

- [ ] **Step 3: Implement the evaluator with an explicit rank vector**

Use these exact public shapes:

```ts
export type HandCategory =
  | 'high-card' | 'one-pair' | 'two-pair' | 'three-of-a-kind'
  | 'straight' | 'flush' | 'full-house' | 'four-of-a-kind'
  | 'straight-flush';

export interface HandRank {
  readonly category: HandCategory;
  readonly vector: readonly number[];
  readonly bestFive: readonly [Card, Card, Card, Card, Card];
}

export function evaluateFive(cards: readonly Card[]): HandRank;
export function evaluateBest(cards: readonly Card[]): HandRank;
export function compareHandRanks(left: HandRank, right: HandRank): -1 | 0 | 1;
```

Implementation rules:

1. `evaluateFive` requires exactly five distinct cards.
2. Build rank counts sorted by count descending then rank descending.
3. Detect flush by one unique suit.
4. Detect straight using unique descending ranks and the special sequence `[14,5,4,3,2]`, whose high card is 5.
5. Return the fixture vectors exactly; do not include suits in vectors.
6. `evaluateBest` accepts 5–7 distinct cards and recursively enumerates every five-card index combination without permutation duplication.
7. Compare vectors lexicographically and then keep the first stable best-five combination for equal vectors.

- [ ] **Step 4: Run focused and full primitive tests**

Run: `npm test -- tests/core/hand-evaluator.test.ts tests/core/hand-evaluator-oracle.test.ts tests/core/cards.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/core/hand-evaluator.ts src/index.ts tests/core/hand-evaluator.test.ts tests/core/hand-evaluator-oracle.test.ts tests/fixtures/hand-ranks.ts
git commit -m "feat: add auditable holdem hand evaluator"
```

---

### Task 3: Tournament state, events, positions, blinds, and hole cards

**Files:**
- Create: `src/core/config.ts`
- Create: `src/core/events.ts`
- Create: `src/core/state.ts`
- Create: `src/core/positions.ts`
- Modify: `src/index.ts`
- Test: `tests/core/config.test.ts`
- Test: `tests/core/positions.test.ts`
- Test: `tests/core/start-hand.test.ts`

**Interfaces:**
- Consumes: cards and RNG from Task 1.
- Produces: `TournamentConfig`, `TournamentSeatInput`, `TournamentState`, `HandState`, `SeatState`, `DomainEvent`, `TransitionResult`, `createTournament`, `startHand`, `assignInitialPositions`, `advancePositions`.

- [ ] **Step 1: Define exact domain contracts in failing tests**

Tests must construct this configuration and assert the first hand positions/events:

```ts
const config: TournamentConfig = {
  maxSeats: 4,
  startingStack: 100,
  handsPerLevel: 8,
  blindLevels: [
    { smallBlind: 1, bigBlind: 2 },
    { smallBlind: 2, bigBlind: 4 },
    { smallBlind: 3, bigBlind: 6 },
    { smallBlind: 5, bigBlind: 10 },
    { smallBlind: 10, bigBlind: 20 },
    { smallBlind: 20, bigBlind: 40 },
    { smallBlind: 40, bigBlind: 80 },
    { smallBlind: 80, bigBlind: 160 }
  ],
  initialButtonSeat: 0
};
```

Register exactly one unique player in every physical seat `0..maxSeats-1`; V1 has no initially empty or sit-out seat. Assert for four live seats: button 0, SB 1, BB 2, first preflop actor 3, eight cards dealt in order from seat 1. Add HU assertions: button/SB 0, BB 1, first card to seat 1, preflop actor 0. Position advancement branches first on the next hand's survivor count. If exactly two remain after any 3–6-player hand, the first survivor clockwise from the previous BB physical position becomes the new BB and the other becomes button/SB; dead-button logic is not consulted. Lock the three-to-two matrix for prior A=button/B=SB/C=BB: eliminating A gives C button/SB and B BB; eliminating B gives C button/SB and A BB; eliminating C gives B button/SB and A BB. Add 4→2 with former SB+BB both eliminated plus representative 5→2 and 6→2 survivor pairs, asserting there is always exactly one button/SB and one BB.

Only when the next hand still has at least three survivors, lock dead-button outputs separately: if former SB is eliminated, the new button is that empty SB seat, former BB posts SB and the next live seat posts BB; if former BB is eliminated, the button moves to former SB, `smallBlindSeat=null` and the next live seat left of the eliminated BB posts BB; if former SB and BB both leave, button is former SB's empty seat, `smallBlindSeat=null`, and the next live seat posts BB, with a subsequent hand allowed to move the button across the former BB empty seat. Verify no surviving player skips the owed BB through consecutive empty seats.

Configuration tests reject `maxSeats` outside 2–6, participant count not equal to `maxSeats`, duplicate `playerId` or `seatIndex`, non-contiguous/out-of-range seats, invalid initial button, non-safe/non-positive stack or `handsPerLevel`, an empty `blindLevels`, blind values that are not safe integers with `0 < SB < BB`, and a fixed deck that is not exactly 52 unique valid cards. Require `Number.isSafeInteger(startingStack * maxSeats)` so the ledger total is exact; for every supported `n`, test that `Math.floor(Number.MAX_SAFE_INTEGER / n)` is accepted and one chip more per seat is rejected.

- [ ] **Step 2: Run tests to verify missing domain modules**

Run: `npm test -- tests/core/config.test.ts tests/core/positions.test.ts tests/core/start-hand.test.ts`

Expected: FAIL because config/state/position modules do not exist.

- [ ] **Step 3: Implement state and event types**

Use the spec's `Phase` and `PlayerHandStatus` values. Define:

```ts
export interface SeatState {
  readonly playerId: string;
  readonly seatIndex: number;
  readonly stack: number;
  readonly status: 'active' | 'folded' | 'all-in' | 'eliminated';
  readonly holeCards: readonly [Card, Card] | null;
  readonly committedStreet: number;
  readonly committedHand: number;
  readonly lastActedAtBetTo: number | null;
}

export interface PositionState {
  readonly buttonPosition: number;
  readonly smallBlindSeat: number | null;
  readonly bigBlindSeat: number;
}

export interface HandState {
  readonly handId: string;
  readonly phase: Phase;
  readonly street: Street | null;
  readonly board: readonly Card[];
  readonly burnedCards: readonly Card[];
  readonly deck: readonly Card[];
  readonly dealCursor: number;
  readonly revealedHoleCardSeats: readonly number[];
  readonly positions: PositionState;
  readonly currentActorSeat: number | null;
  readonly currentBetTo: number;
  readonly lastFullRaiseSize: number;
  readonly lastAggressorSeat: number | null;
  readonly pendingActors: readonly number[];
}
```

Use these creation contracts:

```ts
export interface TournamentSeatInput {
  readonly playerId: string;
  readonly seatIndex: number;
}

export interface StartHandOptions {
  /** First element is the next physical card dealt or burned. */
  readonly fixedDeck?: readonly Card[];
}

export interface TransitionResult {
  readonly state: TournamentState;
  readonly events: readonly DomainEvent[];
}

export function createTournament(
  config: TournamentConfig,
  seats: readonly TournamentSeatInput[],
  runSeed: string,
): TransitionResult;

export function startHand(
  state: TournamentState,
  options?: Readonly<StartHandOptions>,
): TransitionResult;
```

`TournamentState` owns immutable config, seats, hand number, logical blind level, active hand, private authority event log, version, run seed, all version identifiers and initial chip total. Input validation throws a typed configuration/deck error before any state exists.

Lock the final authoritative event vocabulary and ownership now, but add each variant to the TypeScript union only in its owning TDD task after that task's failing test exists. This keeps the reducer exhaustive at every commit without implementing untested future behavior. Every variant carries `schemaVersion: 1` and an event index; hand events also carry `handId`. Payloads are exact:

- Task 3: `GameStarted { config, seats, runSeed, rulesVersion, rngVersion, shuffleVersion, strategyVersion }`, `HandStarted { handNumber, logicalBlindLevel, smallBlind, bigBlind }`, `PositionsAssigned { buttonPosition, smallBlindSeat, bigBlindSeat }`, `BlindPosted { seat, kind, amount, allIn }`, private `DeckPrepared { fullOrderedDeck, shuffleVersion }`, private `HoleCardsDealt { orderedDeals: readonly { seat, card, round: 1 | 2 }[] }`, and `BettingRoundStarted { street, actor, currentBetTo, lastFullRaiseSize }`.
- Task 4: `PlayerActed { seat, normalizedKind, paid, betToBefore, betToAfter, allIn, fullRaise, raiseReopened }`.
- Task 5: `BettingRoundClosed { street }`, private `CardBurned { street, card }`, `CommunityCardsDealt { street, cards }`, and `HoleCardsRevealed { seat, cards, reason: 'all-in' | 'showdown' }`. `HoleCardsRevealed` is the only event that makes another seat's hole cards public.
- Task 6: `UncalledBetReturned { seat, amount }`, `ShowdownStarted { revealOrder }`, private `HandEvaluated { seat, rank }`, `PotConstructed { potId, amount, cap, eligibleSeats }`, `PotAwarded { potId, winners, amounts, oddChipRecipients }`, `PlayerEliminated { seat }`, and `HandCompleted { finalStacks }`.
- Task 7: `GameCompleted { winnerSeat }`.

`HoleCardsDealt` batches the complete clockwise two-round sequence so one reducer event advances the cursor accurately while still reconstructing each seat's pair. `DeckPrepared` is the replay source of truth and never enters a public projection.

`AgentInvalidAction` is deliberately not a `DomainEvent`; Task 11 defines it as a controller diagnostic so it cannot enter the rules reducer or increase authority state version. Implement `reduceDomainEvent(state: TournamentState | null, event: DomainEvent): TournamentState`; only `GameStarted` accepts `null`, and every other variant requires an initialized state and the next contiguous event index. `createTournament` reduces its one `GameStarted` event from `null`; `startHand` reduces its newly emitted events from the supplied state. No helper may patch the returned state directly.

- [ ] **Step 4: Implement positions, blind posting, and hole dealing**

`assignInitialPositions` uses the configured button and live physical seats. `advancePositions` first counts next-hand survivors: exactly two uses BB-continuity HU assignment from the previous BB position; three or more uses dead-button obligations. Posting deducts `min(blind, stack)`, marks zero stacks all-in, keeps the full BB as preflop bring-in in multiway, and creates `pendingActors` containing every active player including an unraised BB option. Every non-eliminated seat receives two cards even if a blind posting just made it all-in; only active seats with chips enter `pendingActors`. Shuffle with `createSeededRandom(runSeed, 'deck/<handNumber>')` unless a fixed deck is injected in tests. Emit the complete shuffled/fixed order in private `DeckPrepared` before dealing; emit every burn separately later so replay can restore `deck`, `burnedCards`, and `dealCursor` from an arbitrary event prefix without invoking randomness.

Add adjacent short-BB initialization tests at the state available in Task 3. In multiway, an actual one-chip BB at a 1/2 level still leaves a full `currentBetTo=2` bring-in for funded opponents. In HU at 2/4 with the BB able to post only 3, the button/SB has already posted 2, is the pending first actor and has a state-derived debt of exactly 1—not the full-BB difference of 2. Also test the 1/2 case where both actual posts are 1 and no player remains pending. Neither case may make a stack negative. Task 4 owns the corresponding legal-action assertions and Task 5 owns the post-call automatic runout.

- [ ] **Step 5: Verify position and initialization behavior**

Run: `npm test -- tests/core/config.test.ts tests/core/positions.test.ts tests/core/start-hand.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/config.ts src/core/events.ts src/core/state.ts src/core/positions.ts src/index.ts tests/core/config.test.ts tests/core/positions.test.ts tests/core/start-hand.test.ts
git commit -m "feat: initialize holdem tournament hands"
```

---

### Task 4: Legal actions and no-limit betting reducer

**Files:**
- Create: `src/core/legal-actions.ts`
- Create: `src/core/reducer.ts`
- Modify: `src/core/events.ts`
- Modify: `src/core/state.ts`
- Modify: `src/index.ts`
- Test: `tests/core/legal-actions.test.ts`
- Test: `tests/core/betting.test.ts`
- Test: `tests/core/short-all-in.test.ts`

**Interfaces:**
- Consumes: `TournamentState`, `HandState`, `SeatState`, `DomainEvent` from Task 3.
- Produces: `ActionIntent`, `LegalActionSet`, `getLegalActions`, `applyIntent`, `ActionRejection`, `IntentTransitionResult`.

- [ ] **Step 1: Write failing legal-action tests**

Use this exact action surface:

```ts
export type ActionIntent =
  | { readonly type: 'fold' }
  | { readonly type: 'check' }
  | { readonly type: 'call' }
  | { readonly type: 'raiseTo'; readonly amount: number }
  | { readonly type: 'allIn' };

export interface LegalActionSet {
  readonly fold: boolean;
  readonly check: boolean;
  readonly call: null | { readonly pay: number; readonly to: number; readonly isAllIn: boolean };
  readonly raiseTo: null | { readonly min: number; readonly max: number };
  readonly allIn: null | {
    readonly to: number;
    readonly mode: 'call' | 'shortBet' | 'fullBet' | 'shortRaise' | 'fullRaise';
  };
}

export type ActionRejectionCode =
  | 'not-current-actor' | 'seat-cannot-act' | 'action-not-legal'
  | 'invalid-amount' | 'raise-out-of-range' | 'raise-not-reopened';

export type IntentTransitionResult =
  | Readonly<{ accepted: true; state: TournamentState; events: readonly DomainEvent[] }>
  | Readonly<{
      accepted: false;
      state: TournamentState;
      events: readonly [];
      rejection: Readonly<{ code: ActionRejectionCode; message: string }>;
    }>;
```

Tests must assert: facing a bet exposes fold and rejects check; `toCall=0` exposes check, hides/rejects the V1 non-action open-fold, and rejects call; SB call pays only the difference; insufficient call consumes the remaining stack; NaN/Infinity/fractional/negative/out-of-range raiseTo is rejected without events or version change. Separately cover opening all-ins below BB (`shortBet`) and at least BB (`fullBet`) so they are never mislabeled as raises. Because `allIn` is only convenience syntax, assert `{ type: 'raiseTo', amount: maxRaiseTo }` and `{ type: 'allIn' }` produce the same normalized short/full all-in event whenever the target consumes the actor's entire stack.

Continue Task 3's short-BB pair: multiway funded opponents still see the full-BB call target; in HU 2/4 with BB all-in for 3 and button/SB committed 2, the button sees call pay 1 plus fold, with no raise/all-in-raise option because no opponent can respond. In HU 1/2 where both actual posts are 1, expose no player decision.

- [ ] **Step 2: Add the canonical raise and reopen failing cases**

Task 4 owns design-spec cases 14.3.1–3; later tasks own pots/odd chips, BB closure and HU flow. Encode those three here plus these locked counterexamples:

- BB=100: A checks, B opens all-in to 20. Unacted C may fold/call 20/raiseTo 120; when action returns, already-checked A may only fold/call 20.
- A bets 300, then opponents move all-in to 500, 650 and 800. The increments remain short relative to the original 300 full-bet size, so the next unacted player has `minRaiseTo=1100`.
- Blinds 2000/4000: A calls 4000, C moves all-in to 7500. The unacted BB may raiseTo at least 11500; if BB calls, A cannot raise, while BB raiseTo 11500 reopens A.

For every step assert `currentBetTo`, `lastFullRaiseSize`, `lastAggressorSeat`, each actor's `lastActedAtBetTo`, `pendingActors`, and whether `raiseTo` is present. Include the single short raise and cumulative-short partial-reopen example from the spec.

- [ ] **Step 3: Run focused tests and confirm missing implementation**

Run: `npm test -- tests/core/legal-actions.test.ts tests/core/betting.test.ts tests/core/short-all-in.test.ts`

Expected: FAIL because legal-actions and reducer modules do not exist.

- [ ] **Step 4: Implement legal action derivation**

Calculate:

```ts
const toCall = Math.max(0, hand.currentBetTo - seat.committedStreet);
const maxRaiseTo = seat.committedStreet + seat.stack;
const minRaiseTo = hand.currentBetTo + hand.lastFullRaiseSize;
```

Set `fold = toCall > 0` and `check = toCall === 0`; V1 rejects open-fold rather than recording a meaningless action. Expose a normal raise only when the player retains raise rights and `maxRaiseTo >= minRaiseTo`. Expose short all-in only when `hand.currentBetTo < maxRaiseTo && maxRaiseTo < minRaiseTo`. Do not expose raise when no live opponent with remaining chips can respond. Preflop BB remains pending even when all earlier players merely call. When one actionable player still owes chips to all-in opponents, expose only fold/call and never raise.

- [ ] **Step 5: Implement intent normalization and event reduction**

Normalize `allIn` from stack/toCall/currentBetTo into call, short/full opening bet, or short/full raise. A bet/raise increment is `newBetTo - oldBetTo`; only an increment at least `lastFullRaiseSize` updates that field. Every increase updates `lastAggressorSeat`, including a short opening bet. Set the acting player's `lastActedAtBetTo` to the resulting `currentBetTo`. `PlayerActed.normalizedKind` records `fold | check | call | bet | raise`, while `fullRaise` separately records whether a bet/raise met the full increment; this preserves correct history and river aggression semantics.

For a previously acting player, raise rights return only when:

```ts
hand.currentBetTo - seat.lastActedAtBetTo >= hand.lastFullRaiseSize
```

When `currentBetTo` rises, re-add unmatched active opponents to pending response order; keep the ability-to-raise calculation separate. Return rejected intents with the same state reference, empty events and a typed rejection reason.

- [ ] **Step 6: Run betting verification**

Run: `npm test -- tests/core/legal-actions.test.ts tests/core/betting.test.ts tests/core/short-all-in.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/core/legal-actions.ts src/core/reducer.ts src/core/events.ts src/core/state.ts src/index.ts tests/core/legal-actions.test.ts tests/core/betting.test.ts tests/core/short-all-in.test.ts
git commit -m "feat: enforce no-limit betting actions"
```

---

### Task 5: Betting-round closure, burns, community cards, and automatic runout

**Files:**
- Create: `src/core/dealing.ts`
- Modify: `src/core/reducer.ts`
- Modify: `src/core/events.ts`
- Modify: `src/core/state.ts`
- Modify: `src/index.ts`
- Test: `tests/core/street-progression.test.ts`
- Test: `tests/core/automatic-runout.test.ts`
- Test: `tests/core/fold-settlement.test.ts`

**Interfaces:**
- Consumes: `applyIntent`, betting state and deck cursor from Tasks 3–4.
- Produces: `advanceAutomaticPhases(state)`, `isBettingRoundClosed(hand, seats)`, burn/deal events, fold-settlement transition.

- [ ] **Step 1: Write failing street-progression tests**

Build a fixed ordered deck and assert: after a closed preflop round one card is burned and three board cards are dealt; flop and turn each burn one then deal one; the final board has five cards, burnedCards has three, and no card appears twice. Assert each postflop street resets every seat's `committedStreet` and `lastActedAtBetTo`, sets `currentBetTo=0`, `lastFullRaiseSize=BB`, `lastAggressorSeat=null`, rebuilds `pendingActors` from only active seats with chips in postflop physical order, excludes folded/all-in/eliminated seats, and makes `currentActorSeat` equal the first pending seat. Add a regression where preflop had aggression but later streets check through, proving no prior-street aggressor or acted flag leaks forward.

- [ ] **Step 2: Write failing automatic-boundary tests**

Cover these exact outcomes:

- Every active player checks and the street advances once.
- All remaining live players are all-in, so the engine reveals them, burns/deals through river and enters showdown without requesting another action.
- Exactly one actionable player who owes nothing triggers automatic runout.
- Exactly one actionable player who owes chips receives only fold/call.
- Folding to one live player enters settlement immediately, board length does not change and a spy evaluator is never called.
- In the HU 2/4 short-BB fixture from Tasks 3–4, the button's one-chip call closes action and automatically reveals/runs out to `showdown`; assert both `HoleCardsRevealed.eventIndex` values precede the first later burn/community event. The test does not call settlement, which arrives in Task 6.

The reveal-before-runout predicate is: at least one live player is all-in and no future betting decision exists, meaning either `actionableCount===0` or `actionableCount===1` with that player's `toCall===0`. In both the all-all-in and one-funded-player-plus-all-in cases, assert every eligible live seat's `HoleCardsRevealed.eventIndex` is lower than the first subsequent `CardBurned`/`CommunityCardsDealt` event index; if already on river, assert reveals are emitted before the method returns the `showdown` phase. Task 6 then compares them to `ShowdownStarted`. Fold settlement emits no reveal. A river short opening all-in still sets the correct final aggressor even though it is not a full bet.

- [ ] **Step 3: Run tests and confirm missing automatic advancement**

Run: `npm test -- tests/core/street-progression.test.ts tests/core/automatic-runout.test.ts tests/core/fold-settlement.test.ts`

Expected: FAIL because `advanceAutomaticPhases` is missing.

- [ ] **Step 4: Implement closure and phase advancement**

`isBettingRoundClosed` requires every non-folded player with chips to have matched `currentBetTo` and completed the street's pending action/response. In `advanceAutomaticPhases`, check in this order:

1. one non-folded player → `settlement` with fold winner;
2. no actionable player → burn/deal remaining streets and `showdown`;
3. one actionable player who owes zero while at least one opponent is all-in → reveal all eligible live hands, then burn/deal remaining streets and enter `showdown`;
4. closed street → burn/deal next street or enter `showdown` after river;
5. otherwise leave state awaiting the current actor.

Automatic events must be reduced through `reduceDomainEvent`; no direct mutation or hidden transition is allowed.

At this task boundary `advanceAutomaticPhases` may stop at `showdown` or `settlement` because settlement is introduced in Task 6. Its final contract after Task 6 will be to continue until the next player decision, `hand-complete`, or `game-complete`; callers must never invoke settlement helpers manually.

- [ ] **Step 5: Run automatic-flow verification**

Run: `npm test -- tests/core/street-progression.test.ts tests/core/automatic-runout.test.ts tests/core/fold-settlement.test.ts tests/core/betting.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/dealing.ts src/core/reducer.ts src/core/events.ts src/core/state.ts src/index.ts tests/core/street-progression.test.ts tests/core/automatic-runout.test.ts tests/core/fold-settlement.test.ts
git commit -m "feat: advance holdem streets deterministically"
```

---

### Task 6: Pot layers, refunds, showdown, odd chips, and elimination

**Files:**
- Create: `src/core/pots.ts`
- Create: `src/core/settlement.ts`
- Modify: `src/core/dealing.ts`
- Modify: `src/core/events.ts`
- Modify: `src/core/state.ts`
- Modify: `src/index.ts`
- Test: `tests/core/pots.test.ts`
- Test: `tests/core/showdown.test.ts`
- Test: `tests/core/odd-chips.test.ts`
- Test: `tests/core/elimination.test.ts`

**Interfaces:**
- Consumes: evaluator from Task 2 and hand/tournament state from Tasks 3–5.
- Produces: `PotLayer`, `Refund`, `buildPotLayers(seats)`, `settleFoldWin(state)`, `settleShowdown(state)`, `orderOddChipWinners`.

- [ ] **Step 1: Write failing pure pot-layer tests**

Use the exact expected values:

```ts
expect(buildPotLayers(contributions([25, 50, 100, 100]))).toEqual({
  pots: [
    { amount: 100, cap: 25, eligibleSeats: [0, 1, 2, 3] },
    { amount: 75, cap: 50, eligibleSeats: [1, 2, 3] },
    { amount: 100, cap: 100, eligibleSeats: [2, 3] }
  ],
  refunds: []
});

expect(buildPotLayers(contributions([60, 100, 200]))).toEqual({
  pots: [
    { amount: 180, cap: 60, eligibleSeats: [0, 1, 2] },
    { amount: 80, cap: 100, eligibleSeats: [1, 2] }
  ],
  refunds: [{ seatIndex: 2, amount: 100 }]
});
```

Add a folded contributor fixture where folded chips remain in amounts but that seat is excluded from every `eligibleSeats` list.

- [ ] **Step 2: Write failing showdown and odd-chip tests**

Cover board plays, kicker wins, different winners for main and side pots, complete ties, and `101 → 50/51`. Add a three-way tie with remainder 2, a dead-button/empty-seat case, and main/side pots that both tie. For each pot, start odd-chip order from the first tied winner left of the physical button and restart the ordering for the next pot. Assert suits never break a tie.

Lock reveal order and visibility: a called river short all-in is still the last aggressor and reveals first; with no river bet, begin left of button; all-in participants reveal automatically; a fold winner never reveals. Any Task 5 automatic `HoleCardsRevealed.eventIndex` must precede Task 6's `ShowdownStarted.eventIndex`; all reveals precede public rank/result output, and only seats still eligible for at least one pot are automatically exposed.

- [ ] **Step 3: Write failing elimination timing tests**

Assert an all-in player with zero stack remains `all-in` and eligible until every pot is awarded, then becomes `eliminated` only if final stack is zero. Assert fold settlement refunds an unmatched layer before awarding the contested pot and never emits `HandEvaluated` or `HoleCardsRevealed`. Assert settlement owns elimination exactly once per seat: all refunds and `PotAwarded` events precede `PlayerEliminated`, and every elimination precedes `HandCompleted`.

Add two end-to-end tests that call only the public automatic-advance API: `apply fold → settlement → HandCompleted`, and `all-in call → reveal → runout → PotAwarded → HandCompleted`. Neither test may call `settleFoldWin` or `settleShowdown` directly, and both must finish with `currentActorSeat=null`.

- [ ] **Step 4: Run settlement tests and confirm failure**

Run: `npm test -- tests/core/pots.test.ts tests/core/showdown.test.ts tests/core/odd-chips.test.ts tests/core/elimination.test.ts`

Expected: FAIL because pot and settlement modules are missing.

- [ ] **Step 5: Implement contribution-layer construction**

Sort unique positive contribution caps ascending. For each cap calculate `(cap - previousCap) * count(contribution >= cap)`. Eligible seats are non-folded contributors at or above the cap. A top layer with exactly one contributor becomes a refund rather than a pot. Return deterministic seat ordering by physical index.

- [ ] **Step 6: Implement fold and showdown settlement**

For showdown, determine reveal order, emit any not-yet-emitted `HoleCardsRevealed` events, evaluate each eligible live seat once, cache its `HandRank`, then determine winners independently for each pot. Award integer shares and route remainders through `orderOddChipWinners`. Emit refunds, pot construction, hand evaluations, awards, eliminations, and `HandCompleted` as events reduced in order. For fold wins, skip the evaluator and reveal no private cards.

Extend `advanceAutomaticPhases` in `dealing.ts` to loop through `showdown → settlement → hand-complete` by dispatching the appropriate settlement function. It returns only when a player decision is required or the hand/game is terminal. Settlement is the sole elimination owner; Task 7's `startNextHand` only reads already-finalized seat statuses and must never emit a duplicate elimination.

- [ ] **Step 7: Run settlement verification**

Run: `npm test -- tests/core/pots.test.ts tests/core/showdown.test.ts tests/core/odd-chips.test.ts tests/core/elimination.test.ts tests/core/hand-evaluator.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/core/pots.ts src/core/settlement.ts src/core/dealing.ts src/core/events.ts src/core/state.ts src/index.ts tests/core/pots.test.ts tests/core/showdown.test.ts tests/core/odd-chips.test.ts tests/core/elimination.test.ts
git commit -m "feat: settle main and side pots"
```

---

### Task 7: Tournament lifecycle, replay, invariants, and 100-hand randomized gate

**Files:**
- Create: `src/core/replay.ts`
- Create: `src/core/invariants.ts`
- Create: `src/core/simulation.ts`
- Modify: `src/core/state.ts`
- Modify: `src/core/events.ts`
- Modify: `src/core/positions.ts`
- Modify: `src/index.ts`
- Test: `tests/core/tournament-lifecycle.test.ts`
- Test: `tests/core/replay.test.ts`
- Test: `tests/core/invariants.test.ts`
- Test: `tests/integration/random-hands.test.ts`

**Interfaces:**
- Consumes: complete hand flow from Tasks 3–6.
- Produces: `startNextHand`, `replayTournament`, `assertTournamentInvariants`, `chooseRandomLegalAction`, `runRandomHand`.

- [ ] **Step 1: Write failing lifecycle and blind-level tests**

Define `logicalLevel = Math.floor((handNumber - 1) / handsPerLevel)`. If it is inside the non-empty `blindLevels`, use that entry. Otherwise compute `extra = logicalLevel - (blindLevels.length - 1)` and saturating-double each last configured blind: before every multiplication, if doubling would exceed `initialChipTotal`, return `initialChipTotal` directly rather than first creating an unsafe number. Test the final configured level, first and second extrapolated levels, and saturation. Assert physical seat indices remain stable, zero-stack players do not receive cards or blinds next hand, all 3–6→HU cases follow BB continuity, settlement has already emitted each elimination exactly once, and one survivor emits `GameCompleted` instead of starting another hand.

- [ ] **Step 2: Write failing replay tests**

Run a fixed deck and fixed intents through one complete hand and save a `ReplayEnvelope { containsPrivateData: true, versions, initialConfig, seats, runSeed, events }`. Replay begins with `state=null` and reduces the full stream exactly once, including `GameStarted`; it must not call `createTournament` and then reduce a duplicate `GameStarted`. For prefixes immediately after `DeckPrepared`, hole dealing, flop dealing, all-in reveal/runout and final completion, expect every authoritative field—including full deck, burns, cursor, event log and version—to deep-equal the original prefix state. Reject unknown schema, rules, RNG, shuffle or strategy versions with typed `ReplayVersionError`, and reject an envelope whose header disagrees with `GameStarted`.

```ts
export interface ReplayEnvelopeV1 {
  readonly containsPrivateData: true;
  readonly schemaVersion: 1;
  readonly rulesVersion: 'holdem-v1';
  readonly rngVersion: 'mulberry32-v1';
  readonly shuffleVersion: 'fisher-yates-v1';
  readonly strategyVersion: 'parametric-v1';
  readonly initialConfig: TournamentConfig;
  readonly seats: readonly TournamentSeatInput[];
  readonly runSeed: string;
  readonly events: readonly DomainEvent[];
}
```

- [ ] **Step 3: Write failing invariant and random-hand tests**

`assertTournamentInvariants` must check by phase:

- safe integer and non-negative stacks/commitments;
- chip conservation including committed chips, pending refunds and pending payouts;
- `deck` itself is exactly 52 unique cards; the consumed prefix maps one-to-one and in order onto all dealt hole/burn/board destinations, no destination card repeats, `dealCursor` equals consumed destination count, and board growth is only 0/3/4/5;
- only a betting state waiting for input has an active/non-all-in current actor with at least one legal action; automatic, settlement and terminal phases require `currentActorSeat=null`;
- folded players absent from winners;
- after pot construction and before payout, pot plus refund sum equals hand commitments; earlier phases validate conservation directly from commitments and later phases validate payout buffers;
- hand completion clears every commitment, pending pot, refund and payout value.

Create exactly 20 fixed seeds per player count 2, 3, 4, 5 and 6. Cycle those seeds through an explicit configuration matrix containing `(startingStack, SB, BB)` values `(1,1,2)`, `(3,1,2)`, `(10,1,2)`, `(40,1,2)`, `(100,1,2)`, and `(100,2,5)` so the gate covers shorter-than-BB, 1–5BB, medium/deep stacks and distinct blind ratios. Every generated hand must terminate within 500 accepted actions/automatic transitions and satisfy phase-appropriate invariants after every accepted event and automatic transition.

- [ ] **Step 4: Run the new tests and confirm failure**

Run: `npm test -- tests/core/tournament-lifecycle.test.ts tests/core/replay.test.ts tests/core/invariants.test.ts tests/integration/random-hands.test.ts`

Expected: FAIL because replay/invariant/simulation modules are missing.

- [ ] **Step 5: Implement lifecycle and replay**

After `HandCompleted`, read already-finalized eliminations, advance positions from physical seats, choose the configured/extrapolated blind level, and start the next hand unless one survivor remains. Do not apply or emit eliminations here. `replayTournament` validates the envelope and all recorded version identifiers before the first reduction, starts with `state=null`, then reduces recorded domain events without invoking AI, deck generation or any random source.

- [ ] **Step 6: Implement invariants and deterministic random driver**

`chooseRandomLegalAction` samples only the `LegalActionSet`; if `raiseTo` is legal, choose one of min, midpoint safe integer, max. `runRandomHand` loops apply → automatic advance → invariant assertion until `hand-complete`, with a hard guard that reports seed, player count, state version and event tail on nontermination.

- [ ] **Step 7: Run the hard randomized gate**

Run: `npm test -- tests/core/tournament-lifecycle.test.ts tests/core/replay.test.ts tests/core/invariants.test.ts tests/integration/random-hands.test.ts`

Expected: PASS, including exactly 100 or more randomized hands and at least 20 for every supported player count.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/core/replay.ts src/core/invariants.ts src/core/simulation.ts src/core/state.ts src/core/events.ts src/core/positions.ts src/index.ts tests/core/tournament-lifecycle.test.ts tests/core/replay.test.ts tests/core/invariants.test.ts tests/integration/random-hands.test.ts
git commit -m "feat: replay and validate holdem tournaments"
```

---

### Task 8: Player observation projection and hidden-information isolation

**Files:**
- Create: `src/core/public-events.ts`
- Create: `src/agents/types.ts`
- Create: `src/agents/observation.ts`
- Modify: `src/index.ts`
- Test: `tests/core/public-events.test.ts`
- Test: `tests/agents/observation.test.ts`
- Test: `tests/agents/hidden-information.test.ts`

**Interfaces:**
- Consumes: authority state, public events and legal actions from Tasks 3–7.
- Produces: `PublicGameEvent`, `projectEventsForViewer(events, viewerSeatIndex: number | null)`, `PlayerObservationV1`, `DecisionContext`, `ActionDecision`, `PokerAgent`, `projectObservation`, `deepFreezeObservation`.

- [ ] **Step 1: Write failing observation whitelist tests**

Define the public schema with these required fields:

```ts
export interface PlayerObservationV1 {
  readonly schemaVersion: 1;
  readonly handId: string;
  readonly handNumber: number;
  readonly decisionIndex: number;
  readonly actorSeatIndex: number;
  readonly street: Street;
  readonly holeCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly buttonPosition: number;
  readonly smallBlindSeat: number | null;
  readonly bigBlindSeat: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly potTotal: number;
  readonly sidePots: readonly PublicPotView[];
  readonly seats: readonly PublicSeatState[];
  readonly actionHistory: readonly PublicActionEvent[];
  readonly legalActions: LegalActionSet;
}
```

Define the nested whitelist rather than leaving open records:

```ts
export interface PublicSeatState {
  readonly playerId: string;
  readonly seatIndex: number;
  readonly stack: number;
  readonly status: PlayerHandStatus;
  readonly committedStreet: number;
  readonly committedHand: number;
  readonly revealedHoleCards: readonly [Card, Card] | null;
}

export interface PublicPotView {
  readonly amount: number;
  readonly eligibleSeatIndexes: readonly number[];
}

export type PublicActionEvent =
  | Readonly<{ type: 'blindPosted'; seatIndex: number; kind: 'small' | 'big'; amount: number; allIn: boolean }>
  | Readonly<{ type: 'playerActed'; seatIndex: number; kind: 'fold' | 'check' | 'call' | 'bet' | 'raise'; paid: number; betTo: number; allIn: boolean }>;
```

`PublicGameEvent` is a closed union with only these variants/payloads: `gameStarted { maxSeats, startingStack }`, `handStarted { handNumber, smallBlind, bigBlind }`, `positionsAssigned`, `blindPosted`, viewer-only `ownHoleCardsDealt { cards }` filtered from the batch, `bettingRoundStarted { street, actor, currentBetTo }`, `playerActed` using `PublicActionEvent`, `bettingRoundClosed`, `communityCardsDealt`, `holeCardsRevealed`, `uncalledBetReturned`, `showdownStarted { revealOrder }`, `potConstructed { potId, amount, eligibleSeats }`, `potAwarded { potId, winners, amounts, oddChipRecipients }`, `playerEliminated`, `handCompleted { finalStacks }`, and `gameCompleted { winnerSeat }`. Each includes only the named primitive/copied fields and has no catch-all record.

Map every `DomainEvent` variant explicitly: suppress `DeckPrepared`, `CardBurned`, unrevealed `HoleCardsDealt` for other seats and `HandEvaluated`; map `HoleCardsDealt` only for its owning viewer; map `HoleCardsRevealed` for all viewers. Snapshot the recursive observation/public-event key lists and assert they contain no deck, deal cursor, burned cards, run seed, evaluator result, unrevealed opponent hole cards, decision trace, internal strategy profile or authority object reference.

- [ ] **Step 2: Write the dual-world and mutation failing tests**

Create two authority states with identical acting-player information but different opponent hole cards, burn cards and future deck. Expect deep-equal observations and public events. Pass both to a deterministic probe agent with the same private seed and expect identical decisions. Attempt to mutate board, seats and legal action bounds and expect a TypeError while authority state remains unchanged.

Projection must allocate fresh arrays and nested objects before freezing; assert `observation.board[0] !== authority.hand.board[0]` and that projection does not newly freeze any authority object. Add per-seat tests, folded/mucked cards tests, legal showdown/all-in reveal tests, and an exhaustive table that supplies every authoritative event variant to `projectEventsForViewer` and asserts its exact public result or explicit suppression. At this task boundary, a hidden-card sentinel must be absent from projected event arrays and their public JSON serialization before a legal reveal. Task 11 reuses the sentinel against the real controller callback and renderer once those modules exist; Task 12 separately proves character labels/profiles cannot enter core schemas.

- [ ] **Step 3: Run tests and confirm missing projection**

Run: `npm test -- tests/core/public-events.test.ts tests/agents/observation.test.ts tests/agents/hidden-information.test.ts`

Expected: FAIL because agent types and projection do not exist.

- [ ] **Step 4: Implement explicit projection and interfaces**

Define:

```ts
export interface DecisionContext {
  readonly observation: Readonly<PlayerObservationV1>;
  readonly random: RandomSource;
}

export interface ActionDecision {
  readonly action: ActionIntent;
  readonly privateTrace?: Readonly<{
    intent: 'value' | 'bluff' | 'semiBluff' | 'potControl' | 'trap' | 'draw' | 'preserveStack';
    equityBand: 'low' | 'medium' | 'high';
    potOddsBand: 'low' | 'medium' | 'high';
    positionAdjustment: number;
    sizingReason: 'none' | 'minimum' | 'half-pot' | 'three-quarter-pot' | 'pot' | 'all-in';
  }>;
}

export interface PokerAgent {
  readonly agentId: string;
  decide(context: Readonly<DecisionContext>): ActionDecision | Promise<ActionDecision>;
}
```

Build every observation field explicitly; never spread authority state or reuse nested authority objects. Include only events whose public projection is legal at that point. Deep-freeze recursively after copying. `privateTrace` is available only to an opt-in private debug sink, defaults off, and is never copied into a domain event, `PublicGameEvent`, normal replay view or CLI output.

- [ ] **Step 5: Run observation verification**

Run: `npm test -- tests/core/public-events.test.ts tests/agents/observation.test.ts tests/agents/hidden-information.test.ts tests/core/legal-actions.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/public-events.ts src/agents/types.ts src/agents/observation.ts src/index.ts tests/core/public-events.test.ts tests/agents/observation.test.ts tests/agents/hidden-information.test.ts
git commit -m "feat: isolate player-visible poker state"
```

---

### Task 9: Deterministic Monte Carlo equity estimator

**Files:**
- Create: `src/agents/equity.ts`
- Modify: `src/agents/types.ts`
- Modify: `src/index.ts`
- Test: `tests/agents/equity.test.ts`

**Interfaces:**
- Consumes: `PlayerObservationV1`, evaluator, cards and private `RandomSource`.
- Produces: `EquityEstimate`, `estimateEquity(observation, samples, random)`.

- [ ] **Step 1: Write failing deterministic equity tests**

```ts
it('gives an unbeatable private royal flush full equity', () => {
  const observation = fixtureObservation({
    holeCards: ['As', 'Ks'],
    board: ['Qs', 'Js', 'Ts', '2d', '3c'],
    liveOpponents: 1
  });
  expect(estimateEquity(observation, 50, createSeededRandom('eq'))).toEqual({
    equity: 1,
    wins: 50,
    ties: 0,
    losses: 0,
    samples: 50
  });
});
```

Add a royal flush entirely on the board with one opponent and expect equity 0.5 in every sample, then with two opponents and expect exactly 1/3. Folded/eliminated seats do not count as unknown opponents; active and all-in seats do. Add same-seed reproducibility and different-authority-deck independence tests. Reject samples below 1, observations with duplicate known cards, and observations that require more unknown cards than remain.

- [ ] **Step 2: Run test and confirm missing estimator**

Run: `npm test -- tests/agents/equity.test.ts`

Expected: FAIL because `equity.ts` does not exist.

- [ ] **Step 3: Implement known-information sampling**

Define:

```ts
export interface EquityEstimate {
  readonly equity: number;
  readonly wins: number;
  readonly ties: number;
  readonly losses: number;
  readonly samples: number;
}
```

For each sample, construct a fresh standard deck excluding only hero cards and public board; shuffle with the supplied private RNG; deal two unknown cards per live opponent and enough public cards to reach five. Evaluate every hand, split ties as `1 / winnerCount`, and accumulate hero equity. Never import or accept `TournamentState`, `HandState`, authority deck or burn cards.

- [ ] **Step 4: Run equity and isolation verification**

Run: `npm test -- tests/agents/equity.test.ts tests/agents/hidden-information.test.ts tests/core/hand-evaluator.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/agents/equity.ts src/agents/types.ts src/index.ts tests/agents/equity.test.ts
git commit -m "feat: estimate visible-state poker equity"
```

---

### Task 10: Parameterized poker AI and four character styles

**Files:**
- Create: `src/agents/parametric-agent.ts`
- Create: `src/agents/characters.ts`
- Modify: `src/agents/types.ts`
- Modify: `src/index.ts`
- Test: `tests/agents/parametric-agent.test.ts`
- Test: `tests/agents/style-benchmarks.test.ts`

**Interfaces:**
- Consumes: observation and equity from Tasks 8–9.
- Produces: `StyleProfile`, `ParametricHoldemAgent`, `CHARACTERS`, `createCharacterAgent(characterId)`.

- [ ] **Step 1: Define exact character profiles and write failing tests**

```ts
export interface StyleProfile {
  readonly looseness: number;
  readonly aggression: number;
  readonly bluffing: number;
  readonly stickiness: number;
  readonly positionAwareness: number;
  readonly riskAppetite: number;
  readonly slowPlay: number;
  readonly variability: number;
  readonly sizing: Readonly<{
    preferredPotFraction: 0.5 | 0.75 | 1;
    variance: number;
    overbetFrequency: number;
  }>;
}
```

Profiles list the eight scalar fields in interface order, followed by the complete sizing object:

- rock: `.15, .28, .04, .18, .45, .15, .20, .06`; sizing `{ preferredPotFraction: .5, variance: .05, overbetFrequency: .01 }`.
- hunter: `.30, .74, .18, .42, .90, .48, .28, .10`; sizing `{ preferredPotFraction: .75, variance: .10, overbetFrequency: .06 }`.
- maniac: `.82, .92, .58, .55, .58, .88, .08, .28`; sizing `{ preferredPotFraction: 1, variance: .28, overbetFrequency: .30 }`.
- calling-station: `.78, .16, .03, .94, .18, .52, .42, .10`; sizing `{ preferredPotFraction: .5, variance: .08, overbetFrequency: 0 }`.

`ParametricHoldemAgent` accepts an injectable `EquityProvider` for fast deterministic policy tests, while its production default calls Task 9 with exactly 300 samples. Write same-observation/same-seed deterministic tests, legal-action-only tests, and private-trace tests that never expose opponent cards or enter a public output. Add focused monotonic tests showing each profile field changes its named calculation or sizing distribution in the expected direction; no declared parameter may be ignored.

- [ ] **Step 2: Write the failing 200+200 style benchmarks**

Generate at least 200 fixed preflop fixtures shared by every character and a fixed seed set. Assert rock has the lowest continue rate; maniac continue rate is at least 20 percentage points above rock, maniac raise rate is at least 15 points above rock and higher than every other character; hunter's premium-hand raise rate exceeds rock's by at least 10 points and its button continue rate exceeds its identical early-position rate by at least 10 points. Generate at least 200 postflop marginal-hand fixtures facing a bet and assert calling-station fold rate is at least 20 points below rock and its raise rate is at least 10 points below hunter. Across the shared fixtures, maniac pot-or-all-in sizing frequency must exceed hunter's by at least 5 points. Report continue/VPIP proxy, raise/PFR proxy, fold-to-bet and pot-or-all-in rates in assertion diagnostics. Benchmarks use the injected deterministic equity provider so hundreds of fixtures remain fast; a separate wiring test spies on the production provider and proves one normal decision requests exactly 300 Task 9 samples.

- [ ] **Step 3: Run tests and confirm missing agent implementation**

Run: `npm test -- tests/agents/parametric-agent.test.ts tests/agents/style-benchmarks.test.ts`

Expected: FAIL because parametric-agent and characters modules do not exist.

- [ ] **Step 4: Implement the explainable policy**

Use 300 equity samples for normal decisions. Compute:

```text
continueScore = equity - potOdds
              + (looseness - 0.5) * 0.25
              + (stickiness - 0.5) * 0.15
              + positionAdjustment

raiseScore = equity
           + (aggression - 0.5) * 0.25
           + drawSemiBluffAdjustment
           + bluffRollAdjustment
```

The decision RNG supplied by the controller is an immutable parent: immediately fork `equity-sampling`, `policy-variability`, `bluff`, `slow-play`, and `sizing`, and never consume the parent directly. Changing the number of equity draws therefore cannot move bluff, slow-play or sizing rolls.

Position adjustment is zero in HU, negative in early multiway position and positive on button, scaled by `positionAwareness` with absolute maximum 0.08. Calculate pot odds as `callPay / (potTotal + callPay)` when facing a bet. Detect visible four-flush/open-ended draws for a `+0.08` semi-bluff adjustment and gutshots for `+0.04`. Add centered policy noise `(policyRoll - 0.5) * 0.12 * variability`. A bluff triggers when a dedicated roll is below `bluffing * (0.15 + 0.35 * aggression)` and a legal raise exists; set `bluffRollAdjustment=0.15` when triggered and zero otherwise, and allow it to override a negative continue score. Otherwise, if facing a bet and `continueScore < 0`, fold; call unless `raiseScore` exceeds `0.62 - aggression * 0.12`. If check is legal, check unless the same value threshold or a bluff triggers a raise. Define a strong hand as `equity >= 0.75`; it may slow-play only when `slowPlayRoll < slowPlay * 0.25`.

Derive effective stack as the smaller of hero's available chips and the largest contestable live-opponent stack; define SPR as `effectiveStack / max(1, potTotal)`. For a proposed additional payment, compute `commitFraction = payment / max(1, effectiveStack)` and `largeCommitPenalty = min(0.10, max(0, commitFraction - 0.5) * 0.20 * (1 - riskAppetite))`, subtracting it from raise score. When the preferred approved size is legal, choose an adjacent approved size iff `sizingRoll < sizing.variance`; choose pot/all-in instead iff a separate sizing-fork roll is below `overbetFrequency * riskAppetite`. Otherwise choose the preferred closest approved size. These formula helpers are exported only for tests, not as public package API.

Choose only legal min raise, half-pot, three-quarter-pot, pot or all-in targets. For pot fraction `f`, compute additional payment as `toCall + f * (potTotal + toCall)`, then set `raiseTo = committedStreet + roundedPayment`; clamp to legal min/max using safe integers and deduplicate. `privateTrace` records only the enumerated bands/intent/position/sizing fields from Task 8 and never appears in public output.

- [ ] **Step 5: Prove policy substream isolation**

With the same observation and parent seed, make one injected equity provider consume 1,000 extra values from only its `equity-sampling` fork. Assert bluff, slow-play and sizing rolls/decision components stay identical. Full tournament/deck isolation waits for the controller introduced in Task 11.

- [ ] **Step 6: Run agent verification**

Run: `npm test -- tests/agents/parametric-agent.test.ts tests/agents/style-benchmarks.test.ts tests/agents/hidden-information.test.ts`

Expected: PASS and benchmark deltas meet the exact thresholds.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/agents/parametric-agent.ts src/agents/characters.ts src/agents/types.ts src/index.ts tests/agents/parametric-agent.test.ts tests/agents/style-benchmarks.test.ts
git commit -m "feat: add distinct holdem character styles"
```

---

### Task 11: Tournament controller and playable terminal adapter

**Files:**
- Create: `src/game/participant.ts`
- Create: `src/game/tournament-controller.ts`
- Create: `src/cli/renderer.ts`
- Create: `src/cli/prompts.ts`
- Create: `src/cli/index.ts`
- Modify: `src/index.ts`
- Test: `tests/game/tournament-controller.test.ts`
- Test: `tests/cli/renderer.test.ts`
- Test: `tests/cli/prompts.test.ts`
- Test: `tests/integration/default-tournament.test.ts`
- Test: `tests/integration/random-isolation.test.ts`

**Interfaces:**
- Consumes: complete rules core and PokerAgent.
- Produces: `Participant`, `ScriptedParticipant`, `AgentParticipant`, `runTournament`, `renderTable`, `promptForLegalAction`, CLI `main`.

- [ ] **Step 1: Write failing controller tests with scripted participants**

Define:

```ts
export interface Participant {
  readonly playerId: string;
  decide(context: Readonly<DecisionContext>): Promise<ActionDecision>;
}

export interface RunTournamentOptions {
  readonly config: TournamentConfig;
  readonly participants: readonly Participant[];
  readonly runSeed: string;
  readonly invalidAgentActionMode?: 'throw' | 'fallback';
  /** null/omitted means spectator projection with no private hole cards. */
  readonly publicViewerSeatIndex?: number | null;
  readonly onPublicEvents?: (events: readonly PublicGameEvent[]) => void | Promise<void>;
  /** Internal test/replay sink; never pass this stream to a participant or UI. */
  readonly onAuthorityEvents?: (events: readonly DomainEvent[]) => void | Promise<void>;
  readonly onDiagnostic?: (event: ControllerDiagnosticEvent) => void | Promise<void>;
}
```

`ControllerDiagnosticEvent` includes `AgentInvalidAction` but is not reducible and never changes authority state/version. Use scripted participants that always choose check, otherwise call, otherwise fold. Assert the controller asks only the current actor, validates every decision, advances automatic phases through settlement, starts next hands and returns a `game-complete` state with one survivor. Library/tests/simulation default to `invalidAgentActionMode='throw'`; only the playable CLI explicitly selects `fallback`, emits one diagnostic, then submits check if legal or fold otherwise.

Define `decisionIndex` as the count of accepted `PlayerActed` events already present in the current hand, not total event count, authority version, participant calls or rejected attempts. The controller alone derives `createSeededRandom(runSeed, 'agent/<handNumber>/<seatIndex>/<decisionIndex>')` and supplies it through `DecisionContext`; `AgentParticipant` merely forwards the context to its agent and never creates or advances a master RNG.

- [ ] **Step 2: Write failing renderer and prompt tests**

`renderTable` accepts only `PlayerObservationV1`; action/result rendering accepts only `PublicGameEvent`. Neither renderer accepts `TournamentState`, `HandState`, `DomainEvent` or private trace. Snapshots must show Chinese labels, public board, pots, button/blinds, all stacks, player's own hole cards, and hide other hole cards before legal reveal. Include hidden-card sentinel values and assert they never appear in renderer strings or `onPublicEvents`, while legally revealed cards do. Prompt tests inject text lines and assert invalid commands/amounts re-prompt without submitting an action. Legal commands are `f`, `x`, `c`, `r <raiseTo>`, and `a` only when the corresponding legal action exists.

- [ ] **Step 3: Run tests and confirm missing game/CLI modules**

Run: `npm test -- tests/game/tournament-controller.test.ts tests/cli/renderer.test.ts tests/cli/prompts.test.ts tests/integration/default-tournament.test.ts tests/integration/random-isolation.test.ts`

Expected: FAIL because game and CLI modules do not exist.

- [ ] **Step 4: Implement participants and controller**

The controller constructs the decision RNG using the locked path above and awaits the participant. On illegal AI output, throw in the default strict mode; in explicit fallback mode, emit `AgentInvalidAction` only through `onDiagnostic` and submit check if legal, otherwise fold. `ScriptedParticipant` shifts from a supplied action queue and throws when exhausted. `runTournament` repeatedly applies a decision and calls the single automatic-advance API until it next needs input or reaches `game-complete`, with a configurable guard defaulting to 20,000 transitions and a diagnostic failure containing seed and a redacted public event tail.

Create two identical scripted tournament runs; in one, each participant consumes 1,000 values from its supplied private decision RNG before returning the same observation-derived legal action. Because actions stay identical, assert the entire authority event stream—including every `DeckPrepared`, deal and burn—is byte-for-byte identical. In a second single-hand pair, change a real agent's equity sample count so decisions may differ, but assert the private `DeckPrepared.fullOrderedDeck` for that hand is identical. Also assert an ordinary same-seed/config/participant run produces an identical full authority event stream.

- [ ] **Step 5: Implement terminal renderer and input loop**

Use `node:readline/promises`, `node:crypto` and—only for an explicitly requested replay path—`node:fs/promises` inside `src/cli`; none may enter common/game modules. Parse `--seed <value>`; when omitted, generate one `randomUUID()` once at startup and print it before any cards so the run can be reproduced. Tests always pass an explicit seed. Default participants are human, hunter, maniac and calling-station with 100 chips and the approved blind schedule. The CLI passes the human seat as `publicViewerSeatIndex`; a null viewer gets a spectator stream with no private deals. The human consumes the same `PlayerObservationV1` and standard `ActionIntent` surface as AI—no extra cards, equity hint, rule modifier or settlement hook. Print every accepted public action, street change, legal reveal, pot award, elimination and final champion exclusively from `onPublicEvents`. Offer an end-of-game private replay file only when the user explicitly supplies `--save-replay <path>`; label its envelope `containsPrivateData: true` because it contains deck and hole-card events.

- [ ] **Step 6: Run controller and CLI verification**

Run: `npm test -- tests/game/tournament-controller.test.ts tests/cli/renderer.test.ts tests/cli/prompts.test.ts tests/integration/default-tournament.test.ts tests/integration/random-isolation.test.ts`

Expected: PASS; the all-scripted default tournament reaches one champion.

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/game/participant.ts src/game/tournament-controller.ts src/cli/renderer.ts src/cli/prompts.ts src/cli/index.ts src/index.ts tests/game/tournament-controller.test.ts tests/cli/renderer.test.ts tests/cli/prompts.test.ts tests/integration/default-tournament.test.ts tests/integration/random-isolation.test.ts
git commit -m "feat: add playable terminal tournament"
```

---

### Task 12: Public exports, browser build, simulation scripts, documentation, and final acceptance

**Files:**
- Create: `src/browser.ts`
- Create: `tsconfig.browser.json`
- Create: `scripts/simulate.ts`
- Create: `scripts/stress.ts`
- Create: `README.md`
- Modify: `package.json`
- Modify: `src/index.ts`
- Test: `tests/integration/browser-import.test.ts`
- Test: `tests/integration/full-acceptance.test.ts`
- Test: `tests/integration/layer-boundaries.test.ts`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: documented package exports, `npm run simulate`, optional `npm run test:stress`, final acceptance evidence.

- [ ] **Step 1: Write failing package-boundary tests**

Browser import test must import `src/browser.ts`, create a fixed-seed 2-player hand, and recursively prove its source dependency graph contains no `node:`, bare Node builtin, `process`, or `Buffer` dependency. `tsconfig.browser.json` extends the strict base but overrides with `files: ["src/browser.ts"]`, `include: []`, `types: []`, and `lib: ["ES2023", "DOM", "DOM.Iterable"]`, so TypeScript follows exactly that entry's transitive graph instead of the base config's CLI/tests/scripts include set. Full acceptance test runs a fixed-seed four-agent tournament to a champion, replays its private event envelope to an identical final state, and checks all invariants.

`layer-boundaries.test.ts` recursively inspects imports and public schemas: `src/core/**` cannot import `src/agents/**`, `src/game/**` or `src/cli/**`; authority state/events cannot contain `characterId`, `StyleProfile`, ability/effect/modifier hooks or private decision trace. Feed the same config, seed, seats and standard action sequence through human-, scripted- and character-labeled participant wrappers and assert byte-identical core events/final stacks. This is the executable V1 proof that the protagonist has no ability and character identity cannot modify rules.

- [ ] **Step 2: Run the new tests and confirm missing exports/scripts**

Run: `npm test -- tests/integration/browser-import.test.ts tests/integration/full-acceptance.test.ts tests/integration/layer-boundaries.test.ts`

Expected: FAIL because browser export and acceptance fixtures are missing.

- [ ] **Step 3: Implement public exports and scripts**

`src/browser.ts` exports core, public-event projection, observation, equity, character, participant and tournament-controller APIs, but never CLI modules or Node-only replay-file/hash helpers. `scripts/simulate.ts` accepts `--seed` and prints champion, hand count, VPIP/PFR/fold-to-bet/pot-or-all-in by character and a SHA-256 hash of canonical private replay JSON. `scripts/stress.ts` accepts `--hands`, defaults to 10,000, distributes hands and the Task 7 stack/blind matrix across 2–6 players and exits nonzero on any invariant failure.

Update `package.json` with:

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./browser": { "types": "./dist/browser.d.ts", "import": "./dist/browser.js" }
  }
}
```

Also add `"check:browser": "tsc -p tsconfig.browser.json --noEmit"`. The static graph test resolves every relative import recursively and rejects Node builtins even if local Node typings could otherwise resolve them.

- [ ] **Step 4: Write user-facing README**

Document Node 22+, `npm install`, `npm test`, `npm run build`, `npm run play -- --seed demo-1`, `npm run simulate -- --seed demo-1`, and optional `npm run test:stress -- --hands 10000`. Explain rules included, V1 non-goals, the four characters, `raiseTo` semantics, public-vs-private events, that saved replay files contain hidden cards, replay determinism limits across version changes, pinned oracle attribution, and that this is fictional-chip entertainment with no cash-out.

- [ ] **Step 5: Run the full automated acceptance suite**

Run: `npm test`

Expected: all tests PASS, including at least 100 randomized rule hands and exact style benchmark thresholds.

Run: `npx --yes node@22 ./node_modules/vitest/vitest.mjs run`

Expected: the complete suite also passes on the currently published Node 22 line, proving the declared minimum rather than only the local Node 26 runtime.

Run: `npm run check`

Expected: exit 0 with no diagnostics.

Run: `npm run check:browser`

Expected: exit 0 without Node globals or builtin imports in the browser graph.

Run: `npm run build`

Expected: exit 0; `dist/index.js`, `dist/browser.js` and matching `.d.ts` files exist.

Run: `npm run simulate -- --seed acceptance-v1`

Expected: exits 0, prints one champion, positive hand count, character statistics and replay hash.

Run: `npm ls --omit=dev --depth=0`

Expected: project root only and no production dependency entries.

- [ ] **Step 6: Run an interactive terminal smoke test**

Run: `npm run play -- --seed human-review-v1`

Expected: player sees only their cards, can complete at least one legal decision on every street reached, AI actions remain legal, and the process can continue to a champion. This proves the operation path works; it does not by itself prove long-term fun or balance. Ask the user to complete one full match before declaring the human-acceptance item satisfied.

- [ ] **Step 7: Inspect the final diff and commit**

Run: `git diff --check`

Expected: no output and exit 0.

```bash
git add src/browser.ts tsconfig.browser.json scripts/simulate.ts scripts/stress.ts README.md package.json package-lock.json src/index.ts tests/integration/browser-import.test.ts tests/integration/full-acceptance.test.ts tests/integration/layer-boundaries.test.ts
git commit -m "docs: finalize holdem engine acceptance path"
```

- [ ] **Step 8: Handoff without overstating acceptance**

Report exact automated command results, the fixed simulation seed, champion, hand count and replay hash. State separately whether the user has personally completed a full terminal match. Do not claim the game is fun, balanced or ready for release based only on automated tests.
