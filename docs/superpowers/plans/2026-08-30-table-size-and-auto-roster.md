# 2–6 人牌桌与自动 NPC 阵容 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让终端玩家只选择 2–6 人桌规模，由系统自动安排无重复 NPC；同时新增“小刀”“伏蛇”“重锤”三名可由统计区分的参数化角色，并保持纯德州规则核心与经典模式不变。

**Architecture:** 保持 `core`、领域事件、回放和观察投影完全不动。`agents/characters.ts` 继续只负责角色目录与参数化 Agent；新增 `game/roster.ts` 负责固定阵容和 `Participant` 工厂，避免 agents 层反向依赖 game 层；新增 `cli/options.ts` 负责纯参数解析和人数提问，`cli/index.ts` 只负责组装配置、参与者和输出。

**Tech Stack:** Node.js 22+、TypeScript 7、ESM、Vitest 4、tsx；无新增 runtime dependency。

**Spec:** `docs/superpowers/specs/2026-08-30-table-size-and-auto-roster-design.md`

## Global Constraints

- 不修改 `src/core/`、规则版本、领域事件、`TournamentState`、回放封装或 `PlayerObservationV1`。若实现需要修改这些文件，立即停止并升级规格。
- 不修改 `sources/`、`AGENTS.md`，不引入能力、作弊、浏览器 UI、TUI、长期记忆或学习型 AI。
- 人类固定座位 0；开局座位连续且全部占用；`playerCount` 必须是 2–6 的安全整数。
- 相同人数永远得到相同固定阵容；选人不读取 seed、时间或随机源。
- 四人桌继续是“猎手、疯狗、跟注站”，保证现有默认体验兼容。
- 新角色仍使用同一个 `ParametricHoldemAgent`；差异仅来自 `StyleProfile`，不得新增角色专属决策分支。
- 每项生产行为严格执行 red → green → refactor：先写测试并确认是预期失败，再做最小实现；拒绝为了让测试通过而削弱现有规则、不变量、回放或隐私断言。
- 角色统计测试使用注入的 O(1) equity provider，不运行真实 300-sample Monte Carlo；完整锦标赛测试可把 `equitySamples` 降到 20 以控制耗时，但实际 CLI 仍使用默认 300。
- 每个任务只提交该任务列出的文件；提交前运行该任务的 focused tests、`npm run check` 和 `git diff --check`。

---

## File Map

### Character catalog

- `src/agents/characters.ts`: 单一角色 ID 列表、七名角色定义、参数化 Agent factory。
- `tests/agents/parametric-agent.test.ts`: 七名角色精确配置、冻结、运行时 ID 与公共导出。
- `tests/agents/style-benchmarks.test.ts`: 原四角色基准，只做回归验证，不在本阶段修改其统计口径。
- `tests/agents/new-character-styles.test.ts` (new): 三名新角色的独立固定样本矩阵和相对行为门槛。

### Roster and participant construction

- `src/game/roster.ts` (new): 固定 2–6 人 NPC 阵容、人数校验和角色 Participant factory。
- `tests/game/roster.test.ts` (new): 精确阵容、无重复、无随机、目录名称与 factory 验证。
- `tests/integration/selectable-tournaments.test.ts` (new): 2–6 人真实自动阵容锦标赛、筹码守恒、回放与公开事件隐私门禁。

### CLI selection and composition

- `src/cli/options.ts` (new): `--seed` / `--players` 解析与交互人数循环。
- `tests/cli/options.test.ts` (new): 参数顺序、缺值、边界、默认值与 reprompt。
- `src/cli/index.ts`: 根据人数复制默认配置、创建动态 participant 列表并展示对手名单。
- `tests/cli/main.test.ts` (new): 参数绕过提问、交互人数、六人阵容和默认配置不变。
- `tests/cli/pacing.test.ts`: 保留节奏行为，并明确传 `--players 4`，避免人数提问干扰节奏测试。

### Public API and documentation

- `src/index.ts`: named-export `CHARACTER_IDS`、角色目录、roster 与 CLI options，不导出测试 helper。
- `README.md`: 2–6 人运行方式、七名角色和自动阵容说明。
- `docs/superpowers/specs/2026-08-30-table-size-and-auto-roster-design.md`: 记录规格已确认。

---

## Task 1: Expand the parameter-driven character catalog

**Files:**

- Modify: `src/agents/characters.ts`
- Modify: `src/index.ts`
- Modify: `tests/agents/parametric-agent.test.ts`
- Create: `tests/agents/new-character-styles.test.ts`
- Verify: `tests/agents/style-benchmarks.test.ts`

