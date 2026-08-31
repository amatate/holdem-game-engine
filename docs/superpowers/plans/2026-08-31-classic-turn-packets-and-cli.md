# 经典回合包与终端叙事 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变经典德州规则、发牌、NPC 随机路径和核心事件流的前提下，将终端改为可暂停的 TurnPacket 交互，并用语义文本块、明确的行动面板和结算表提升可读性。

**Architecture:** 先用固定种子哈希锁定现有 `runTournament()` 结果，再把推进循环抽成仅在 decision / hand-complete / game-complete 边界暂停的 `TournamentDriver`。不透明 `GameSessionHandle` 保存权威状态和交付游标，CLI 只消费递归冻结的 TurnPacket；旧 `runTournament()` 成为 driver 的一次跑到底兼容适配器。

**Tech Stack:** Node.js 22+、TypeScript 7、ESM、Vitest 4、tsx；无新增 runtime dependency。

**Spec:** `docs/superpowers/specs/2026-08-31-turn-packets-and-ability-lab-design.md`

## Global Constraints

- 本计划只实现里程碑 A：经典模式回合包、驱动器、CLI 和结算摘要；不向用户暴露尚未实现的 `ability-lab`。
- `Participant`、`PokerAgent`、`PlayerObservationV1`、`DomainEvent`、`TournamentState`、`ReplayEnvelopeV1` 和 `RULES_VERSION = 'holdem-v1'` 保持不变。
- 相同 config、seats、runSeed 和扑克行动必须生成逐字段相同的核心最终状态、`eventLog`、牌堆和 Agent RNG `agent/<hand>/<seat>/<decision>` 路径。
- 旧 `runTournament()` 保留同一签名、非法 Agent fallback、20,000 事件守卫、逐 transition callback 批次与 `await` 顺序。
- CLI 和未来浏览器只可取得 human-viewer TurnPacket，不得取得 `TournamentState`、`DeckPrepared`、烧牌、runSeed 或 authority callback 负载。
- 行动中不提前声称“主池/边池”；只显示当前桌面投入和人类跟注后最多可争夺额，最终池名仅在核心结算后使用。
- 普通行动作为一个文本块立即输出；新街、摊牌、结算块前分别等待 1,000ms；决策面板立即显示。
- 保留 `createLinePacer` 为兼容 API，新 CLI 不用它逐行播放自动事件。
- 每项生产行为严格执行 red → green → refactor；先运行聚焦测试并确认为预期失败，再做最小实现。
- 一个 Step 内的每个表格行、测试 bullet 和伪造案例都视为独立的 2–5 分钟微步骤：一次只新增一个断言并取得对应 RED，再做最小 GREEN；不得把整组案例一次性写完后才运行。
- 不修改 `sources/`、`AGENTS.md`、不添加浏览器 UI、能力逻辑、角色记忆或新依赖。
- 每个任务只提交其 Files 列表中的文件；提交前运行 focused tests、`npm run check`、`npm run build` 和 `git diff --check`。

---

## File Map

### Driver and compatibility

- `src/game/tournament-driver.ts` (new): 唯一可暂停核心推进器，保留 transition 批次、诊断顺序和 NPC RNG。
- `src/game/tournament-controller.ts`: 将旧 `runTournament()` 改为 driver 兼容适配器。
- `tests/game/classic-controller-golden.test.ts` (new): 重构前经典事件/状态哈希、RNG 和 callback 时序。
- `tests/game/tournament-driver.test.ts` (new): 暂停边界、座位/provider 校验、transition 原子性和继续下一手。
- `tests/game/tournament-controller.test.ts`: 旧控制器 API、fallback 和 viewer callback 回归。

### Packet and session delivery

- `src/game/session-types.ts` (new): 稳定的命令、拒绝码、opaque handle 和交付结果类型。
- `src/game/turn-packet.ts` (new): TurnPacket 判别联合、ActionPanel、决策 key、安全投影和递归冻结。
- `src/game/hand-result.ts` (new): 从 viewer-safe 事件与座位目录纯聚合本手结算表。
- `src/game/game-session.ts` (new): 使用 WeakMap/私有字段的 classic GameSession，管理 pending packet 和两类游标。
- `tests/game/turn-packet.test.ts` (new): 数值语义、命令面板、版本范围、冻结和无别名。
- `tests/game/hand-result.test.ts` (new): 投入、退回、净结果、真边池、牌型和隐藏手牌。
- `tests/game/game-session.test.ts` (new): packetIndex、decisionKey、stale 拒绝、hand-result ack 和 opaque handle。

### CLI presentation

- `src/cli/turn-command.ts` (new): 纯 TurnPacket 命令解析，不执行命令。
- `src/cli/turn-renderer.ts` (new): 决策、事件块、结算表和比赛结果的中文渲染。
- `src/cli/semantic-pacing.ts` (new): `RenderBlock` 与可注入假时钟的播放器。
- `src/cli/index.ts`: 移除 `HumanParticipant`，使用 session packet 循环。
- `src/cli/prompts.ts`: 保留旧 API，新 CLI 改用 `promptForTurnCommand`。
- `src/cli/renderer.ts`: 保留旧渲染 API，新 packet renderer 只复用它的单事件安全文案。
- `tests/cli/turn-command.test.ts` (new)、`tests/cli/turn-renderer.test.ts` (new)、`tests/cli/semantic-pacing.test.ts` (new): 新 CLI 输入、输出和节奏。
- `tests/cli/main.test.ts`、`tests/cli/pacing.test.ts`: 从旧 controller stub 迁移到 session stub，保留 prompt 生命周期。

### Integration and public API

- `src/index.ts`: 仅 named-export 安全的 TurnPacket/session API；不导出 driver authority state helper。
- `tests/integration/classic-turn-session.test.ts` (new): 2 人和 6 人固定会话、回合包范围和核心等价。
- `tests/integration/default-tournament.test.ts`: 旧 `runTournament()` 继续一次跑到冠军。
- `README.md`: 当前源码的回合包终端与经典模式说明。
- `docs/playtests/turn-packets-classic.md` (new): 4 人经典模式人工验收记录。

---

### Task 1: Freeze the current classic controller contract

**Files:**

- Create: `tests/game/classic-controller-golden.test.ts`
- Verify: `tests/game/tournament-controller.test.ts`
- Verify: `tests/integration/default-tournament.test.ts`

**Interfaces:**

- Consumes: 现有 `runTournament(options): Promise<TournamentState>`、`createSeededRandom(seed, path)` 和 `RunTournamentOptions` callbacks。
- Produces: 重构期间不得变化的精确 SHA-256 特征、事件类型序列和 callback 次序。

- [ ] **Step 1: Add the deterministic characterization fixture**

Create a two-seat, one-hand fixture in `tests/game/classic-controller-golden.test.ts` with config `startingStack=2`, blinds `1/2`, seed `classic-driver-golden-v1`; both participants call when possible, then check, then fold. Hash canonical `JSON.stringify` results:

```ts
import { createHash } from 'node:crypto';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

expect(sha256(state)).toBe(
  'd27136aa7fcfa842740d6237a7b46aa15b21e7611861ca4596c0a272ab459631',
);
expect(sha256(state.eventLog)).toBe(
  'd3ea69c1f12366020c60077f741faa0009a068237d7ea67d5bb351bcc17ca341',
);
expect(state.version).toBe(32);
expect(state.seats.map((seat) => seat.stack)).toEqual([4, 0]);
expect(Object.isFrozen(state)).toBe(false);
expect(Object.isFrozen(state.seats)).toBe(false);
expect(Object.isFrozen(state.eventLog)).toBe(false);
```

Also assert the exact event types:

```ts
expect(state.eventLog.map((event) => event.type)).toEqual([
  'GameStarted', 'HandStarted', 'PositionsAssigned', 'BlindPosted', 'BlindPosted',
  'DeckPrepared', 'HoleCardsDealt', 'BettingRoundStarted', 'PlayerActed',
  'HoleCardsRevealed', 'HoleCardsRevealed', 'BettingRoundClosed', 'CardBurned',
  'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed', 'CardBurned',
  'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed', 'CardBurned',
  'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed',
  'ShowdownStarted', 'PotConstructed', 'HandEvaluated', 'HandEvaluated',
  'PotAwarded', 'PlayerEliminated', 'HandCompleted', 'GameCompleted',
]);
```

- [ ] **Step 2: Lock callback batches and RNG paths**

Capture callback operations and decision seed hashes. Assert each authority callback receives exactly one original `TransitionResult.events` batch, is recursively frozen, and completes before the corresponding projected callback. Lock every batch, not only the prefix:

```ts
expect(authorityBatches).toEqual([
  ['GameStarted'],
  ['HandStarted', 'PositionsAssigned', 'BlindPosted', 'BlindPosted', 'DeckPrepared', 'HoleCardsDealt', 'BettingRoundStarted'],
  ['PlayerActed'],
  [
    'HoleCardsRevealed', 'HoleCardsRevealed', 'BettingRoundClosed', 'CardBurned',
    'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed', 'CardBurned',
    'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed', 'CardBurned',
    'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed',
    'ShowdownStarted', 'PotConstructed', 'HandEvaluated', 'HandEvaluated',
    'PotAwarded', 'PlayerEliminated', 'HandCompleted',
  ],
  ['GameCompleted'],
]);
expect(publicBatches).toEqual([
  ['gameStarted'],
  ['handStarted', 'positionsAssigned', 'blindPosted', 'blindPosted', 'ownHoleCardsDealt', 'bettingRoundStarted'],
  ['playerActed'],
  [
    'holeCardsRevealed', 'holeCardsRevealed', 'bettingRoundClosed',
    'communityCardsDealt', 'bettingRoundStarted', 'bettingRoundClosed',
    'communityCardsDealt', 'bettingRoundStarted', 'bettingRoundClosed',
    'communityCardsDealt', 'bettingRoundStarted', 'bettingRoundClosed',
    'showdownStarted', 'potConstructed', 'handEvaluated', 'handEvaluated',
    'potAwarded', 'playerEliminated', 'handCompleted',
  ],
  ['gameCompleted'],
]);
expect(callbackOrder).toEqual([
  'authority:start:0', 'authority:end:0', 'public:start:0', 'public:end:0',
  'authority:start:1', 'authority:end:1', 'public:start:1', 'public:end:1',
  'authority:start:2', 'authority:end:2', 'public:start:2', 'public:end:2',
  'authority:start:3', 'authority:end:3', 'public:start:3', 'public:end:3',
  'authority:start:4', 'authority:end:4', 'public:start:4', 'public:end:4',
]);
expect(decisions[0]).toEqual({
  seatIndex: 0,
  decisionIndex: 0,
  seedHash: createSeededRandom(
    'classic-driver-golden-v1',
    'agent/1/0/0',
  ).seedHash,
});
```

- [ ] **Step 3: Run the characterization gate before refactoring**

Run:

```bash
npm test -- tests/game/classic-controller-golden.test.ts tests/game/tournament-controller.test.ts tests/integration/default-tournament.test.ts
```

Expected: PASS on the pre-refactor controller. This is a characterization gate, not a feature RED; if either hash differs, fix the fixture before touching production code.

- [ ] **Step 4: Commit the baseline only**

```bash
npm run check
npm run build
git diff --check
git add tests/game/classic-controller-golden.test.ts
git commit -m "test: freeze classic tournament behavior"
```

---

### Task 2: Extract the pausable TournamentDriver

**Files:**

- Create: `src/game/tournament-driver.ts`
- Create: `tests/game/tournament-driver.test.ts`

**Interfaces:**

- Consumes: `createTournament`、`startHand`、`startNextHand`、`advanceAutomaticPhases`、`applyIntent`、`projectObservation`、`reduceDomainEvent`、`assertTournamentInvariants`、`Participant`。
- Produces: `createTournamentDriver`、`openTournamentDriver`、`TournamentDriver`、`TournamentDriverOptions`、`PreparedDriverTransition`、`DriverBoundary`、`DriverTransitionBatch`、`DriverActionResult`。
- Does not export from root: `TournamentDriver.getAuthorityState()` and all authority transition hooks.

- [ ] **Step 1: Write the missing-driver RED tests**

Create `tests/game/tournament-driver.test.ts` importing these exact contracts:

```ts
export type DriverBoundary =
  | Readonly<{ kind: 'decision'; seatIndex: number; observation: Readonly<PlayerObservationV1> }>
  | Readonly<{ kind: 'hand-complete'; handNumber: number }>
  | Readonly<{ kind: 'game-complete'; winnerSeatIndex: number }>;

export type DriverTransitionSource =
  | 'automatic'
  | 'npc'
  | 'human-poker'
  | 'ability-swap';

export interface DriverTransitionBatch {
  readonly source: DriverTransitionSource;
  readonly commandIndex: number | null;
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly authorityEvents: readonly DomainEvent[];
}

export interface TournamentDriverOptions {
  readonly config: TournamentConfig;
  readonly runSeed: string;
  readonly seats: readonly TournamentSeatInput[];
  readonly participants: readonly (Participant | null)[];
  readonly pauseSeatIndexes: readonly number[];
  readonly maxTransitions?: number;
  readonly invalidAgentActionMode?: 'throw' | 'fallback';
  readonly onAcceptedTransition?: (
    batch: Readonly<DriverTransitionBatch>,
  ) => void | Promise<void>;
  readonly onDiagnostic?: (
    event: Readonly<ControllerDiagnosticEvent>,
  ) => void | Promise<void>;
}

declare const preparedDriverTransitionBrand: unique symbol;
export interface PreparedDriverTransition {
  readonly [preparedDriverTransitionBrand]: true;
  readonly candidateBoundary: Readonly<DriverBoundary>;
  readonly candidateAuthorityState: Readonly<TournamentState>;
  readonly transitionBatches: readonly Readonly<DriverTransitionBatch>[];
  readonly rejection: Readonly<ActionRejection> | null;
}

export type DriverActionResult =
  | Readonly<{ accepted: true; boundary: Readonly<DriverBoundary> }>
  | Readonly<{ accepted: false; rejection: Readonly<ActionRejection> }>;

export interface TournamentDriver {
  getBoundary(): Readonly<DriverBoundary>;
  getAuthorityState(): Readonly<TournamentState>;
  prepareOpen(): Promise<PreparedDriverTransition>;
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
    prepared: Readonly<PreparedDriverTransition>,
  ): Readonly<DriverBoundary>;
  discardPreparedTransition(
    prepared: Readonly<PreparedDriverTransition>,
  ): void;
  submitPausedAction(
    seatIndex: number,
    intent: Readonly<ActionIntent>,
    commandIndex: number,
  ): Promise<DriverActionResult>;
  continueAfterHand(): Promise<Readonly<DriverBoundary>>;
}

export function createTournamentDriver(
  options: Readonly<TournamentDriverOptions>,
): TournamentDriver;

export function openTournamentDriver(
  options: Readonly<TournamentDriverOptions>,
): Promise<TournamentDriver>;
```

Use full, consecutive seat descriptors and providers `[null, npc]` with `pauseSeatIndexes:[0]`. Assert `createTournamentDriver()` starts uncommitted; `prepareOpen()` reaches seat 0 in its candidate without invoking a provider for seat 0; getters still reject with fixed `Tournament driver is not committed` until the synchronous commit. After commit, the driver invokes every non-paused actor itself.

- [ ] **Step 2: Cover validation, boundaries and transactions**

Add exact scenarios:

```ts
const preparedOpen = await driver.prepareOpen();
expect(preparedOpen.candidateBoundary).toMatchObject({ kind: 'decision', seatIndex: 0 });
expect(preparedOpen.candidateAuthorityState.activeHand?.currentActorSeat).toBe(0);
expect(() => driver.getAuthorityState()).toThrow('Tournament driver is not committed');
driver.commitPreparedTransition(preparedOpen);

const before = structuredClone(driver.getAuthorityState());
const rejected = await driver.preparePausedAction(0, { type: 'check' }, 0);
expect(rejected.rejection).toMatchObject({ code: 'action-not-legal' });
expect(rejected.candidateAuthorityState).toEqual(before);
driver.discardPreparedTransition(rejected);
expect(driver.getAuthorityState()).toEqual(before);
```

Also test:

- mismatched seats/providers length;
- non-contiguous seat indexes;
- duplicate/empty player IDs;
- `null` provider outside the pause set;
- provider playerId not matching the descriptor;
- invalid pause index, duplicate pause index and invalid maxTransitions;
- `preparePausedAction` from the wrong seat or non-decision boundary;
- `prepareContinueAfterHand` from decision/game boundary;
- one `hand-complete` boundary before `startNextHand`, then one `game-complete` boundary;
- `prepareAuthorityTransition` validates a non-negative safe `commandIndex`, accepts exactly one supplied core transition and does not advance NPC/automatic phases; milestone A has no swap event to submit, so plan C must add the accepted `HoleCardReplaced` case and assert the resulting decision boundary is preserved;
- a second prepare while a prepared lease or asynchronous prepare is pending rejects with fixed `Session operation already in progress` and changes no committed state;
- recursive freeze of a detached `structuredClone` used as the public `candidateAuthorityState` read model, plus the candidate boundary and every batch; the private commit record must retain the original, unfrozen candidate state so classic return-value mutability does not change; a forged, foreign-driver or stale prepared object is rejected before mutation;
- prepare/discard does not freeze or change any object reachable from the previously committed state, and a committed/legacy final state has the same `Object.isFrozen` results and property descriptors as the Task 1 baseline;
- `discardPreparedTransition()` releases the active lease and leaves authority state, boundary, event count and revision unchanged;
- convenience `submitPausedAction()` and `continueAfterHand()` execute prepare then immediate commit, returning the legacy result shapes.

- [ ] **Step 3: Capture the expected missing-module RED**

Run:

```bash
npm test -- tests/game/tournament-driver.test.ts
```

Expected: FAIL because `src/game/tournament-driver.ts` does not exist.

- [ ] **Step 4: Implement one-transition acceptance and boundary advancement**

Create `src/game/tournament-driver.ts`. Keep committed state, committed boundary, committed event count, a monotonically increasing committed revision and the active prepared lease private in the returned class/object. A prepared object is only a frozen read model: its unforgeable runtime token and owner/base-revision record live in a module-private `WeakMap<object, PreparedInternal>`, never in an exported property. `PreparedInternal` separately stores the unfrozen `commitState`, `commitBoundary`, event count and revision; the exported `candidateAuthorityState` is a detached structured clone that is recursively frozen for safe inspection. Never deep-freeze `transition.state` itself, because reducers may share references with the old committed state and legacy `runTournament()` did not return a frozen authority object.

`prepareOpen()` starts from the unopened seed, while the other prepare methods start from the committed snapshot. Each prepare takes the single driver busy/lease guard, advances a local candidate to exactly one boundary, validates all core transitions, creates all frozen batches and awaits `onAcceptedTransition` batch-by-batch in original order. It does not replace any committed driver field. A rejected poker intent returns `rejection !== null`, the unchanged candidate state/boundary and no transition batch; callers discard it instead of committing it.

The per-transition candidate algorithm must use a local event count and close both guard holes:

```ts
async function appendCandidateTransition(
  transition: Readonly<TransitionResult>,
  source: DriverTransitionSource,
  commandIndex: number | null,
  draft: CandidateDraft,
): Promise<CandidateDraft> {
  const before = draft.state;
  let candidate = before;
  let candidateEventCount = draft.eventCount;
  for (const event of transition.events) {
    if (candidateEventCount >= maximum) {
      throw safeDriverError('Tournament event guard exceeded');
    }
    candidate = reduceDomainEvent(candidate, event);
    assertTournamentInvariants(candidate);
    candidateEventCount += 1;
  }
  if (candidateEventCount !== transition.state.version) {
    throw safeDriverError('Tournament transition version mismatch');
  }
  if (!sameValue(candidate, transition.state)) {
    throw safeDriverError('Tournament transition replay mismatch');
  }
  const batch = freezeRecursively({
    source,
    commandIndex,
    beforeVersion: before?.version ?? 0,
    afterVersion: transition.state.version,
    authorityEvents: structuredClone(transition.events),
  });
  await options.onAcceptedTransition?.(batch);
  return {
    state: transition.state,
    eventCount: candidateEventCount,
    batches: [...draft.batches, batch],
  };
}
```

Initialization, automatic phases and `startNextHand` use `source:'automatic', commandIndex:null`; Participant decisions use `source:'npc', commandIndex:null`; `preparePausedAction` uses `source:'human-poker'` and its validated command index. Milestone A exposes only the internal driver-level `prepareAuthorityTransition(..., 'ability-swap', commandIndex)` seam for plan C; it implements no ability rule and is not exported from `src/index.ts`.

Advance until exactly one boundary; never continue past `hand-complete` automatically. Project a decision observation from `candidateAuthorityState`, and verify its `decisionIndex` equals the count of current-hand `PlayerActed` events before returning the prepared object. Preserve current malformed Agent snapshot logic, fallback and exact RNG path.

`commitPreparedTransition(prepared)` first performs read-only token/owner/base-revision/current-lease checks. Invalid or stale input is a programmer error that throws fixed `Invalid prepared driver transition` before any mutation. For the valid, currently leased prepared object, every fallible operation has already completed: the method performs no callback, projection, clone, allocation or `await`; it synchronously replaces committed state, boundary, event count and revision from the private record, then releases the lease and returns the already-frozen boundary. The valid commit path cannot throw after replacement starts. `discardPreparedTransition()` synchronously releases only its matching lease and is safe to call in a `catch` before any session commit.

`submitPausedAction()` and `continueAfterHand()` are compatibility conveniences: prepare, return/discard a rejection when applicable, otherwise call `commitPreparedTransition()` immediately. `openTournamentDriver()` is `createTournamentDriver()` followed by `prepareOpen()` and immediate commit. GameSession must use `createTournamentDriver()` and the prepare/commit API instead, so it can validate its own candidate aggregate and packet before the one shared commit point. `prepareAuthorityTransition()` is the exact plan-C extension seam: milestone A implements the same candidate/replay/batch machinery for one supplied transition but has no caller; plan C adds the `HoleCardReplaced` event validation, tags the batch with the supplied command index and verifies it returns at the same decision without automatic or NPC advancement.

- [ ] **Step 5: Prove callback atomicity and diagnostic order**

Add a hook that throws only for the first `human-poker` batch. Assert the prepare Promise rejects, its lease is released, and `getAuthorityState()` remains the pre-action value. Add a callback whose Promise is controlled and assert neither the candidate nor the next transition is observable before it resolves. Add an invalid NPC decision in fallback mode and assert:

```ts
expect(operations).toEqual([
  'diagnostic:AgentInvalidAction',
  'transition:npc:PlayerActed',
]);
```

The fallback `PlayerActed` source remains `npc`; diagnostics are not core events.

Finally prepare an accepted action, assert the driver still exposes the old committed snapshot, commit it, and assert the state/boundary/event count/revision switch together. Run the same assertion for `prepareContinueAfterHand()` so starting the next hand is never committed before its later GameSession packet exists.

- [ ] **Step 6: Run focused GREEN and static checks**

```bash
npm test -- tests/game/tournament-driver.test.ts tests/core/reducer-authority.test.ts tests/core/invariants.test.ts
npm run check
npm run build
git diff --check
```

Expected: all pass; no existing core file changed.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/game/tournament-driver.ts tests/game/tournament-driver.test.ts
git commit -m "feat: add pausable tournament driver"
```

---

### Task 3: Rebuild runTournament as the compatibility adapter

**Files:**

- Modify: `src/game/tournament-controller.ts`
- Modify: `tests/game/tournament-controller.test.ts`
- Verify: `tests/game/classic-controller-golden.test.ts`
- Verify: `tests/integration/default-tournament.test.ts`

**Interfaces:**

- Consumes: `openTournamentDriver()` and `DriverTransitionBatch` from Task 2.
- Produces: the unchanged `RunTournamentOptions` and `runTournament(options): Promise<TournamentState>`.
- Preserves: publicViewerSeatIndex projection and nonempty-only authority/public callbacks.

- [ ] **Step 1: Strengthen callback-order regression before the refactor**

In `tests/game/tournament-controller.test.ts`, make both callbacks asynchronous and block them on controlled Promises. Assert the next callback/Participant invocation does not occur until the current Promise resolves. Assert an empty projected batch does not invoke `onPublicEvents`:

```ts
expect(operations).toEqual([
  'authority:start:GameStarted',
  'authority:end:GameStarted',
  'public:start:gameStarted',
  'public:end:gameStarted',
]);
```

Also pass a negative, fractional and out-of-range `publicViewerSeatIndex` in separate cases. Each must reject with the existing validation error before constructing/opening the driver, invoking a Participant, or invoking either callback; assert both callback operation arrays remain empty.

- [ ] **Step 2: Run the pre-refactor compatibility suite**

```bash
npm test -- tests/game/classic-controller-golden.test.ts tests/game/tournament-controller.test.ts tests/integration/default-tournament.test.ts
```

Expected: PASS. This task is a behavior-preserving refactor, so the same tests must stay green throughout.

- [ ] **Step 3: Replace the duplicated controller loop**

Keep `RunTournamentOptions` unchanged. Run the existing `publicViewerSeatIndex` validation against the participant count first, before constructing the callback closure or opening the driver. Derive seats from participants and use the auto-commit convenience `openTournamentDriver()` with no pauses:

```ts
const driver = await openTournamentDriver({
  config: options.config,
  runSeed: options.runSeed,
  seats: options.participants.map((participant, seatIndex) => ({
    playerId: participant.playerId,
    seatIndex,
  })),
  participants: options.participants,
  pauseSeatIndexes: [],
  ...(options.maxTransitions === undefined ? {} : { maxTransitions: options.maxTransitions }),
  ...(options.invalidAgentActionMode === undefined
    ? {}
    : { invalidAgentActionMode: options.invalidAgentActionMode }),
  ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  onAcceptedTransition: async (batch) => {
    if (batch.authorityEvents.length > 0) {
      await options.onAuthorityEvents?.(batch.authorityEvents);
    }
    const projected = projectEventsForViewer(
      batch.authorityEvents,
      options.publicViewerSeatIndex ?? null,
    );
    if (projected.length > 0) await options.onPublicEvents?.(projected);
  },
});
```

Loop only over `hand-complete` boundaries with `continueAfterHand()`; return `getAuthorityState()` at `game-complete`. A `decision` boundary is impossible with an empty pause set and must throw a fixed internal error.

- [ ] **Step 4: Run golden and full compatibility GREEN**

```bash
npm test -- tests/game/classic-controller-golden.test.ts tests/game/tournament-controller.test.ts tests/integration/default-tournament.test.ts tests/integration/selectable-tournaments.test.ts
npm run check
npm run build
git diff --check
```

Expected: hashes remain exactly `d27136...` and `d3ea69...`; callback and RNG assertions pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/game/tournament-controller.ts tests/game/tournament-controller.test.ts
git commit -m "refactor: run tournaments through the pausable driver"
```