**Interfaces:**

- Produces: `CHARACTER_IDS`, derived `CharacterId`, seven frozen `CharacterDefinition` entries, and `createCharacterAgent(characterId, options?)` for every ID.
- Consumes: existing `ParametricHoldemAgent`, `ParametricHoldemAgentOptions`, `StyleProfile`, seeded RNG and injected `EquityProvider` test seam.
- Does not produce: a new AI subclass, role-specific branches, memory, abilities or hidden inputs.

- [ ] **Step 1: Extend exact catalog tests before production code**

Update `tests/agents/parametric-agent.test.ts` so `EXPECTED` contains all seven exact definitions and verifies `CHARACTER_IDS` is frozen, complete and in this stable order:

```ts
const EXPECTED_CHARACTER_IDS = [
  'rock',
  'hunter',
  'maniac',
  'calling-station',
  'small-ball',
  'trapper',
  'value-bettor',
] as const;

expect(CHARACTER_IDS).toEqual(EXPECTED_CHARACTER_IDS);
expect(Object.isFrozen(CHARACTER_IDS)).toBe(true);
expect(Object.keys(CHARACTERS)).toEqual(EXPECTED_CHARACTER_IDS);
expect(() => createCharacterAgent('ghost' as CharacterId)).toThrow('Invalid character ID');
```

Add these exact definitions to `EXPECTED`:

```ts
'small-ball': {
  characterId: 'small-ball', displayName: '程墨', nickname: '小刀',
  profile: {
    looseness: 0.48, aggression: 0.62, bluffing: 0.38, stickiness: 0.40,
    positionAwareness: 0.82, riskAppetite: 0.32, slowPlay: 0.16, variability: 0.14,
    sizing: { preferredPotFraction: 0.5, variance: 0.12, overbetFrequency: 0.03 },
  },
},
trapper: {
  characterId: 'trapper', displayName: '苏蔓', nickname: '伏蛇',
  profile: {
    looseness: 0.30, aggression: 0.42, bluffing: 0.06, stickiness: 0.58,
    positionAwareness: 0.50, riskAppetite: 0.36, slowPlay: 0.86, variability: 0.05,
    sizing: { preferredPotFraction: 0.5, variance: 0.04, overbetFrequency: 0.02 },
  },
},
'value-bettor': {
  characterId: 'value-bettor', displayName: '韩烈', nickname: '重锤',
  profile: {
    looseness: 0.26, aggression: 0.80, bluffing: 0.07, stickiness: 0.46,
    positionAwareness: 0.38, riskAppetite: 0.62, slowPlay: 0.10, variability: 0.08,
    sizing: { preferredPotFraction: 1, variance: 0.08, overbetFrequency: 0.12 },
  },
},
```

Also extend the root API test:

```ts
expect(publicApi.CHARACTER_IDS).toBe(CHARACTER_IDS);
```

- [ ] **Step 2: Add a separate lightweight fixed-matrix behavior benchmark**

Create `tests/agents/new-character-styles.test.ts`; do not edit the existing four-character 512-observation benchmark. The new suite uses 512 fixed seeds per scenario and an injected provider that returns exactly one of these values:

```ts
const NEW_STYLE_SCENARIOS = Object.freeze({
  weak: 90,
  mediumValue: 150,
  strong: 270,
} as const);

const fixedProvider = (wins: number): EquityProvider => (_observation, samples) => ({
  equity: wins / samples,
  wins,
  ties: 0,
  losses: samples - wins,
  samples,
});
```

Use the existing four-player facing-bet observation (`potTotal=12`, call 4, raise-to 8–100, all-in 100). For each character/scenario, call a fresh agent with `createSeededRandom('new-style-benchmark-v1', `${scenario}/${index}`)` and assert every returned action is legal. Record:

- aggressive rate (`raiseTo` or non-call-mode `allIn`),
- passive rate (`call` or `check`),
- average aggressive target,
- pot-or-all-in frequency among aggressive actions (`target >= 20`).

Lock these robust relative gates:

```ts
expect(weak['small-ball'].aggressiveRate - weak.rock.aggressiveRate)
  .toBeGreaterThanOrEqual(0.08);
expect(weak.hunter.aggressiveRate - weak['value-bettor'].aggressiveRate)
  .toBeGreaterThanOrEqual(0.03);

expect(mediumValue['small-ball'].aggressiveCount).toBeGreaterThanOrEqual(32);
expect(mediumValue.maniac.aggressiveCount).toBeGreaterThanOrEqual(32);
expect(mediumValue.maniac.averageAggressiveTarget
  - mediumValue['small-ball'].averageAggressiveTarget)
  .toBeGreaterThanOrEqual(15);
expect(mediumValue.maniac.potOrAllInRate
  - mediumValue['small-ball'].potOrAllInRate)
  .toBeGreaterThanOrEqual(0.50);

expect(strong.trapper.passiveCount).toBeGreaterThanOrEqual(32);
expect(strong.trapper.passiveRate
  - Math.max(...CHARACTER_IDS.filter((id) => id !== 'trapper')
    .map((id) => strong[id].passiveRate)))
  .toBeGreaterThanOrEqual(0.07);

expect(mediumValue['value-bettor'].aggressiveRate
  - mediumValue.rock.aggressiveRate)
  .toBeGreaterThanOrEqual(0.75);
expect(mediumValue['value-bettor'].potOrAllInRate
  - mediumValue.hunter.potOrAllInRate)
  .toBeGreaterThanOrEqual(0.50);
```

Run the fixed matrix in normal and reversed character order. The aggregate metrics must be identical, proving no shared mutable Agent or RNG state.

- [ ] **Step 3: Run the focused RED**

Run:

```bash
npm test -- tests/agents/parametric-agent.test.ts tests/agents/style-benchmarks.test.ts tests/agents/new-character-styles.test.ts
```

Expected: failures show missing `CHARACTER_IDS`, missing new catalog keys, invalid new IDs, and unmet new-character behavior expectations. The existing four-character benchmark remains a separate unchanged regression.

- [ ] **Step 4: Implement the single-source character catalog**

Replace the manual union and guard in `src/agents/characters.ts` with:

```ts
export const CHARACTER_IDS = Object.freeze([
  'rock',
  'hunter',
  'maniac',
  'calling-station',
  'small-ball',
  'trapper',
  'value-bettor',
] as const);

export type CharacterId = (typeof CHARACTER_IDS)[number];

function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string'
    && CHARACTER_IDS.includes(value as CharacterId);
}
```

Add the three definitions exactly as tested. Preserve the existing four profiles byte-for-byte. Keep `createCharacterAgent` as the only policy factory and do not add conditions on `characterId` inside `ParametricHoldemAgent`.

In `src/index.ts`, named-export `CHARACTER_IDS` alongside the existing character API:

```ts
export { CHARACTER_IDS, CHARACTERS, createCharacterAgent } from './agents/characters.js';
```

- [ ] **Step 5: Run GREEN and static checks**

Run:

```bash
npm test -- tests/agents/parametric-agent.test.ts tests/agents/style-benchmarks.test.ts tests/agents/new-character-styles.test.ts
npm run check
npm run build
git diff --check
```

Expected: both suites pass; the old four-character ranking gates still pass; all seven definitions are deeply frozen; no runtime dependency changes.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/agents/characters.ts src/index.ts tests/agents/parametric-agent.test.ts tests/agents/new-character-styles.test.ts
git commit -m "feat: add three parameter-driven poker characters"
```

---

## Task 2: Add deterministic auto-rosters and a participant factory

**Files:**

- Create: `src/game/roster.ts`
- Modify: `src/index.ts`
- Create: `tests/game/roster.test.ts`
- Create: `tests/integration/selectable-tournaments.test.ts`

**Interfaces:**

- Produces: `selectNpcRoster(playerCount)`, `createCharacterParticipant(characterId, options?)`.
- Consumes: `CHARACTERS`, `CharacterId`, `createCharacterAgent`, `ParametricHoldemAgentOptions`, `AgentParticipant`, `Participant`.
- Keeps dependency direction: game may import agents; agents must never import game.

- [ ] **Step 1: Write roster and factory tests first**

Create `tests/game/roster.test.ts` with this exact table:

```ts
const EXPECTED_ROSTERS = new Map<number, readonly CharacterId[]>([
  [2, ['hunter']],
  [3, ['small-ball', 'calling-station']],
  [4, ['hunter', 'maniac', 'calling-station']],
  [5, ['rock', 'hunter', 'small-ball', 'value-bettor']],
  [6, ['rock', 'hunter', 'maniac', 'trapper', 'value-bettor']],
]);
```

For each 2–6 count, assert exact order, `length === playerCount - 1`, no duplicates, and all IDs exist in `CHARACTERS`. Assert each call returns a fresh frozen array so a caller cannot mutate global roster data.

Reject all of:

```ts
[1, 7, 2.5, Number.NaN, Number.POSITIVE_INFINITY]
```

Prove ambient randomness is not consulted:

```ts
vi.spyOn(Math, 'random').mockImplementation(() => {
  throw new Error('roster must not use randomness');
});
vi.spyOn(Date, 'now').mockImplementation(() => {
  throw new Error('roster must not use time');
});
expect(selectNpcRoster(6)).toEqual(EXPECTED_ROSTERS.get(6));
```

Assert factory names come only from the catalog:

```ts
for (const characterId of CHARACTER_IDS) {
  const definition = CHARACTERS[characterId];
  const participant = createCharacterParticipant(characterId, { equitySamples: 20 });
  expect(participant.playerId).toBe(`${definition.displayName}“${definition.nickname}”`);
}
```

- [ ] **Step 2: Write 2–6 full-tournament acceptance tests before the module exists**

Create `tests/integration/selectable-tournaments.test.ts`. Use a deterministic human participant that checks, otherwise calls, otherwise folds. For every count 2–6:

```ts
const roster = selectNpcRoster(playerCount);
const participants: Participant[] = [
  safeHuman,
  ...roster.map((id) => createCharacterParticipant(id, { equitySamples: 20 })),
];
```

Use `startingStack: 20`, `handsPerLevel: 4`, blind levels `1/2`, `2/4`, `4/8`, `8/16`, and seed `selectable-tournament-${playerCount}`. Collect the player-0 public events and run `runTournament` with `maxTransitions: 20_000`.

For each final state assert:

```ts
expect(state.activeHand?.phase).toBe('game-complete');
expect(state.seats).toHaveLength(playerCount);
expect(state.seats.map((seat) => seat.seatIndex))
  .toEqual(Array.from({ length: playerCount }, (_, seat) => seat));