---

### Task 4: Define decision TurnPackets and the action panel

**Files:**

- Create: `src/game/turn-packet.ts`
- Create: `tests/game/turn-packet.test.ts`

**Interfaces:**

- Consumes: `PlayerObservationV1`, `PublicGameEvent`, `projectEventsForViewer` and a driver decision boundary.
- Produces: `PacketBase`, `ClassicDecisionPacket`, `TurnPacket`, `ActionPanel`, `RenderableCommand`, `createDecisionKey`, `buildActionPanel`, `createClassicDecisionPacket`.
- Later tasks extend `TurnPacket` with hand/game result variants but do not rename fields introduced here.

- [ ] **Step 1: Write exact action-panel RED cases**

Create authentic `PlayerObservationV1` fixtures and assert:

```ts
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

expect(buildActionPanel(normalCall)).toEqual({
  currentBetTo: 20,
  facingBet: true,
  tableCommittedTotal: 50,
  heroContestableTotal: 60,
  commands: [
    { kind: 'fixed', inputs: ['f'], label: '弃牌', intent: { type: 'fold' } },
    { kind: 'fixed', inputs: ['c'], label: '跟注 10', intent: { type: 'call' } },
    { kind: 'raise-range', inputPattern: 'r <金额>', label: '加注到', minimum: 40, maximum: 100 },
    { kind: 'fixed', inputs: ['a'], label: '全下 100', intent: { type: 'allIn' } },
  ],
});
```

Lock the three contribution examples:

```ts
expect(buildActionPanel(observationWith([10, 20, 20], 10)).heroContestableTotal).toBe(60);
expect(buildActionPanel(observationWith([10, 200, 200], 90)).heroContestableTotal).toBe(300);
expect(buildActionPanel(observationWith([50, 100, 200, 200], 50)).heroContestableTotal).toBe(400);
```

Also assert check uses inputs `['x','c']`; a call-mode all-in produces only `c 跟注 N（全下）` and no `a`. Derive `currentBetTo` as the maximum `committedStreet` among every dense seat, never as the short actor's call destination. Lock a short all-in fixture where the actor can move only from 10 to 100 while an opponent has 200 committed and assert `currentBetTo === 200`, `call.pay === 90` and the label is `跟注 90（全下）`.

- [ ] **Step 2: Write packet range, privacy and freeze RED cases**

Define the initial types:

```ts
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
```

Assert decision key `hand/3/seat/0/decision/4`, half-open range `[from,to)`, safe human projection, deep freeze, fresh object identity and no strings `fullOrderedDeck`, `runSeed`, `burnedCards` or opponent hidden cards in serialized output. `PlayerObservationV1.handId` is an existing viewer-safe observation field and remains present.

Add a compile-time assertion that `ClassicDecisionPacket['privateEventsSinceLastPacket']` is exactly `readonly []`. The generic exists only so Plan B can define an ability decision variant with private notices; it must never widen the classic decision or classic hand/game result types.

- [ ] **Step 3: Run the missing-module RED**

```bash
npm test -- tests/game/turn-packet.test.ts
```

Expected: FAIL because `src/game/turn-packet.ts` does not exist.

- [ ] **Step 4: Implement pure packet projection**

Implement dense-index cloning; do not call authority-owned `map/filter/iterator` methods. Use this exact builder boundary so GameSession can build from an uncommitted driver candidate:

```ts
export interface ClassicDecisionPacketInput {
  readonly state: Readonly<TournamentState>;
  readonly boundary: Readonly<Extract<DriverBoundary, { kind: 'decision' }>>;
  readonly humanSeatIndex: number;
  readonly packetIndex: number;
  readonly fromCoreVersion: number;
}

export function createClassicDecisionPacket(
  input: Readonly<ClassicDecisionPacketInput>,
): Readonly<ClassicDecisionPacket>;
```

Validate `fromCoreVersion <= state.version`, require the boundary seat/observation to match `humanSeatIndex` and the candidate state, slice the core log by numeric index, project it for `humanSeatIndex`, clone the already-safe observation, build the panel and recursively freeze the result. Reject malformed values with fixed `Invalid turn packet data`; never serialize the input in errors.

Use this exact contestable formula, implemented with dense numeric loops rather than authority-owned array methods:

```ts
const callPay = observation.legalActions.call?.pay ?? 0;
const hero = observation.seats[observation.actorSeatIndex]!;
const contestCap = hero.committedHand + callPay;
let currentBetTo = 0;
let tableCommittedTotal = 0;
let heroContestableTotal = callPay;
for (let index = 0; index < observation.seats.length; index += 1) {
  if (!Object.hasOwn(observation.seats, index)) throw new Error('Invalid turn packet data');
  const seat = observation.seats[index]!;
  currentBetTo = Math.max(currentBetTo, seat.committedStreet);
  tableCommittedTotal += seat.committedHand;
  heroContestableTotal += Math.min(seat.committedHand, contestCap);
}
```

- [ ] **Step 5: Run focused GREEN and commit**

```bash
npm test -- tests/game/turn-packet.test.ts tests/agents/hidden-information.test.ts tests/agents/observation.test.ts
npm run check
npm run build
git diff --check
git add src/game/turn-packet.ts tests/game/turn-packet.test.ts
git commit -m "feat: project classic decision packets"
```

---

### Task 5: Aggregate safe hand-result summaries

**Files:**

- Create: `src/game/hand-result.ts`
- Create: `tests/game/hand-result.test.ts`
- Modify: `src/game/turn-packet.ts`
- Modify: `tests/game/turn-packet.test.ts`

**Interfaces:**

- Consumes: physical seat descriptors and the complete current-hand `PublicGameEvent[]` projected for the human viewer, from that hand's `handStarted` through `handCompleted`; it must not use only the latest packet increment.
- Produces: `HandSeatResult`, `HandResultPot`, `HandResultSummary`, `buildHandResultSummary`, `HandResultPacket`, `GameResultPacket`.
- Security rule: never read authority `SeatState.holeCards` to fill an unrevealed NPC row.

- [ ] **Step 1: Write an exact main/side/refund summary RED**

Define the complete summary contract before the fixture:

```ts
export interface HandSeatResult {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly holeCards: readonly [Card, Card] | null;
  readonly category: HandCategory | null;
  readonly bestFive: readonly Card[] | null;
  readonly potWon: number;
  readonly invested: number;
  readonly returned: number;
  readonly net: number;
  readonly finalStack: number;
}

export interface HandResultPot {
  readonly potId: string;
  readonly label: '底池' | '主池' | `边池 ${number}`;
  readonly amount: number;
  readonly eligibleSeatIndexes: readonly number[];
  readonly winnerSeatIndexes: readonly number[];
  readonly awards: readonly number[];
}

export interface HandResultSummary {
  readonly handNumber: number;
  readonly seats: readonly Readonly<HandSeatResult>[];
  readonly pots: readonly Readonly<HandResultPot>[];
}

export function buildHandResultSummary(
  seats: readonly TournamentSeatInput[],
  viewerEvents: readonly PublicGameEvent[],
): Readonly<HandResultSummary>;
```