expect(state.seats.reduce((sum, seat) => sum + seat.stack, 0))
  .toBe(playerCount * 20);
expect(state.seats.filter((seat) => seat.stack > 0)).toHaveLength(1);
expect(() => assertTournamentInvariants(state)).not.toThrow();
```

Build a private `ReplayEnvelopeV1` from the exact config, participant seat headers, seed and `state.eventLog`; assert `replayTournament(envelope)` deep-equals `state`:

```ts
const envelope: ReplayEnvelopeV1 = {
  containsPrivateData: true,
  schemaVersion: EVENT_SCHEMA_VERSION,
  rulesVersion: RULES_VERSION,
  rngVersion: RNG_ALGORITHM_VERSION,
  shuffleVersion: SHUFFLE_ALGORITHM_VERSION,
  strategyVersion: STRATEGY_VERSION,
  initialConfig: config,
  seats: participants.map((participant, seatIndex) => ({
    playerId: participant.playerId,
    seatIndex,
  })),
  runSeed,
  events: state.eventLog,
};
expect(replayTournament(envelope)).toEqual(state);
```

For the viewer event stream assert it contains no authority-only names or fields:

```ts
const projectedJson = JSON.stringify(publicEvents);
expect(projectedJson).not.toMatch(/DeckPrepared|CardBurned|fullOrderedDeck|runSeed|dealCursor|burnedCards/);
```

Also assert each public event is frozen and that the first `gameStarted.maxSeats` matches `playerCount`.

Finally, prove the controller emitted exactly the approved viewer projection rather than a weaker hand-built subset:

```ts
expect(publicEvents).toEqual(projectEventsForViewer(state.eventLog, 0));
```

- [ ] **Step 3: Run the focused RED**

Run:

```bash
npm test -- tests/game/roster.test.ts tests/integration/selectable-tournaments.test.ts
```

Expected: both suites fail because `src/game/roster.ts` does not exist. This proves the new tests target the missing boundary rather than an unrelated fixture error.

- [ ] **Step 4: Implement the roster module**

Create `src/game/roster.ts`:

```ts
import {
  CHARACTERS,
  createCharacterAgent,
  type CharacterId,
} from '../agents/characters.js';
import type { ParametricHoldemAgentOptions } from '../agents/parametric-agent.js';
import { AgentParticipant, type Participant } from './participant.js';

const AUTO_ROSTERS: Readonly<Record<2 | 3 | 4 | 5 | 6, readonly CharacterId[]>>
  = Object.freeze({
    2: Object.freeze(['hunter']),
    3: Object.freeze(['small-ball', 'calling-station']),
    4: Object.freeze(['hunter', 'maniac', 'calling-station']),
    5: Object.freeze(['rock', 'hunter', 'small-ball', 'value-bettor']),
    6: Object.freeze(['rock', 'hunter', 'maniac', 'trapper', 'value-bettor']),
  });

type SupportedPlayerCount = keyof typeof AUTO_ROSTERS;

function requirePlayerCount(value: number): SupportedPlayerCount {
  if (!Number.isSafeInteger(value) || value < 2 || value > 6) {
    throw new Error('playerCount must be a safe integer from 2 through 6');
  }
  return value as SupportedPlayerCount;
}

export function selectNpcRoster(playerCount: number): readonly CharacterId[] {
  return Object.freeze([...AUTO_ROSTERS[requirePlayerCount(playerCount)]]);
}

export function createCharacterParticipant(
  characterId: CharacterId,
  options?: Readonly<ParametricHoldemAgentOptions>,
): Participant {
  const definition = CHARACTERS[characterId];
  if (definition === undefined) throw new Error('Invalid character ID');
  return new AgentParticipant(
    `${definition.displayName}“${definition.nickname}”`,
    createCharacterAgent(characterId, options),
  );
}
```

Do not export `AUTO_ROSTERS`; callers must use the validating selector. In `src/index.ts`, add named value exports for `selectNpcRoster` and `createCharacterParticipant` from `game/roster.ts`.

Every array call site must wrap the factory in a one-argument callback:

```ts
characterIds.map((characterId) => createCharacterParticipant(characterId))
```

Never pass `createCharacterParticipant` directly to `.map()`, because the array index would be forwarded as the factory's optional Agent options argument.

- [ ] **Step 5: Run GREEN, then regress controller and hidden information**

Run:

```bash
npm test -- tests/game/roster.test.ts tests/integration/selectable-tournaments.test.ts
npm test -- tests/game/tournament-controller.test.ts tests/agents/hidden-information.test.ts tests/core/replay.test.ts
npm run check
npm run build
git diff --check
```

Expected: all five table sizes finish; replay equals authority; participant names are catalog-derived; no core source file changes.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/game/roster.ts src/index.ts tests/game/roster.test.ts tests/integration/selectable-tournaments.test.ts
git commit -m "feat: select deterministic npc rosters"
```

---

## Task 3: Parse `--players` and prompt for a table size

**Files:**

- Create: `src/cli/options.ts`
- Modify: `src/index.ts`
- Create: `tests/cli/options.test.ts`

**Interfaces:**

- Produces: `ParsedCliOptions`, `parseCliOptions(argv, createSeed)`, `promptForPlayerCount(io)`.
- Consumes: existing `PromptIO` as a type-only dependency.
- Does not start a tournament, create participants or read real stdin in tests.

- [ ] **Step 1: Write exact parser tests**

Create `tests/cli/options.test.ts`. Lock these successful cases:

```ts
expect(parseCliOptions(['--players', '2', '--seed', 'alpha'], uuid))
  .toEqual({ seed: 'alpha', playerCount: 2 });
expect(parseCliOptions(['--seed', 'alpha', '--players', '4'], uuid))
  .toEqual({ seed: 'alpha', playerCount: 4 });
expect(parseCliOptions(['--players', '6'], uuid))
  .toEqual({ seed: 'generated-seed', playerCount: 6 });
expect(parseCliOptions(['--seed', 'alpha'], uuid))
  .toEqual({ seed: 'alpha', playerCount: null });
expect(parseCliOptions([], uuid))
  .toEqual({ seed: 'generated-seed', playerCount: null });
```

Assert the generated-seed callback is called exactly once only when `--seed` is absent.

Reject with Chinese messages for:

- unknown flag or positional text,
- repeated `--seed`,
- repeated `--players`,
- missing/empty seed,
- missing players value,
- player values `1`, `7`, `2.5`, `02`, `abc`, `NaN`, `Infinity`.

For every invalid argv case, assert the generated-seed callback has zero calls. Validation must finish before UUID generation.

- [ ] **Step 2: Write exact interactive prompt tests**

Use injected `PromptIO` queues. Lock:

```ts
await expect(promptForPlayerCount(ioFor(['']).io)).resolves.toBe(4);
await expect(promptForPlayerCount(ioFor(['2']).io)).resolves.toBe(2);
await expect(promptForPlayerCount(ioFor(['6']).io)).resolves.toBe(6);
```

For `['1', '2.5', 'abc', '5']`, assert it asks four times with the exact prompt:

```text
请选择牌桌人数（2-6，直接回车默认 4）：
```

and writes this exact error three times:

```text
人数无效，请输入 2 到 6 的整数。
```

The test helper must throw when its input queue is exhausted:

```ts
question: async () => {
  const answer = queue.shift();
  if (answer === undefined) throw new Error('prompt input queue exhausted');
  return answer;
},
```

This prevents an accidental infinite reprompt from silently becoming the empty-input default of 4.