Use a three-seat safe event stream with blind/action payments, own cards, two revealed NPC hands, two `potConstructed` events with different eligibility, two awards, one refund, evaluations and `handCompleted`. Assert:

```ts
expect(summary.seats).toEqual([
  expect.objectContaining({ seatIndex: 0, invested: 100, returned: 0, potWon: 150, net: 50 }),
  expect.objectContaining({ seatIndex: 1, invested: 200, returned: 50, potWon: 0, net: -150 }),
  expect.objectContaining({ seatIndex: 2, invested: 200, returned: 0, potWon: 300, net: 100 }),
]);
expect(summary.pots.map(({ label, amount }) => ({ label, amount }))).toEqual([
  { label: '主池', amount: 150 },
  { label: '边池 1', amount: 300 },
]);
```

Use an independent one-pot fixture and assert its label is `底池`, not `主池`.

- [ ] **Step 2: Cover hand visibility and arithmetic authority**

Assert:

- `invested = blindPosted.amount + playerActed.paid` for that seat;
- `returned` sums `uncalledBetReturned`;
- `potWon` sums the parallel `potAwarded.winners/amounts` entries;
- `net = potWon + returned - invested`;
- human own cards remain visible after fold;
- an NPC without `holeCardsRevealed` has `holeCards/category/bestFive = null`;
- an evaluated revealed seat uses authoritative category and exactly five best cards;
- duplicate pot IDs, an award before construction, mismatched winners/amounts, missing `handCompleted`, unsafe integers and malformed arrays fail closed;
- input events remain mutable/unfrozen and unchanged while the output is independently deep-frozen.

- [ ] **Step 3: Run the missing-module RED**

```bash
npm test -- tests/game/hand-result.test.ts tests/game/turn-packet.test.ts
```

Expected: FAIL on missing `hand-result.ts` and missing packet variants.

- [ ] **Step 4: Implement the one-pass safe aggregator**

Define final packet variants:

```ts
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

export type TurnPacket = ClassicDecisionPacket | HandResultPacket | GameResultPacket;

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

export function createClassicHandResultPacket(
  input: Readonly<HandResultPacketInput>,
): Readonly<HandResultPacket>;

export function createClassicGameResultPacket(
  input: Readonly<GameResultPacketInput>,
): Readonly<GameResultPacket>;
```

Scan dense arrays by numeric index, build maps owned by the function and copy canonical cards. Pair each award with the previously constructed pot. If there is one pot label it `底池`; if there are multiple, label index 0 `主池` and later indexes `边池 1..N`. Do not reconstruct contribution layers from current stacks.

All three packet builders accept an explicit candidate `state` and candidate `boundary`; none reads `driver.getAuthorityState()`. This is required for Task 6's pre-commit candidate construction. Each validates the boundary against that candidate, projects the delivery increment `[fromCoreVersion, state.version)` and returns an independently recursive-frozen packet.

When GameSession reaches a hand-complete boundary, locate the current hand's full core-event interval by authoritative handId, project that entire interval once for `humanSeatIndex`, and pass the resulting safe events as `currentHandViewerEvents`. `createClassicHandResultPacket()` verifies that interval begins with the matching `handStarted` and ends with `handCompleted`. `viewerEventsSinceLastPacket` remains only the delivery increment; the two arrays have different responsibilities and must not share a cursor.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- tests/game/hand-result.test.ts tests/game/turn-packet.test.ts tests/core/pots.test.ts tests/core/odd-chips.test.ts
npm run check
npm run build
git diff --check
git add src/game/hand-result.ts src/game/turn-packet.ts tests/game/hand-result.test.ts tests/game/turn-packet.test.ts
git commit -m "feat: summarize completed poker hands"
```

---

### Task 6: Implement the opaque classic GameSession

**Files:**

- Create: `src/game/session-types.ts`
- Create: `src/game/game-session.ts`
- Create: `tests/game/game-session.test.ts`
- Modify: `src/game/turn-packet.ts`

**Interfaces:**

- Consumes: `createTournamentDriver`, the prepared-transition API, all three `DriverBoundary` variants, packet builders and hand summary builder.
- Produces: `GameSessionHandle`, `OpenGameSessionOptions`, `SessionCommand`, `SessionStep`, `SessionCommandResult`, `SessionContinueResult`, `openGameSession`, `getCurrentPacket`, `submitSessionCommand`, `continueAfterHandResult`.
- This task supports only `mode:'classic'`; Task B widens the option type and adds private events without changing these function names.

- [ ] **Step 1: Write opaque-handle and delivery RED tests**

Define these initial public types:

```ts
declare const gameSessionHandleBrand: unique symbol;
export interface GameSessionHandle {
  readonly [gameSessionHandleBrand]: true;
}

export interface OpenGameSessionOptions {
  readonly mode: 'classic';
  readonly config: TournamentConfig;
  readonly runSeed: string;
  readonly humanSeatIndex: number;
  readonly seats: readonly TournamentSeatInput[];
  readonly participants: readonly (Participant | null)[];
  readonly maxTransitions?: number;
  readonly invalidAgentActionMode?: 'throw' | 'fallback';
  readonly onDiagnostic?: (event: Readonly<ControllerDiagnosticEvent>) => void | Promise<void>;
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

export interface SessionStep {
  readonly handle: GameSessionHandle;
  readonly packet: Readonly<TurnPacket>;
}

export type SessionCommandResult =
  | Readonly<{ accepted: true; step: SessionStep }>
  | Readonly<{
      accepted: false;
      handle: GameSessionHandle;
      rejection: AbilityRejectionCode | ActionRejectionCode;
      packet: Readonly<TurnPacket>;
    }>;

export type SessionContinueResult =
  | Readonly<{ accepted: true; step: SessionStep }>
  | Readonly<{
      accepted: false;
      handle: GameSessionHandle;
      rejection: 'stale-packet' | 'wrong-boundary';
      packet: Readonly<TurnPacket>;
    }>;

export function openGameSession(
  options: Readonly<OpenGameSessionOptions>,
): Promise<Readonly<SessionStep>>;

export function getCurrentPacket(
  handle: GameSessionHandle,
): Readonly<TurnPacket>;

export function submitSessionCommand(
  handle: GameSessionHandle,
  command: Readonly<SessionCommand>,
): Promise<SessionCommandResult>;

export function continueAfterHandResult(
  handle: GameSessionHandle,
  packetIndex: number,
): Promise<SessionContinueResult>;
```

Open a real heads-up session and assert:

```ts
const first = await openGameSession(options);
expect(first.packet).toMatchObject({ kind: 'decision', packetIndex: 0 });
expect(getCurrentPacket(first.handle)).toBe(first.packet);
expect(Object.keys(first.handle)).toEqual([]);
expect(Reflect.ownKeys(first.handle)).toEqual([]);
expect(Object.getOwnPropertyDescriptors(first.handle)).toEqual({});
expect(JSON.stringify(first.handle)).toBe('{}');
expect(JSON.stringify(first.packet)).not.toMatch(/runSeed|fullOrderedDeck|burnedCards/);
```

Also assert `openGameSession`, `submitSessionCommand` and `continueAfterHandResult` each return a Promise; `getCurrentPacket` alone returns synchronously. A plain object, proxy and object copied from a valid handle all fail with `Invalid game session handle`; the failure path must not enumerate, serialize or otherwise reflect the supplied value.

- [ ] **Step 2: Cover command identity and hand acknowledgement**

Use the final command union now, even though abilities always reject in classic:

```ts
export type SessionCommand =
  | Readonly<{
      type: 'act';
      decisionKey: string;
      expectedPacketIndex: number;
      intent: ActionIntent;
    }>
  | Readonly<{
      type: 'useAbility';
      decisionKey: string;
      expectedPacketIndex: number;
      ability: 'peek';
      targetSeatIndex: number;
    }>
  | Readonly<{
      type: 'useAbility';
      decisionKey: string;
      expectedPacketIndex: number;
      ability: 'read';
      targetSeatIndex: number;
    }>
  | Readonly<{
      type: 'useAbility';
      decisionKey: string;
      expectedPacketIndex: number;
      ability: 'swap';
      holeCardIndex: 0 | 1;
    }>;
```

Assert:

- accepted action consumes packet 0 and creates packet 1;
- wrong decisionKey returns `stale-decision` and the same packet object;
- correct decisionKey with old packet index returns `stale-packet`;
- when packet index and decisionKey are both stale, packet identity wins and returns `stale-packet`;
- all three ability commands return `wrong-mode`, no new packet and no core version change;
- illegal poker action returns its exact `ActionRejectionCode` and identical packet;
- a hand-result remains pending until `continueAfterHandResult(handle, packetIndex)`;
- duplicate/stale continue is pure;
- continue on decision/game returns `wrong-boundary`;
- the packet following acknowledgement is next-hand decision or game-result;
- invalid/forged handles fail with fixed `Invalid game session handle` without reflecting properties.

Use a hoisted Vitest module wrapper around the real `createTournamentDriver()` to record its input, returned real driver, `preparePausedAction` command indexes and `onAcceptedTransition` batches. This is a test-only observation seam; do not add an authority accessor to the safe session API:

```ts
const capture = vi.hoisted(() => ({
  commandIndexes: [] as number[],
  batches: [] as DriverTransitionBatch[],
  drivers: [] as TournamentDriver[],
}));

vi.mock('../../src/game/tournament-driver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/game/tournament-driver.js')>();
  return {
    ...actual,
    createTournamentDriver(options: Readonly<TournamentDriverOptions>) {
      const real = actual.createTournamentDriver({
        ...options,
        onAcceptedTransition: async (batch) => {
          capture.batches.push(batch);
          await options.onAcceptedTransition?.(batch);
        },
      });
      capture.drivers.push(real);
      return new Proxy(real, {
        get(target, property) {
          if (property !== 'preparePausedAction') {
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return async (seatIndex: number, intent: Readonly<ActionIntent>, commandIndex: number) => {
            capture.commandIndexes.push(commandIndex);
            return target.preparePausedAction(seatIndex, intent, commandIndex);
          };
        },
      });
    },
  };
});
```

Drive reject → accept → reject → accept and assert `capture.commandIndexes` is `[0, 0, 1, 1]` while the accepted `human-poker` batches are exactly `[0, 1]`; every captured `automatic`/`npc` batch has `commandIndex:null`. This directly locks the meaning of `acceptedCommandIndex`: read current `N` for an attempted human action, record/increment it only if that command and its successor packet commit successfully. Classic ability rejections, illegal poker actions, stale commands, NPC actions, automatic transitions and hand-result acknowledgement never increment it.

- [ ] **Step 3: Run the missing-module RED**

```bash
npm test -- tests/game/game-session.test.ts
```

Expected: FAIL because `session-types.ts` and `game-session.ts` do not exist.

- [ ] **Step 4: Implement a module-private aggregate and cursors**

Use a module-private WeakMap plus a separate WeakSet guard; never encode transient busy state into the immutable aggregate:

```ts
interface ClassicAggregate {
  readonly driver: TournamentDriver;
  readonly seats: readonly TournamentSeatInput[];
  readonly humanSeatIndex: number;
  readonly acceptedCommandIndex: number;
  readonly nextPacketIndex: number;
  readonly deliveredCoreVersion: number;
  readonly pendingPacket: Readonly<TurnPacket>;
}

const sessions = new WeakMap<object, ClassicAggregate>();
const activeSessionOperations = new WeakSet<object>();
```

Validate `humanSeatIndex`, derive the single pause set, require its provider to be null and every other provider to match its seat. The runtime handle is a frozen empty object used only as a WeakMap key; the TypeScript brand is declared but no brand symbol is installed at runtime. Do not store authority state as a handle property. Initialize `acceptedCommandIndex = 0`, `nextPacketIndex = 0` and `deliveredCoreVersion = 0`. Build each packet from `[deliveredCoreVersion, prepared.candidateAuthorityState.version)` and advance the cursor to that exact right edge only in the candidate aggregate.

All async entry points acquire `activeSessionOperations` before invoking a Participant/driver and release it in `finally`; a second operation rejects with fixed `Session operation already in progress`. Synchronous `getCurrentPacket()` remains a pure WeakMap lookup and can return the existing frozen object during an async operation.

Use the same atomic sequence for open, an accepted poker action and hand-result acknowledgement:

1. Snapshot the current aggregate (or an uncommitted initial aggregate), then call respectively `prepareOpen()`, `preparePausedAction(..., N)` or `prepareContinueAfterHand()` under the one guard.
2. If a poker prepare has `rejection !== null`, call `discardPreparedTransition(prepared)` and return the unchanged handle and exact pending packet.
3. From `prepared.candidateAuthorityState` and `prepared.candidateBoundary`, locate/project the full hand interval if required, construct the new packet, validate its range/index/freeze invariants and construct the complete candidate aggregate. No builder may read the committed driver getter.
4. Only after all awaited hooks, NPC work, projection, summary construction and validation have succeeded, enter one non-async commit function:

```ts
function commitSessionCandidate(
  handle: object,
  previous: ClassicAggregate | undefined,
  prepared: Readonly<PreparedDriverTransition>,
  candidate: ClassicAggregate,
  step: Readonly<SessionStep>,
): Readonly<SessionStep> {
  if (sessions.get(handle) !== previous) {
    throw new Error('Session candidate is stale');
  }
  // From here to return: no await, callback, clone, validation or allocation.
  candidate.driver.commitPreparedTransition(prepared);
  sessions.set(handle, candidate);
  return step;
}
```

Construct and freeze `step = { handle, packet: candidate.pendingPacket }` before entering that final section so even the return object cannot fail after the driver swap. The valid `commitPreparedTransition` path and `sessions.set` use prevalidated objects and execute as one non-await critical section. If any work before that point throws, call `discardPreparedTransition(prepared)` in `catch/finally`; the driver's committed state and the WeakMap aggregate both remain byte-for-byte unchanged. Hand-result acknowledgement follows this exact path, so the next hand cannot become committed if its next packet fails to build.

Malformed commands fail closed before prepare without reflecting or serializing the raw value. For a structurally valid `useAbility` command, rejection precedence is: classic mode → `wrong-mode`; then, for the later ability-lab implementation, non-decision/human boundary → `not-human-turn`; wrong `expectedPacketIndex` → `stale-packet`; wrong `decisionKey` → `stale-decision`; charge/lock/ability-specific validation. For a structurally valid `act` command, use non-decision boundary → `not-human-turn`, then packet index, then decision key, then poker legality. Rejections always return the same handle and pending packet object. Add simultaneous-stale assertions so `stale-packet` wins over `stale-decision`; a valid classic ability returns `wrong-mode` even if submitted while a result packet is pending.

Add fault-injection tests that make each packet builder throw after a successful `preparePausedAction()` and after a successful `prepareContinueAfterHand()`. In both cases assert the Promise rejects, `getCurrentPacket()` is the identical old object, the captured real driver's committed state/version/eventLog are unchanged, the guard/lease are released, and retry succeeds. After the failed action build, retry must reuse command index `0`; only its successful commit changes the next accepted action to index `1`. Add the analogous open failure: the captured driver remains uncommitted and no handle is returned.

- [ ] **Step 5: Run session and privacy GREEN**

```bash
npm test -- tests/game/game-session.test.ts tests/game/turn-packet.test.ts tests/game/hand-result.test.ts tests/agents/hidden-information.test.ts
npm run check
npm run build
git diff --check
```

- [ ] **Step 6: Commit Task 6**

```bash
git add src/game/session-types.ts src/game/game-session.ts src/game/turn-packet.ts tests/game/game-session.test.ts
git commit -m "feat: add opaque classic game sessions"
```

---

### Task 7: Add packet commands, semantic rendering and block pacing

**Files:**

- Create: `src/cli/turn-command.ts`
- Create: `src/cli/turn-renderer.ts`
- Create: `src/cli/semantic-pacing.ts`
- Create: `tests/cli/turn-command.test.ts`
- Create: `tests/cli/turn-renderer.test.ts`
- Create: `tests/cli/semantic-pacing.test.ts`
- Verify: `src/cli/prompts.ts`
- Verify: `src/cli/renderer.ts`
- Verify: `src/cli/pacing.ts`

**Interfaces:**

- Consumes: `TurnPacket`, `RenderableCommand`, `SessionCommand`, existing `renderPublicEvent` and injected `write/sleep` functions.
- Produces: `parseTurnCommand`, `promptForTurnCommand`, `renderTurnPacket`, `renderSessionRejection`, `RenderBlock`, `playRenderBlocks`.
- Preserves: old prompt/renderer/line-pacer exports and tests.

- [ ] **Step 1: Write pure command parser RED cases**

Use:

```ts
export type TurnCommandParseResult =
  | Readonly<{ ok: true; command: Readonly<SessionCommand> }>
  | Readonly<{ ok: false; message: string }>;