- [ ] **Step 3: Run the focused RED**

Run:

```bash
npm test -- tests/cli/options.test.ts
```

Expected: the suite fails only because `src/cli/options.ts` is missing.

- [ ] **Step 4: Implement the pure CLI boundary**

Create `src/cli/options.ts` with:

```ts
import type { PromptIO } from './prompts.js';

export interface ParsedCliOptions {
  readonly seed: string;
  readonly playerCount: number | null;
}

const PLAYER_COUNT_PROMPT = '请选择牌桌人数（2-6，直接回车默认 4）：';
const INVALID_PLAYER_COUNT = '人数无效，请输入 2 到 6 的整数。';

function parsePlayerCount(value: string): number {
  if (!/^[2-6]$/.test(value)) {
    throw new Error('--players 需要 2 到 6 的整数');
  }
  return Number(value);
}

export function parseCliOptions(
  argv: readonly string[],
  createSeed: () => string,
): ParsedCliOptions {
  let seed: string | undefined;
  let playerCount: number | null = null;
  let sawPlayers = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--seed') {
      if (seed !== undefined) throw new Error('--seed 只能使用一次');
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw new Error('--seed 需要一个非空值');
      }
      seed = value;
      index += 1;
      continue;
    }
    if (argument === '--players') {
      if (sawPlayers) throw new Error('--players 只能使用一次');
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw new Error('--players 需要 2 到 6 的整数');
      }
      playerCount = parsePlayerCount(value);
      sawPlayers = true;
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${argument ?? ''}`);
  }

  const resolvedSeed = seed ?? createSeed();
  if (typeof resolvedSeed !== 'string' || resolvedSeed.length === 0) {
    throw new Error('随机种子必须是非空文本');
  }
  return Object.freeze({ seed: resolvedSeed, playerCount });
}

export async function promptForPlayerCount(io: Readonly<PromptIO>): Promise<number> {
  while (true) {
    const answer = (await io.question(PLAYER_COUNT_PROMPT)).trim();
    if (answer === '') return 4;
    if (/^[2-6]$/.test(answer)) return Number(answer);
    io.write(INVALID_PLAYER_COUNT);
  }
}
```

Do not use a general third-party parser. A value beginning with `--` counts as a missing value, not as a seed or player count.

In `src/index.ts`, named-export the two functions and `ParsedCliOptions`.

- [ ] **Step 5: Run GREEN and static checks**

Run:

```bash
npm test -- tests/cli/options.test.ts tests/cli/prompts.test.ts
npm run check
npm run build
git diff --check
```

Expected: options and existing legal-action prompting both pass; no real stdin, timers, UUIDs or tournament execution occurs.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/cli/options.ts src/index.ts tests/cli/options.test.ts
git commit -m "feat: choose terminal table size"
```

---

## Task 4: Compose the selected table in the terminal CLI

**Files:**

- Modify: `src/cli/index.ts`
- Create: `tests/cli/main.test.ts`
- Modify: `tests/cli/pacing.test.ts`

**Interfaces:**

- Consumes: `parseCliOptions`, `promptForPlayerCount`, `selectNpcRoster`, `createCharacterParticipant`.
- Produces: unchanged `main(argv?, runtime?)` behavior with dynamic `config.maxSeats` and participants.
- Keeps `DEFAULT_TOURNAMENT_CONFIG.maxSeats === 4` frozen and unchanged as the fallback template.

- [ ] **Step 1: Write main-composition tests before changing `src/cli/index.ts`**

Create `tests/cli/main.test.ts` with a fake `CliRuntime` whose `runTournament` captures options and immediately returns a stub `TournamentState`.

Test `main(['--players', '6', '--seed', 'six-seat'])` and assert:

```ts
expect(captured.config.maxSeats).toBe(6);
expect(DEFAULT_TOURNAMENT_CONFIG.maxSeats).toBe(4);
expect(captured.participants.map((participant) => participant.playerId)).toEqual([
  '你',
  '老周“岩石”',
  '林岚“猎手”',
  '阿凯“疯狗”',
  '苏蔓“伏蛇”',
  '韩烈“重锤”',
]);
expect(promptQuestions).toEqual([]);
expect(writes).toContain('本局种子：six-seat');
expect(writes).toContain(
  '本桌对手：座位 1 老周“岩石”｜座位 2 林岚“猎手”｜座位 3 阿凯“疯狗”｜座位 4 苏蔓“伏蛇”｜座位 5 韩烈“重锤”',
);
```

The six-player test must also exercise the human Participant instead of stopping at `participants.length`. Inside the fake `runTournament`, construct a valid seat-0 decision observation with:

- `actorSeatIndex: 0`, two hero cards, preflop, and a legal check-only action set;
- six `PublicSeatState` entries whose `playerId` values come from `options.participants`;
- physical seat indexes exactly 0 through 5.

Then call:

```ts
await options.participants[0]!.decide({
  observation: sixSeatObservation,
  random: createSeededRandom('cli-six-seat-render'),
});
```

Queue `x` as the human action response. Assert the resulting prompt write contains each of `座位 0` through `座位 5`, contains none of `座位 6`, includes the five NPC names, and contains no profile keys such as `aggression`, `bluffing` or `slowPlay`. This binds the CLI composition to the dynamic renderer, not only to an array shape.

Test `main(['--seed', 'interactive'])` with prompt inputs `['bad', '5']`. Assert the prompt object is created once, the seed generator is not called, the invalid input is reported once, and `runTournament` receives:

```ts
['你', '老周“岩石”', '林岚“猎手”', '程墨“小刀”', '韩烈“重锤”']
```

Test omitted `--players` plus empty input gives the legacy four-person roster. Assert `prompt.close()` executes exactly once both on successful `runTournament` and when `runTournament` throws.

- [ ] **Step 2: Preserve the pacing test's single responsibility**

Change the existing main call in `tests/cli/pacing.test.ts` from:

```ts
main(['--seed', 'fixed-seed'], runtime)
```

to:

```ts
main(['--players', '4', '--seed', 'fixed-seed'], runtime)
```

Add the roster line to the expected paced operations between seed and first hand event:

```ts
'write:本桌对手：座位 1 林岚“猎手”｜座位 2 阿凯“疯狗”｜座位 3 莫叔“跟注站”',
```

and retain a `wait:1000` before the next automatic line. The human decision panel remains outside the pacer.

- [ ] **Step 3: Run the focused RED**

Run:

```bash
npm test -- tests/cli/main.test.ts tests/cli/pacing.test.ts
```

Expected: `--players` is rejected by the old parser, dynamic participant/config assertions fail, and the roster line is missing. The existing low-level line-pacer tests remain green.

- [ ] **Step 4: Replace hard-coded CLI composition**

In `src/cli/index.ts`:

1. Remove the private `parseSeed` function and import `parseCliOptions` / `promptForPlayerCount`.
2. Import `selectNpcRoster` / `createCharacterParticipant`; remove direct `createCharacterAgent` and `AgentParticipant` imports.
3. Parse the seed and optional count before creating the prompt.
4. Create one prompt; if `playerCount === null`, resolve it through that same prompt.
5. Build a new config object without mutating the frozen default.
6. Build the participant array from the selected roster.
7. After count and roster are known, pace the seed line, then one roster line, then call the existing controller.

Use this composition:

```ts
const options = parseCliOptions(argv, runtime.randomUUID);
const paceLine = createLinePacer(runtime.write, runtime.sleep, 1_000);
const prompt = await runtime.createPrompt();
try {
  const playerCount = options.playerCount ?? await promptForPlayerCount(prompt);
  const npcIds = selectNpcRoster(playerCount);
  const participants: Participant[] = [
    new HumanParticipant(prompt),
    ...npcIds.map((characterId) => createCharacterParticipant(characterId)),
  ];
  const config: TournamentConfig = Object.freeze({
    ...DEFAULT_TOURNAMENT_CONFIG,
    maxSeats: playerCount,
  });

  await paceLine(`本局种子：${options.seed}`);
  await paceLine(`本桌对手：${participants.slice(1)
    .map((participant, index) => `座位 ${index + 1} ${participant.playerId}`)
    .join('｜')}`);

  return await runtime.runTournament({
    config,
    participants,
    runSeed: options.seed,
    invalidAgentActionMode: 'fallback',
    publicViewerSeatIndex: 0,
    onPublicEvents: async (events) => {
      const rendered = renderPublicEvents(events);
      if (rendered.length > 0) await paceLine(rendered);
    },
    onDiagnostic: async (event) => {
      await paceLine(
        `系统：${event.playerId} 的 ${event.attemptedType} 未被接受，改为 ${event.fallbackAction}。`,
      );
    },
  });
} finally {
  await prompt.close();
}
```

The factory's default Agent options must remain untouched so actual CLI play still uses 300 equity samples.

- [ ] **Step 5: Run GREEN and adjacent regressions**

Run:

```bash
npm test -- tests/cli/options.test.ts tests/cli/main.test.ts tests/cli/pacing.test.ts tests/cli/prompts.test.ts tests/cli/renderer.test.ts
npm test -- tests/game/roster.test.ts tests/game/tournament-controller.test.ts tests/integration/selectable-tournaments.test.ts
npm run check
npm run build
git diff --check
```

Expected: CLI tests run without real sleeping or stdin; six participants are distinct; config is 6 only for the selected run; all existing controller and renderer behavior remains green.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/cli/index.ts tests/cli/main.test.ts tests/cli/pacing.test.ts
git commit -m "feat: assemble selectable terminal tables"
```

---

## Task 5: Update player documentation and run the release gate

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-30-table-size-and-auto-roster-design.md`
- Verify: all production and test files from Tasks 1–4

**Acceptance:**

- Documentation describes exactly the shipped 2–6 selection and seven parameter-driven characters.
- Existing 100-hand rules gate, full tournament tests, type checking and build all pass.
- No `src/core/` file appears in the branch diff.

- [ ] **Step 1: Capture the stale-documentation RED**

Run:

```bash
rg -n "四人锦标赛|内置四种角色风格|默认终端牌桌" README.md
```

Expected: the command finds stale v0.1.0 wording that would misdescribe the new feature.

- [ ] **Step 2: Update README with exact user-facing behavior**

Replace the fixed-four-person description with 2–6 selectable tables and a deterministic automatic roster. List all seven characters and state clearly that they share one parameterized policy rather than bespoke AI code.

Add these examples:

```bash
npm run play -- --players 6 --seed demo-6p
npm run play -- --players 2
npm run play
```

Document that omitting `--players` opens a 2–6 prompt whose empty answer defaults to 4. Keep the boundaries explicit: no cheating abilities, learning, browser UI or manual NPC selection in this stage.

Do not edit the historical GitHub v0.1.0 Release description, package version, tag or remote in this task; publishing a later release requires separate user authorization.

- [ ] **Step 3: Verify documentation no longer claims a fixed four-player product**

Run:

```bash
rg -n "2–6|--players 6|程墨|苏蔓|韩烈|参数" README.md
```

Expected: the new feature, all three new characters and the parameter-driven boundary are present.

- [ ] **Step 4: Run the complete automated gate**

Run:

```bash
npm test
npm run check
npm run build
git diff --check
git diff --name-only origin/main...HEAD
```

Expected:

- all tests pass, including the existing exact 100-hand gate in `tests/integration/random-hands.test.ts`;
- 2–6 selectable full tournaments complete and replay exactly;
- no file under `src/core/` appears in `git diff --name-only`;
- `src/game/tournament-controller.ts` and `src/agents/observation.ts` do not appear in the diff;
- only this feature's agent, game, CLI, test and documentation files differ.

- [ ] **Step 5: Run a real six-player terminal smoke**

Run:

```bash
npm run play -- --players 6 --seed roster-smoke-v1
```

Verify before taking any poker action:

- the seed is `roster-smoke-v1`;
- the opponent line contains five distinct catalog-derived names in the approved order;
- the first decision table renders seats 0 through 5;
- the legal action prompt still appears immediately rather than one line per second.

Exit at the first human prompt with Ctrl+C and record that interruption separately; it is an interactive smoke, not an automated completion test.

- [ ] **Step 6: Commit documentation**

Only after Steps 4 and 5 pass, change the spec status from `已确认，待实施` to `已实现`.

```bash
git add README.md docs/superpowers/specs/2026-08-30-table-size-and-auto-roster-design.md
git commit -m "docs: explain selectable poker tables"
```

- [ ] **Step 7: Final branch hygiene**

Run:

```bash
git status --short
git log --oneline --decorate -6
```

Expected: worktree clean; commits are scoped by task; the approved design and implementation plan remain in `docs/superpowers/`.

---

## Plan Self-Review Checklist

- [ ] Every product decision in the approved spec maps to a task and an executable assertion.
- [ ] The four-person roster remains exactly hunter/maniac/calling-station.
- [ ] The new catalog has one source of truth for runtime IDs, types and definitions.
- [ ] `agents` never imports `game`; `game/roster.ts` owns Participant construction.
- [ ] `--seed` and `--players` work in both orders and each rejects duplicates.
- [ ] Interactive invalid input reuses the same prompt and seed.
- [ ] New character tests use fixed matrices and denominator floors, not one-hand anecdotes.
- [ ] Complete 2–6 tournaments assert finite completion, chip conservation, replay and public projection privacy.
- [ ] The branch changes no `src/core/` file and keeps the 100-hand rule gate green.
- [ ] No unresolved placeholder marker remains in this plan or the implementation.