export function parseTurnCommand(
  input: string,
  packet: Readonly<Extract<TurnPacket, { kind: 'decision' }>>,
): TurnCommandParseResult;

export function promptForTurnCommand(
  packet: Readonly<Extract<TurnPacket, { kind: 'decision' }>>,
  io: Readonly<PromptIO>,
): Promise<Readonly<SessionCommand>>;
```

Assert `f`, `x`, `c`, `r 12`, `a` produce commands carrying the packet decisionKey/index. When check is legal, `c` aliases check; when call is legal, it means call. A call-all-in has only `c`. Facing a bet, `x` returns exactly `当前不能过牌，请跟注或弃牌。`. Reject decimals, signs, unsafe integers, extra tokens and out-of-range raises without creating a command.

Parse `u peek 2` and `u read 3` with their safe-integer target seats; map CLI `u swap 1`/`u swap 2` to domain `holeCardIndex:0/1`. Reject every other swap index and malformed/extra ability token. Produce these typed commands even in classic; GameSession, not the parser, returns `wrong-mode`.

- [ ] **Step 2: Write renderer and pacing RED cases**

Define:

```ts
export interface RenderBlock {
  readonly kind: 'ordinary-actions' | 'street-reveal' | 'showdown' | 'settlement' | 'decision';
  readonly delayBeforeMs: 0 | 1000;
  readonly text: string;
}

export interface SemanticPacingRuntime {
  readonly write: (message: string) => void;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export function renderTurnPacket(
  packet: Readonly<TurnPacket>,
): readonly Readonly<RenderBlock>[];

export function playRenderBlocks(
  blocks: readonly Readonly<RenderBlock>[],
  runtime: Readonly<SemanticPacingRuntime>,
): Promise<void>;

export function renderSessionRejection(
  rejection: AbilityRejectionCode | ActionRejectionCode,
): string;
```

Assert one packet containing two NPC actions yields one `ordinary-actions` block with both lines and no delay between them. Flop/turn/river each begin a `street-reveal` block with 1,000ms; showdown and settlement each begin their own 1,000ms block; decision is last with 0ms. Settlement renders only the aggregated table, not raw `PotConstructed` / `PotAwarded` duplicates.

Lock the decision block as a complete table snapshot, not only an action footer. For the authentic turn fixture assert it contains all of: `第 3 手｜转牌`、`你的手牌：A♥ K♦`、the four public cards、`盲注：2/4`、button/SB/BB seat positions、every physical seat's player name/stack/status/`本轮下注`/`本手累计投入`、`当前桌面投入`、`跟注后你最多可争夺` and every legal command. Assert an eliminated seat remains visible at its physical seat, while no opponent hidden card, authority handId, deck, burn card or runSeed appears.

Use fake operations:

```ts
expect(operations).toEqual([
  'write:座位 1 过牌。\n座位 2 过牌。',
  'wait:1000',
  'write:翻牌：7♠ 3♥ 2♥。',
  'write:当前桌面投入 6；你当前可争夺 6。\n操作：x/c 过牌 | r 4-100 下注到 | a 全下 100',
]);
```

For a fixed two-pot `HandResultPacket`, lock the complete settlement block—not just the header—and the absence of raw settlement duplicates:

```text
第 4 手结算
玩家 | 手牌 | 牌型 | 赢得底池 | 本手投入 | 退回 | 净结果
你 | K♠ 3♣ | 一对3（K♠ 7♠ 3♥ 3♣ Q♣） | 1755 | 585 | 0 | +1170
Morgan | 9♣ 2♠ | 一对2（9♣ 7♠ 3♥ 2♠ Q♣） | 466 | 818 | 0 | -352
主池 1755：你 1755
边池 1 466：Morgan 466
结论：你赢得 1755；Morgan 赢得 466。
```

Assert the table has exactly one row per `handResult.seats` entry; unrevealed cards/category render `—`; `bestFive` appears only with a category; each pot line preserves parallel `winnerSeatIndexes[i]`/`awards[i]`; split-pot winners all appear; and the conclusion sums `potWon` by seat. The settlement block must contain none of `形成底池`、`底池发给`、`本手结束` raw-event duplicates. A `game-result` packet is one `ordinary-actions` block with `delayBeforeMs:0` because the preceding settlement already owns the 1,000ms pause.

- [ ] **Step 3: Run missing-module RED**

```bash
npm test -- tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/cli/semantic-pacing.test.ts
```

Expected: all three suites fail on missing modules.

- [ ] **Step 4: Implement parser and semantic block renderer**

For poker inputs (`f/x/c/r/a`), the parser reads only `packet.actionPanel.commands`; it must not rebuild legality from display text. The `u peek/read/swap` grammar is parsed independently into a typed command because abilities are not poker actions and classic `actionPanel` intentionally contains none; GameSession remains the only mode/charge/target authority. `promptForTurnCommand` loops over `PromptIO.question('请选择操作（f/x/c/r <加注到>/a）：')`, writes the safe parser message and returns only an `ok:true` command. It never prints or advertises an ability command in classic mode.

`renderTurnPacket` groups viewer events by semantic boundary. Reuse `renderPublicEvent` one event at a time, but suppress raw settlement event lines once `handResult` exists. Build the decision block field-by-field from the frozen `PlayerObservationV1` and append the new action-panel footer; do not reuse the existing `renderTable()` as a whole because it labels `potTotal/sidePots` before settlement. Shared card/seat formatting helpers are allowed, but the decision block must not contain `底池`、`主池` or `边池`. It must always include the full hand/street, hero cards, board, positions/blinds, all physical seats and their public stack/status/contributions before the following exact monetary lines:

```text
当前桌面投入 410；跟注 90 后你最多可争夺 300。
操作：f 弃牌 | c 跟注 90（全下）
```

`renderSessionRejection('wrong-mode')` returns exactly `经典模式不能使用能力。`; give every remaining union member an explicit safe Chinese mapping and use an exhaustive `never` check. `playRenderBlocks` waits only when `delayBeforeMs > 0`, then emits the whole block once. It does not carry timing state across unrelated packets.

- [ ] **Step 5: Run GREEN plus legacy render regressions**

```bash
npm test -- tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/cli/semantic-pacing.test.ts tests/cli/prompts.test.ts tests/cli/renderer.test.ts tests/cli/pacing.test.ts
npm run check
npm run build
git diff --check
```

- [ ] **Step 6: Commit Task 7**

```bash
git add src/cli/turn-command.ts src/cli/turn-renderer.ts src/cli/semantic-pacing.ts tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/cli/semantic-pacing.test.ts
git commit -m "feat: render semantically paced poker turns"
```

---

### Task 8: Switch the terminal entry point to classic GameSession

**Files:**

- Modify: `src/cli/index.ts`
- Modify: `tests/cli/main.test.ts`
- Modify: `tests/cli/pacing.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: session open/get/submit/continue APIs, turn command prompt, renderer and semantic block player.
- Produces: `main(argv, runtime): Promise<Readonly<GameResultPacket>>` and a `CliRuntime` containing injectable session functions rather than authority `runTournament`.
- Root exports: safe packet/session types and operations only; no `TournamentDriver`, `getAuthorityState` or authority event hook.

- [ ] **Step 1: Rewrite CLI composition tests before production**

Define runtime seams:

```ts
export interface CliRuntime {
  write(message: string): void;
  sleep(milliseconds: number): Promise<void>;
  randomUUID(): string;
  createPrompt(): CliPrompt | Promise<CliPrompt>;
  openGameSession: typeof openGameSession;
  submitSessionCommand: typeof submitSessionCommand;
  continueAfterHandResult: typeof continueAfterHandResult;
}
```

Replace fabricated `TournamentState` fixtures with frozen decision/hand/game TurnPackets. Assert six selected seats use descriptors `你` + the deterministic roster, provider 0 is `null`, other providers match seat IDs, `mode:'classic'`, and only one prompt is created/closed.

The CLI may print `options.seed` because it already owns that launch input; assert the value never comes from a TurnPacket/session return. Assert neither help, startup text, decision text nor prompt advertises `ability-lab`, `u peek`, `u read` or `u swap`. Milestone A always calls `openGameSession` with `mode:'classic'` and offers no mode selector.

Assert operation order:

```ts
expect(operations).toEqual([
  'write:本局种子：fixed-seed',
  'write:本桌对手：座位 1 老周“岩石”｜座位 2 林岚“猎手”｜座位 3 阿凯“疯狗”｜座位 4 苏蔓“伏蛇”｜座位 5 韩烈“重锤”',
  'session:open',
  'write:decision',
  'prompt:question',
  'session:submit',
  'wait:1000',
  'write:settlement',
  'session:continue',
  'write:game-result',
  'prompt:close',
]);
```

- [ ] **Step 2: Run CLI RED**

```bash
npm test -- tests/cli/main.test.ts tests/cli/pacing.test.ts
```

Expected: FAIL because `CliRuntime` still requires `runTournament` and `main` still creates `HumanParticipant`.

- [ ] **Step 3: Implement the packet loop**

Keep existing `--players` / `--seed` parsing unchanged in this plan. Build seat descriptors separately from providers:

```ts
const seats = [
  { playerId: '你', seatIndex: 0 },
  ...npcIds.map((id, index) => ({
    playerId: createCharacterParticipant(id).playerId,
    seatIndex: index + 1,
  })),
];
const participants = [
  null,
  ...npcIds.map((id) => createCharacterParticipant(id)),
];
```

Open classic session and loop by packet kind:

```ts
if (packet.kind === 'decision') {
  await playRenderBlocks(renderTurnPacket(packet), runtime);
  const command = await promptForTurnCommand(packet, prompt);
  const result = await runtime.submitSessionCommand(handle, command);
  if (!result.accepted) {
    prompt.write(renderSessionRejection(result.rejection));
    packet = result.packet;
  } else {
    ({ handle, packet } = result.step);
  }
} else if (packet.kind === 'hand-result') {
  await playRenderBlocks(renderTurnPacket(packet), runtime);
  const continued = await runtime.continueAfterHandResult(handle, packet.packetIndex);
  if (!continued.accepted) throw new Error('Session rejected its current hand result');
  ({ handle, packet } = continued.step);
} else {
  await playRenderBlocks(renderTurnPacket(packet), runtime);
  return packet;
}
```

No CLI branch may inspect authority state. Keep prompt close in `finally`.

- [ ] **Step 4: Restrict the root export surface**

In `src/index.ts`, named-export:

```ts
export {
  openGameSession,
  getCurrentPacket,
  submitSessionCommand,
  continueAfterHandResult,
} from './game/game-session.js';
export type {
  AbilityRejectionCode,
  GameSessionHandle,
  OpenGameSessionOptions,
  SessionCommand,
  SessionCommandResult,
  SessionContinueResult,
  SessionStep,
} from './game/session-types.js';
export type {
  ActionPanel,
  ClassicDecisionPacket,
  GameResultPacket,
  HandResultPacket,
  RenderableCommand,
  TurnPacket,
} from './game/turn-packet.js';
export type {
  HandResultPot,
  HandResultSummary,
  HandSeatResult,
} from './game/hand-result.js';
```

Do not export `tournament-driver.ts`, `PreparedDriverTransition`, a driver factory, an authority callback/capability, or any method that returns authority state. Add a static root-surface test that imports `* as publicApi` and asserts all of those names are absent.

- [ ] **Step 5: Run focused and full GREEN**

```bash
npm test -- tests/cli/main.test.ts tests/cli/pacing.test.ts tests/cli/turn-command.test.ts tests/cli/turn-renderer.test.ts tests/game/game-session.test.ts
npm test
npm run check
npm run build
git diff --check
```

- [ ] **Step 6: Commit Task 8**

```bash
git add src/cli/index.ts src/index.ts tests/cli/main.test.ts tests/cli/pacing.test.ts
git commit -m "feat: run the terminal through turn packets"
```

---

### Task 9: Prove classic equivalence and record human acceptance

**Files:**

- Create: `tests/integration/classic-turn-session.test.ts`
- Modify: `README.md`
- Create: `docs/playtests/turn-packets-classic.md`
- Verify: `tests/game/classic-controller-golden.test.ts`
- Verify: `tests/integration/default-tournament.test.ts`
- Verify: `tests/integration/selectable-tournaments.test.ts`

**Interfaces:**

- Consumes: public classic session API, legacy `runTournament()` and a test-only Vitest wrapper around the real internal driver factory.
- Produces: an evidence-backed milestone A gate; no new runtime interface.

- [ ] **Step 1: Add 2-seat and 6-seat real-session integration tests**

Drive every human decision from its packet using this deterministic policy:

```ts
function passiveIntent(packet: Extract<TurnPacket, { kind: 'decision' }>): ActionIntent {
  const legal = packet.observation.legalActions;
  if (legal.check) return { type: 'check' };
  if (legal.call !== null) return { type: 'call' };
  return { type: 'fold' };
}
```

For each session, assert packet indexes are contiguous, core event ranges join exactly with no overlap/gap, each decision action exists in `actionPanel.commands`, every hand-result is acknowledged once, game-result has one funded champion and the initial chip total. Keep a 20,000-command guard in the test.

- [ ] **Step 2: Compare legacy and session core authority inside the integration harness**

Use the same hoisted `vi.mock('../../src/game/tournament-driver.js', importOriginal => ...)` capture pattern from Task 6: delegate every operation to the real module, wrap only `createTournamentDriver()`, and retain the real returned driver in the test closure before returning its proxy to GameSession. This gives the integration harness the exact committed driver backing the opaque session without changing `GameSessionHandle`, adding a production session accessor or root-exporting authority. Run the same scripted human/NPC decisions through fresh legacy and session participant instances and assert after the game-result packet:

```ts
expect(sessionAuthority.eventLog).toEqual(legacyState.eventLog);
expect(sessionAuthority.seats).toEqual(legacyState.seats);
expect(sessionAuthority.version).toBe(legacyState.version);
expect(sessionAuthority.runSeed).toBe(legacyState.runSeed);
```

Set `sessionAuthority = capture.drivers[0]!.getAuthorityState()` only inside this test. Assert `Object.keys/Reflect.ownKeys/descriptors/JSON.stringify` on the ordinary session handle still reveal nothing, and assert `src/index.ts` neither exports nor imports `tournament-driver.ts`. Also rerun the Task 1 hashes.

- [ ] **Step 3: Run the automated milestone gate**

```bash
npm test -- tests/game/classic-controller-golden.test.ts tests/game/tournament-driver.test.ts tests/game/game-session.test.ts tests/integration/classic-turn-session.test.ts tests/integration/default-tournament.test.ts tests/integration/selectable-tournaments.test.ts
npm test
npm run check
npm run build
git diff --check
```

Expected: all pass; no change to core rules or replay versions.

- [ ] **Step 4: Perform and document the four-seat human playtest**

Run:

```bash
npm run play -- --players 4 --seed turn-packet-human-v1
```

In `docs/playtests/turn-packets-classic.md`, record the exact command, date, completion/early-stop point and pass/fail for:

```markdown
- [ ] NPC 连续行动在同一块中出现，没有逐行 1 秒拖慢。
- [ ] 翻牌、转牌、河牌、摊牌、结算前的停顿可感知且不重复。
- [ ] 决策面板立即出现，无需等待 1 秒。
- [ ] 短码跟注时“桌面投入”与“最多可争夺”没有混同。
- [ ] 结算表可直接看出谁赢、投入、退回、净结果和真边池。
```

Do not mark an item passed unless it was observed by a human; automated tests are listed separately.

- [ ] **Step 5: Update current-source documentation**

Update `README.md` with the packet-style CLI, semantic pacing, preserved `runTournament()` API and exact run example. Do not claim the unreleased source is v0.1.0 or that ability-lab is implemented.

- [ ] **Step 6: Re-run the final gate after documentation and playtest edits**

```bash
npm test -- tests/integration/classic-turn-session.test.ts tests/cli/main.test.ts tests/cli/turn-renderer.test.ts
npm run check
npm run build
git diff --check
```

Expected: all pass after the final README/playtest files exist; no source or test file changed during manual acceptance except an explicit fix that went through its own RED/GREEN.

- [ ] **Step 7: Commit milestone A evidence**

```bash
git add tests/integration/classic-turn-session.test.ts README.md docs/playtests/turn-packets-classic.md
git commit -m "test: verify classic turn packet experience"
```

---

## Milestone A Completion Gate

Do not start plan B until all are true:

1. Task 1 state/event hashes remain unchanged.
2. Legacy callback batching, await order, fallback and Agent RNG tests pass.
3. CLI receives only frozen TurnPackets and cannot read authority state.
4. Packet indexes and core half-open ranges are contiguous across a full tournament.
5. Hand-result packets pause before the next hand and show one non-duplicated summary.
6. Full tests, type-check and build pass.
7. The four-seat human playtest has a written result; any failed experience item remains an explicit open correction.
