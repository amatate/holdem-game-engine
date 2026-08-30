# 回合包叙事与能力实验模式设计规格

日期：2026-08-31

状态：待用户审阅

## 1. 目标

在不破坏现有纯德州扑克规则引擎的前提下，完成两个相互配合的新能力：

1. 用“回合包”替代逐事件、逐行刷屏，让终端牌局更容易阅读，并为后续浏览器牌桌提供稳定的视图接口。
2. 增加可选的“能力实验”模式，用三种一次性作弊能力验证当前引擎的扩展性：偷看、读牌、换牌。

本阶段首先验证架构边界，不追求能力平衡、角色剧情或网页美术。纯德州扑克模式必须继续保留，并且在相同种子、座位和扑克行动下保持相同的核心状态、事件、筹码与 NPC 随机路径。

## 2. 已确认的产品决策

### 2.1 模式

- 提供 `classic` 和 `ability-lab` 两种模式。
- 启动时选择模式；直接回车默认 `classic`。
- 同一场锦标赛中不能切换模式。
- 能力只属于人类玩家；NPC 第一版不使用能力，也不知道能力是否发生。
- `classic` 中所有能力命令都被明确拒绝。

### 2.2 能力次数与行动关系

- 偷看、读牌、换牌各可成功使用一次，每场锦标赛不恢复。
- 能力只能在人类玩家是当前行动者时使用。
- 同一个扑克决策点最多成功使用一种能力。
- 能力成功不会替代扑克行动；使用后仍停留在同一决策点，玩家必须继续过牌、跟注、加注、全下或弃牌。
- 能力一旦成功就立即消耗。之后即使玩家弃牌、输入非法扑克命令或退出，也不返还。
- 非法能力命令不消耗次数，不改变核心或会话状态，不增加版本、索引或事件，也不创建或消费随机源。

### 2.3 三种能力

1. **偷看一张底牌**：选择一名本手仍有底池资格的对手；系统用独立且可复现的能力随机流，在其两张底牌中随机选择一张，仅向人类玩家显示。
2. **读取粗略牌力**：选择一名本手仍有底池资格的对手；使用其真实手牌、当前公共牌和仍存活人数估算当前牌力，只返回“弱 / 中 / 强”。
3. **更换一张底牌**：选择自己的第 1 或第 2 张底牌；旧牌进入能力弃牌区，新牌取自权威牌堆的下一张未发牌，发牌游标前进，后续公共牌自然顺延。

全下但未弃牌的对手仍有底池资格，因此可以成为偷看或读牌目标。已弃牌、已淘汰、自己的座位和已经公开手牌的对手不能成为目标。

### 2.4 私有信息与节奏

- 偷看、读牌和换牌记录只进入人类玩家的私有信息区，保留到本手结束，随后立即清空。
- 换牌记录显示为类似“手牌 1：K♠ → A♦”；摊牌的公共日志只显示最终手牌，旧牌永不公开。
- 普通 NPC 连续行动作为一个文本块一起出现。
- 翻牌、转牌、河牌、摊牌和结算块显示前暂停 1 秒。
- 玩家行动面板立即出现，不继承前一个文本块的等待。
- 第一版不提供速度设置。

### 2.5 本阶段边界

- 本阶段实现规则会话层、回合包和 CLI。
- 浏览器牌桌随后消费同一个回合包接口，但不在本阶段开发。
- 不加入 NPC 对能力的反应、怀疑值、能力费用、能力升级或跨手牌笔记。

## 3. 当前基础与兼容边界

现有系统已经具备：

- 2–6 人无限注德州扑克规则、盲注、All-in、退款、主池/边池、摊牌、淘汰和筹码守恒。
- 完整权威牌堆、发牌游标和逐事件 reducer。
- `ReplayEnvelopeV1` 精确回放及逐前缀不变量校验。
- `PlayerObservationV1` 隐藏信息投影。
- `Participant` / `PokerAgent` 仅返回正常扑克行动。
- `runTournament()` 一次运行到冠军的经典控制器。
- 公开事件投影、CLI 渲染、角色 Agent 和独立随机路径。

本阶段必须保留以下公开边界：

- `Participant`、`ActionDecision`、`PokerAgent` 不增加能力命令。
- `PlayerObservationV1` 不承载能力次数、私有情报或 UI 专用文案字段。
- `runTournament()`、`ReplayEnvelopeV1`、`RULES_VERSION = 'holdem-v1'` 和既有 Agent RNG 路径保持兼容。
- 经典模式相同输入继续产生逐字段相同的核心状态和 `eventLog`。
- 能力信息不能进入普通 `PublicGameEvent`、NPC `DecisionContext` 或浏览器公共状态。

允许发生的经典模式交互变化仅限：模式选择、回合包式展示、命令别名和节奏。规则结算与核心事件不变。

## 4. 总体架构

```text
CLI Adapter                       Future Browser Adapter
     \                                   /
      \---------- TurnPacket -----------/
                       ↑
                 GameSession
                 ├── mode / charges
                 ├── private knowledge
                 ├── session replay
                 └── ability resolver
                       ↓
              Pausable TournamentDriver
                 ├── human poker action
                 ├── existing NPC Participant
                 └── automatic phase advance
                       ↓
              Existing Hold'em Rules Core
```

### 4.1 `TournamentDriver`

从现有 `runTournament()` 中抽取可暂停的内部驱动器。Driver 构造时接收：

```ts
interface TournamentDriverOptions {
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

type DriverTransitionSource =
  | 'automatic'
  | 'npc'
  | 'human-poker'
  | 'ability-swap';

interface DriverTransitionBatch {
  readonly source: DriverTransitionSource;
  readonly commandIndex: number | null;
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly authorityEvents: readonly DomainEvent[];
}
```

`seats` 是完整且连续的物理座位描述，包含暂停人类座位的 `playerId`；`participants` 是对应座位的决策 provider。两者长度必须等于物理座位数；只有暂停座位允许 provider 为 `null`，所有非暂停座位必须提供且 `playerId` 与 seat descriptor 一致。不在暂停集合中的行动者由 driver 内部调用对应 Participant；暂停集合中的行动者只产生 decision boundary，由上层提交扑克行动。它负责：

- 接受并逐事件验证核心 transition。
- 运行自动发牌、闭轮、摊牌和结算。
- 调用所有不在 `pauseSeatIndexes` 中的现有 `Participant`。
- 在人类决策、本手结算和比赛结算三个边界暂停。
- 保留 Agent 非法动作 fallback、20,000 事件守卫、逐前缀 replay 和不变量检查。

Driver 每次只接受一个原有 `TransitionResult`，并保持它的事件批次边界。验证、逐前缀 replay 和不变量检查通过后，Driver 生成递归冻结的 `DriverTransitionBatch`，`await onAcceptedTransition(batch)`，完成该批次的事务提交后才允许下一次 transition 或 boundary。初始化、发牌、闭轮、结算和开下一手均记为 `automatic`；NPC 行动记为 `npc`；会话提交的正常扑克行动记为 `human-poker`；换牌的单事件核心 transition 记为 `ability-swap`。

`automatic` 与 `npc` 的 `commandIndex` 必须为 `null`；`human-poker` 与 `ability-swap` 必须由 GameSession 传入当前成功命令使用的 `acceptedCommandIndex`。Driver 不解释能力次数或私有知识，只携带该关联值。`onDiagnostic` 必须在非法 NPC 动作之后、fallback transition 之前被 `await`。

候选核心状态、GameSession 的候选会话状态和对应 SessionEvent 在同一内部事务中暂存；只有钩子和全部校验成功才一起成为下一已提交状态。任一步抛错都不得留下“核心已换牌但能力次数未扣”或“会话事件已写入但核心未前进”的半提交状态。普通调用方不能重入正在执行的 driver/session 命令。

规范边界：

```ts
type DriverBoundary =
  | Readonly<{
      kind: 'decision';
      seatIndex: number;
      observation: Readonly<PlayerObservationV1>;
    }>
  | Readonly<{
      kind: 'hand-complete';
      handNumber: number;
    }>
  | Readonly<{
      kind: 'game-complete';
      winnerSeatIndex: number;
    }>;
```

当前控制器在 `hand-complete` 后会立即开始下一手。新驱动器必须先暂停并交付结算包，调用方确认已经展示后再开始下一手，防止结算表与下一手开局交错。

旧 `runTournament()` 改为驱动器的兼容适配器：它继续从所有物理座位拉取 `Participant.decide()`，忽略 UI 暂停并一直运行到冠军。因此现有非交互调用方不需要改动。

具体配置：

- `runTournament()` 从现有 participants 派生 seats，使用 `pauseSeatIndexes = []`，driver 调用所有 Participant 并一直运行到冠军。
- 新 CLI 显式提供含“你”的 seats，使用 `pauseSeatIndexes = [humanSeatIndex]`，该位置 provider 为 `null`；driver 内部只运行 NPC，人类命令由 GameSession 提交。

兼容适配器必须通过上述唯一 `onAcceptedTransition` 机制保留现有 callback 时序和批次：对每个 batch 先 `await onAuthorityEvents(frozenAuthorityBatch)`，再投影同一 batch 并 `await onPublicEvents(viewerProjectedBatch)`。GameSession 使用同一机制，按 batch 的 `source` 和 `commandIndex` 将每个核心事件顺序写成 `CoreEventApplied`；`ability-swap` 的唯一 `HoleCardReplaced` 则写成单个原子 `HoleCardSwapResolved`。Agent 非法动作时先 `await onDiagnostic`，随后才应用并投影 fallback action。不得把多个 transition 合成一个 callback，也不得 fire-and-forget。

新 CLI 在两种模式下都使用 `GameSession + TournamentDriver` 取得 TurnPacket；`classic` 会话不生成能力事件，`abilities = null`、私有增量恒为空，精确存档仍使用原 `ReplayEnvelopeV1`。库级 `runTournament()` 不经过 GameSession，继续保留原有一次跑到底的接口。

### 4.2 `GameSession`

`GameSession` 位于人类命令与驱动器之间，持有：

```ts
type AbilityId = 'peek' | 'read' | 'swap';

interface SessionBaseState {
  readonly mode: 'classic' | 'ability-lab';
  readonly humanSeatIndex: number;
  readonly pokerState: TournamentState;
  readonly acceptedCommandIndex: number;
}

interface ClassicSessionState extends SessionBaseState {
  readonly mode: 'classic';
}

interface AbilityLabSessionState extends SessionBaseState {
  readonly mode: 'ability-lab';
  readonly charges: Readonly<Record<AbilityId, 0 | 1>>;
  readonly privateKnowledge: readonly PrivateKnowledgeEntry[];
  readonly abilityUsedDecisionKey: string | null;
  readonly sessionEventLog: readonly SessionEvent[];
}

type GameSessionState = ClassicSessionState | AbilityLabSessionState;
```

CLI 第一版固定 `humanSeatIndex = 0`，但会话 API 保留显式字段，避免把座位 0 写成规则假设。

`acceptedCommandIndex` 只统计成功接受的人类命令：成功能力和成功扑克行动各加一；非法命令、NPC 行动和自动阶段不增加。它用于能力随机路径和会话回放，不替代核心 `decisionIndex`。

计数从 0 开始。成功命令先使用并记录当前值 `N`，能力 RNG 也使用 `N`；事件提交成功后，会话状态再更新为 `N + 1`。

Agent 随机路径继续固定为：

```text
agent/<handNumber>/<seatIndex>/<decisionIndex>
```

能力命令不得改变此路径。

Session reducer 在成功接受人类扑克行动后清除 `abilityUsedDecisionKey`；三个能力的 `charges` 继续保留到锦标赛结束，`privateKnowledge` 则在 `HandCompleted` 对应的核心事件被包装并接受时清空。

经典会话不创建 `sessionEventLog`、charges 或私有情报；TurnPacket 增量直接由核心 `eventLog` 和 delivery cursor 生成。`acceptedCommandIndex` 在经典会话中只用于会话命令诊断，不写入 `ReplayEnvelopeV1`，因此不会改变经典存档。

### 4.3 命令模型

```ts
type SessionCommand =
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

所有命令必须同时携带当前 `decisionKey` 和 `expectedPacketIndex`。决策已经变化时返回 `stale-decision`；能力成功后虽然 decisionKey 不变，但旧包重试会因 packetIndex 不匹配返回 `stale-packet`。两者都不得错误作用到当前状态。

### 4.4 会话交付 API

GameSession 聚合根包含独立的 delivery state；它不是扑克规则状态：

```ts
interface OpenGameSessionOptions {
  readonly mode: 'classic' | 'ability-lab';
  readonly config: TournamentConfig;
  readonly runSeed: string;
  readonly humanSeatIndex: number;
  readonly seats: readonly TournamentSeatInput[];
  readonly participants: readonly (Participant | null)[];
  readonly maxTransitions?: number;
  readonly invalidAgentActionMode?: 'throw' | 'fallback';
  readonly onDiagnostic?: (
    event: Readonly<ControllerDiagnosticEvent>,
  ) => void | Promise<void>;
}

interface SessionDeliveryState {
  readonly nextPacketIndex: number;
  readonly deliveredCoreVersion: number;
  readonly deliveredSessionEventCount: number;
  readonly pendingPacket: Readonly<TurnPacket> | null;
}

interface InternalGameSessionAggregate {
  readonly authority: Readonly<GameSessionState>;
  readonly delivery: Readonly<SessionDeliveryState>;
}

declare const gameSessionHandleBrand: unique symbol;
interface GameSessionHandle {
  readonly [gameSessionHandleBrand]: true;
}

interface SessionStep {
  readonly handle: GameSessionHandle;
  readonly packet: Readonly<TurnPacket>;
}

type SessionCommandResult =
  | Readonly<{ accepted: true; step: SessionStep }>
  | Readonly<{
      accepted: false;
      handle: GameSessionHandle;
      rejection: AbilityRejectionCode | ActionRejectionCode;
      packet: Readonly<TurnPacket>;
    }>;

type SessionContinueResult =
  | Readonly<{ accepted: true; step: SessionStep }>
  | Readonly<{
      accepted: false;
      handle: GameSessionHandle;
      rejection: 'stale-packet' | 'wrong-boundary';
      packet: Readonly<TurnPacket>;
    }>;
```

`openGameSession()` 从 `humanSeatIndex` 唯一派生 `pauseSeatIndexes = [humanSeatIndex]`；调用方不能另传暂停集合。`seats` 和 `participants` 使用 4.1 的相同长度、连续座位及 playerId 校验，人类位置 provider 必须为 `null`，其他位置必须非空。CLI 固定 `invalidAgentActionMode = 'fallback'`。

固定 API 语义：

```ts
openGameSession(options): Promise<SessionStep>;
getCurrentPacket(handle): Readonly<TurnPacket>;
submitSessionCommand(handle, command): Promise<SessionCommandResult>;
continueAfterHandResult(handle, packetIndex): Promise<SessionContinueResult>;
```

推进 boundary 可能调用异步 `Participant.decide()`，因此 open、submit 和 continue 一律返回 Promise；即使某次命令在同步预检阶段被拒绝，也仍通过已 resolve 的 Promise 返回统一结果。只有读取现有 pending packet 的 `getCurrentPacket()` 是同步纯读。

`InternalGameSessionAggregate` 仅存在于 game-session 模块内部。对外 `GameSessionHandle` 由私有 class 字段或模块内 WeakMap 支撑，调用方无法通过属性、反射或序列化读取 authority state；`readonly` 不能替代这层封装。CLI 与浏览器适配器可以持有 handle，但只能从 API 返回值取得 TurnPacket。

- `openGameSession()` 推进到第一个 boundary，创建 `packetIndex = 0` 的 pending packet。
- `getCurrentPacket()` 可重复调用，只返回同一个冻结包，不移动游标或索引。
- `submitSessionCommand()` 只接受当前 decision packet；成功后消费该包并推进到下一个 boundary，拒绝则返回拒绝码及同一个 pending packet。
- `continueAfterHandResult()` 只接受当前 hand-result 的 `packetIndex`；它确认 UI 已完成展示，再允许 driver 调用 `startNextHand()` 并推进到下一 boundary。旧包返回 `stale-packet`。
- decision 或 game-result 调用 continue 返回 `wrong-boundary`，不改变状态。
- 每次创建新包后，核心与私有游标推进到该包的右边界；重复读取和非法命令均不推进。

delivery state 不写入 `ReplayEnvelopeV1` 或 `SessionReplayEnvelopeV1`。`replaySession()` 重建权威游戏/能力状态，并按同样 boundary 规则确定性生成完整 packet transcript；它不恢复某个具体 UI 客户端“是否已经读过当前包”的瞬时传输状态。

## 5. TurnPacket 契约

回合包必须使用判别联合，不能假设任何时刻都存在合法的玩家 observation。

```ts
interface PacketBase {
  readonly schemaVersion: 1;
  readonly packetIndex: number;
  readonly coreEventRange: Readonly<{
    readonly fromVersionInclusive: number;
    readonly toVersionExclusive: number;
  }>;
  readonly viewerEventsSinceLastPacket: readonly PublicGameEvent[];
  readonly privateEventsSinceLastPacket: readonly PrivateAbilityNotice[];
}

type TurnPacket =
  | Readonly<PacketBase & {
      kind: 'decision';
      decisionKey: string;
      observation: Readonly<PlayerObservationV1>;
      actionPanel: Readonly<ActionPanel>;
      abilities: Readonly<AbilityPanel> | null;
    }>
  | Readonly<PacketBase & {
      kind: 'hand-result';
      handNumber: number;
      handResult: Readonly<HandResultSummary>;
    }>
  | Readonly<PacketBase & {
      kind: 'game-result';
      winnerSeatIndex: number;
      finalStacks: readonly Readonly<{ seatIndex: number; stack: number }>[];
    }>;
```

### 5.1 索引语义

- `packetIndex`：首个包为 0，之后每个新交付包严格加 1。
- `decisionKey`：固定格式为 `hand/<handNumber>/seat/<seatIndex>/decision/<decisionIndex>`；同一扑克决策点保持不变。
- `acceptedCommandIndex`：成功的人类命令计数，不进入公开包。
- 核心 `decisionIndex`：仍只统计当手已接受的 `PlayerActed`。
- 核心 `eventIndex` / `state.version`：仍只统计核心领域事件。
- `sessionEventIndex`：能力模式会话事件的独立连续索引。

能力成功后：

- 新包 `packetIndex + 1`。
- `decisionKey` 不变。
- viewer-safe 核心事件增量恒为空：peek/read 不产生核心事件，swap 的核心事件固定被投影器 suppress。
- 私有增量恰好一条。
- 换牌后重新投影 observation，立即显示新手牌。
- 能力面板不再提供能力命令，下一条只能是正常扑克行动。

非法命令不产生新包，也不改变任何索引。

### 5.2 能力面板与私有知识

```ts
interface AbilityPanel {
  readonly remaining: Readonly<Record<AbilityId, 0 | 1>>;
  readonly usedThisDecision: boolean;
  readonly availableCommands: readonly AbilityCommandView[];
  readonly knowledge: readonly PrivateKnowledgeEntry[];
}

type PrivateKnowledgeEntry =
  | Readonly<{
      type: 'peek';
      targetSeatIndex: number;
      street: Street;
      card: Card;
    }>
  | Readonly<{
      type: 'read';
      targetSeatIndex: number;
      street: Street;
      band: 'weak' | 'medium' | 'strong';
      algorithmVersion: 'known-hand-monte-carlo-v1';
    }>
  | Readonly<{
      type: 'swap';
      street: Street;
      holeCardIndex: 0 | 1;
      discardedCard: Card;
      replacementCard: Card;
    }>;

type PrivateAbilityNotice = PrivateKnowledgeEntry;

interface AbilityCommandView {
  readonly ability: AbilityId;
  readonly command: string;
  readonly label: string;
}
```

能力模式的决策包始终包含该面板；能力全部用完时仍可显示历史情报，但 `availableCommands` 为空。经典模式为 `abilities = null`。`privateEventsSinceLastPacket` 只含自上一个包新增的结果；`knowledge` 是本手仍有效的累计私有侧栏。

Adapter 必须把 `knowledge` 当作完整快照替换本地显示，而不是自行追加；收到 `hand-result` 或 `game-result` 后立即清空侧栏。这样重连或重复读取当前包都不会丢失情报，也不会跨手泄漏。

### 5.3 增量游标

增量必须按核心版本范围计算：

```text
eventLog.slice(fromVersionInclusive, toVersionExclusive)
    ↓ viewer-safe projection
viewerEventsSinceLastPacket
```

这里的 `PublicGameEvent` 是“对当前 viewer 安全”的既有类型，其中可能包含人类自己的底牌，并不等于可广播给所有人的 spectator 事件。不能按投影后的事件数量移动游标，因为完整牌堆、烧牌和换牌事件会投影为空；否则浏览器或 CLI 会重复或漏掉事件。

能力模式的私有增量同理从 `sessionEventLog.slice(deliveredSessionEventCount)` 投影，然后把 delivery cursor 推进到完整 session event 数量；不能只按成功投影出的私有 notice 数量推进。

### 5.4 ActionPanel

`PlayerObservationV1` 保持 AI 观察契约，不为 UI 文案增加字段。TurnPacket 额外提供：

```ts
interface ActionPanel {
  readonly currentBetTo: number;
  readonly facingBet: boolean;
  readonly tableCommittedTotal: number;
  readonly heroContestableTotal: number;
  readonly commands: readonly RenderableCommand[];
}

type RenderableCommand =
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
```

- `tableCommittedTotal` 是当前桌面全部 `committedHand` 之和。
- `heroContestableTotal` 表示“若玩家选择当前合法 call（没有 call 时支付 0），支付后最多可争夺多少”。令 `callPay = legalActions.call?.pay ?? 0`，`contestCap = hero.committedHand + callPay`：

```text
tableCommittedTotal = sum(seat.committedHand)
heroContestableTotal = callPay + sum(min(seat.committedHand, contestCap))
```

- 面对跟注时显示“当前桌面投入 X；跟注 C 后你最多可争夺 Y”。无需跟注时显示“当前桌面投入 X；你当前可争夺 Y”。不得把封顶值笼统称作总底池。
- 行动阶段不提前把不等额投入标记为“主池/边池”；只有核心结算完成、资格集合最终确定后才显示主池和边池。
- `currentBetTo === 0` 时使用“下注到”；已经存在下注时使用“加注到”。
- 跟注即全下时只显示 `c 跟注 321（全下）`，不再重复显示同义 `a 全下 321`。
- 可以过牌时同时接受 `x` 与安全别名 `c`。
- 面对下注输入 `x` 时固定提示：`当前不能过牌，请跟注或弃牌。`

数值例：

1. 普通跟注：投入 `[10,20,20]`，玩家已投 10、需跟 10。桌面当前 50，跟注后可争夺 60。
2. 短码全下：投入 `[10,200,200]`，玩家只剩 90。桌面当前 410，投入全部 90 后最多可争夺 300；其余筹码不属于该玩家的可争夺范围。
3. 已形成全下封顶：投入 `[50,100,200,200]`，首位是当前玩家且只剩 50，面对本街投入到 100。桌面当前 550，跟注 50 后最多可争夺 400；另外 200 属于其他深码玩家之间的争议筹码。最终主/边池名称仍等核心结算后再显示。

## 6. 三种能力的精确规则

### 6.1 共同前置条件

能力解析器在读取随机源或生成事件前依次验证：

1. 模式为 `ability-lab`。
2. 当前存在下注街和当前行动者。
3. 当前行动者等于 `humanSeatIndex`，状态为 `active` 且仍有筹码。
4. `expectedPacketIndex` 等于当前 pending packet。
5. `decisionKey` 等于当前包。
6. 对应能力仍有一次次数。
7. 本决策尚未成功使用其他能力。
8. 能力专属参数合法。

成功事件本身代表能力已消耗，不单独生成 `AbilityChargeConsumed`，避免出现“已扣次数但能力效果尚未发生”的可回放中间态。

### 6.2 偷看一张底牌

命令：

```text
u peek <座位>
```

目标必须：

- 不是人类自己。
- 物理座位存在。
- 状态为 `active` 或 `all-in`。
- 持有两张未公开底牌。

能力随机路径：

```text
ability/ability-lab-v1/<handNumber>/<decisionIndex>/<acceptedCommandIndex>/peek
```

只消费一次随机值，选择索引 `0 | 1`。成功事件记录目标、索引和卡牌；私有 UI 只显示目标、卡牌和读取街道。另一张牌、牌堆、烧牌和未来公共牌不得进入输出。

### 6.3 读取粗略牌力

命令：

```text
u read <座位>
```

目标规则与偷看一致。读牌是作弊信息，但不是读取完整权威未来：

- 已知信息仅包含目标真实两张手牌和当前公共牌。
- 其他存活玩家手牌按未知牌采样，不使用其真实底牌。
- 不使用烧牌、权威牌堆顺序或未来公共牌。
- `livePlayerCount` 包含状态为 `active` 或 `all-in` 的所有玩家，包括目标本人。

从现有权益估算器抽取通用纯函数：

```ts
interface KnownHandEquityInput {
  readonly holeCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly livePlayerCount: number;
}

interface KnownHandEquityAudit extends EquityEstimate {
  readonly equityUnits: number;
  readonly equityUnitScale: 60;
  /** Index 0..4 means hero tied among 2..6 winners. */
  readonly tieSplitCounts: readonly [number, number, number, number, number];
}

estimateKnownHandEquity(
  input: KnownHandEquityInput,
  samples: number,
  random: RandomSource,
): KnownHandEquityAudit;
```

普通 Agent 的 `estimateEquity()` 验证 `PlayerObservationV1` 后委托该函数，再只返回现有 `EquityEstimate` 五个公开字段，保持结果形状和数值不变。能力层直接传入窄化后的已知手牌输入，不伪造目标为当前 actor，也不把权威状态交给估算器。

固定常量：

```text
READ_STRENGTH_SAMPLE_COUNT = 1000
READ_STRENGTH_ALGORITHM_VERSION = known-hand-monte-carlo-v1
```

能力随机路径：

```text
ability/ability-lab-v1/<handNumber>/<decisionIndex>/<acceptedCommandIndex>/read
```

分档：

```text
fairShare = 1 / livePlayerCount

weak   : equity < 0.8 * fairShare
medium : equity >= 0.8 * fairShare 且 equity < 1.5 * fairShare
strong : equity >= 1.5 * fairShare
```

会话私密事件记录 `street`、`band`、`algorithmVersion`、`sampleCount`、`livePlayerCount` 和内部估算统计，以便精确回放与审计。TurnPacket 私有投影只输出目标、街道、档位和算法版本，不输出原始 equity、样本牌、种子或真实手牌。

结果不会随新公共牌自动更新；每个结果明确标注读取时街道。

### 6.4 更换一张底牌

命令：

```text
u swap <1|2>
```

CLI 的 `1 | 2` 在领域层转换为 `holeCardIndex: 0 | 1`。能力可在翻牌前、翻牌、转牌或河牌的人类决策点使用。

换牌不消费额外随机源。新牌严格等于 `deck[dealCursor]`，因此会自然改变后续 burn 和公共牌，但不改变已经发出的公共牌。

新增核心权威事件：

```ts
interface HoleCardReplacedEvent extends HandEventBase {
  readonly type: 'HoleCardReplaced';
  readonly seat: number;
  readonly holeCardIndex: 0 | 1;
  readonly discardedCard: Card;
  readonly replacementCard: Card;
}
```

事件不重复记录游标前后值；reducer 从当前状态推导并验证：

- 当前 phase 是四个下注街之一。
- `seat === currentActorSeat` 且座位是 funded active actor。
- 座位持有两张尚未公开的底牌。
- `discardedCard` 等于目标槽当前牌。
- `replacementCard` 等于权威牌堆下一张。
- 牌堆仍有可消费卡牌。

成功后在一个核心 reducer 步骤中：

1. 旧牌追加到 `abilityDiscardedCards`。
2. 新牌替换目标底牌。
3. `dealCursor += 1`。

`HandState` 增加可选字段：

```ts
readonly abilityDiscardedCards?: readonly Card[];
```

经典模式从不创建该字段，避免改变经典状态的序列化形状。每手开始时自然恢复为缺省。

`HoleCardReplaced` 永远不投影成 `PublicGameEvent`。`projectObservation()` 必须识别并忽略此事件，不增加 `decisionIndex`。换牌玩家通过私有能力事件看到变化；NPC 只在后续合法公开结果中看到最终手牌或被改变后的公共牌。

## 7. 卡牌账本与规则不变量

换牌后，原有“当前底牌永远等于最初发牌事件”的假设不再成立。牌账本改为按当前手事件顺序重建：

1. `HoleCardsDealt`：从牌堆前缀发到各座位。
2. `HoleCardReplaced`：旧牌从目标手牌移动到能力弃牌区；牌堆下一张进入目标槽。
3. `CardBurned`：牌堆下一张进入烧牌区。
4. `CommunityCardsDealt`：牌堆接下来的 1 或 3 张进入公共牌。

每个事件前缀必须满足：

```text
deck.slice(0, dealCursor)
= 当前所有底牌 + abilityDiscardedCards + burnedCards + board
```

这里的等号表示相同数量、相同实体牌、多重集合一一对应，并同时满足：

- 52 张牌全局唯一且 canonical。
- `dealCursor` 等于所有从牌堆消费的牌数。
- 牌堆消费顺序严格等于事件顺序。
- 换出的旧牌只存在于能力弃牌区，不会再次进入公共牌或其他玩家手牌。
- 未消费牌不会出现在任何目的地。
- 摊牌求值和派奖只使用最终手牌。
- 筹码守恒和底池不变量保持原义。

## 8. 会话事件与原子回放

### 8.1 事件模型

能力模式使用独立、私密的会话事件流：

```ts
type SessionEvent =
  | CoreEventApplied
  | OpponentCardPeeked
  | OpponentStrengthRead
  | HoleCardSwapResolved;

type ClassicDomainEvent = Exclude<DomainEvent, HoleCardReplacedEvent>;
```

普通核心事件逐个包装：

```ts
interface CoreEventApplied {
  readonly type: 'CoreEventApplied';
  readonly schemaVersion: 1;
  readonly sessionEventIndex: number;
  readonly source: 'automatic' | 'npc' | 'human-poker';
  readonly commandIndex: number | null;
  readonly event: ClassicDomainEvent;
}
```

`CoreEventApplied` 不允许包装 `HoleCardReplaced`。换牌必须用单个 `HoleCardSwapResolved`，其中内嵌一个经核心 reducer 验证的 `HoleCardReplacedEvent`。Session reducer 在同一步内扣除 swap 次数、记录本决策已使用能力、更新私有记录并应用核心事件。

偷看和读牌成功事件同样原子地代表效果与次数消耗，不另发扣次事件。

能力事件固定包含以下权威字段；若后续增加权威字段，需要提升会话 schema：

```ts
interface AbilityEventBase {
  readonly schemaVersion: 1;
  readonly sessionEventIndex: number;
  readonly commandIndex: number;
  readonly handNumber: number;
  readonly street: Street;
  readonly decisionKey: string;
  readonly actorSeatIndex: number;
}

interface OpponentCardPeeked extends AbilityEventBase {
  readonly type: 'OpponentCardPeeked';
  readonly targetSeatIndex: number;
  readonly revealedHoleCardIndex: 0 | 1;
  readonly revealedCard: Card;
}

interface OpponentStrengthRead extends AbilityEventBase {
  readonly type: 'OpponentStrengthRead';
  readonly targetSeatIndex: number;
  readonly band: 'weak' | 'medium' | 'strong';
  readonly algorithmVersion: 'known-hand-monte-carlo-v1';
  readonly sampleCount: 1000;
  readonly livePlayerCount: number;
  readonly estimate: KnownHandEquityAudit;
}

interface HoleCardSwapResolved extends AbilityEventBase {
  readonly type: 'HoleCardSwapResolved';
  readonly authorityEvent: HoleCardReplacedEvent;
}
```

`OpponentStrengthRead.estimate` 只存在于含私密数据的会话回放中；玩家投影不包含该字段。

`CoreEventApplied.source` 为 `automatic` 或 `npc` 时 `commandIndex = null`；为 `human-poker` 时，`commandIndex` 必须等于该扑克命令提交前的 `acceptedCommandIndex`。

### 8.2 双索引

- `sessionEventIndex` 对全部 SessionEvent 从 0 连续递增。
- 内嵌 DomainEvent 的 `eventIndex` 只对核心事件从 0 连续递增。
- `acceptedCommandIndex` 对成功的人类命令连续递增。

三者不得互相代用。

### 8.3 版本

```text
SESSION_SCHEMA_VERSION = 1
ABILITY_RULES_VERSION = ability-lab-v1
READ_STRENGTH_ALGORITHM_VERSION = known-hand-monte-carlo-v1
```

`SessionReplayEnvelopeV1` 固定为：

```ts
interface SessionReplayEnvelopeV1 {
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
```

导出私密回放不能只凭普通 play handle。authority-only 模块使用独立、不可伪造的 capability：

```ts
declare const sessionAuthorityBrand: unique symbol;
interface SessionAuthorityCapability {
  readonly [sessionAuthorityBrand]: true;
}

exportSessionReplay(
  capability: SessionAuthorityCapability,
): SessionReplayEnvelopeV1;
```

`SessionAuthorityCapability` 只由内部 authority host 创建，不随 `SessionStep`、`SessionCommandResult` 或 TurnPacket 返回。`exportSessionReplay` 不从根 `src/index.ts`、CLI 入口或浏览器客户端 bundle 导出；普通 adapter 即使持有 `GameSessionHandle` 也无法读取私密 envelope。测试必须静态检查根导出表和浏览器依赖图不包含 authority-only 入口。

为保持现有 `events: state.eventLog` 调用在 TypeScript 中兼容，`ReplayEnvelopeV1.events` 继续声明为 `readonly DomainEvent[]`；`replayTournament()` 的运行时 validator 必须明确拒绝 `HoleCardReplaced`。另提供 `assertClassicEventLog(events)` / `createClassicReplayEnvelope(state)` 供新代码在导出前主动收窄和校验。能力回放只能走 `SessionReplayEnvelopeV1`，并要求换牌事件只能内嵌于 `HoleCardSwapResolved`。`CoreEventApplied.event` 仍使用 `ClassicDomainEvent`，因此新的 session 代码在类型层不能把换牌包装成普通核心事件。

回放不读取系统时间或 `Math.random()`。随机能力的最终结果写入私密事件，回放不重新运行 Monte Carlo；reducer 校验记录与当时权威状态、索引、算法版本和统计结构一致。偷看卡牌必须等于事件所指目标槽。读牌必须满足：

```text
ties = sum(tieSplitCounts)
wins + ties + losses = samples
equityUnits = wins*60
            + tieSplitCounts[0]*30
            + tieSplitCounts[1]*20
            + tieSplitCounts[2]*15
            + tieSplitCounts[3]*12
            + tieSplitCounts[4]*10
equity = equityUnits / (60 * samples)
```

所有计数必须是非负安全整数，超过 `livePlayerCount` 的 tie winnerCount 槽必须为 0，并由 equity 唯一推导分档。每个 SessionEvent 前缀都必须能重建：

- 核心 TournamentState。
- 能力剩余次数。
- 私有情报。
- 当前决策能力锁。
- acceptedCommandIndex。
- 能力弃牌区和发牌游标。

TurnPacket 是由重建后的会话状态与版本游标确定性产生的传输视图，不直接作为权威事件保存。

和现有 `DeckPrepared` 一样，V1 回放保证结构、事件权威与结果可重建，但不提供签名或防篡改证明。攻击者若同时重写一组内部完全自洽的私密随机结果，V1 不承诺检测；这属于服务端签名或加密回放的后续范围。

## 9. 隐私与安全投影

### 9.1 四层数据

1. **权威层**：完整牌堆、全部底牌、烧牌、runSeed、内部牌力和能力结果。
2. **人类 viewer 层**：本阶段的 TurnPacket，包含 `humanSeatIndex` 对应玩家的 `PlayerObservationV1`、viewer-safe 核心事件和被授权的能力情报；它是该人类座位的私有包，不是旁观包。
3. **NPC 决策层**：每个 NPC 仅得到以自己为 actor 的 `PlayerObservationV1 + DecisionContext.random`，不接收 TurnPacket 或能力侧栏。
4. **spectator 层**：只使用 `projectEventsForViewer(events, null)` 产生的不含任何座位私有手牌的事件批次；V1 不为 spectator 生成 TurnPacket。

CLI 与未来的人类玩家浏览器只能接收 human-viewer TurnPacket。现有 `onAuthorityEvents` 包含完整牌堆和所有底牌，不得传入 UI、浏览器、一般日志或错误消息。

### 9.2 投影规则

- `OpponentCardPeeked`、`OpponentStrengthRead`、`HoleCardSwapResolved` 不是 `PublicGameEvent`。
- NPC 的 `DecisionContext` 不增加能力字段。
- spectator 投影、NPC observation 和其他座位永远收不到玩家的私有能力记录。
- 私有情报在处理 `HandCompleted` 时清空，而不是等下一手开始。
- TurnPacket 使用安全克隆和递归冻结，不返回 authority 对象别名。
- TurnPacket 不含权威 handId、完整牌堆、烧牌、runSeed、未授权底牌或内部 HandRank vector。
- 错误消息使用固定拒绝码和安全中文文案，不序列化原始命令、权威状态或事件载荷。

### 9.3 能力可见差异

- 偷看/读牌后，公共事件、NPC observation 和 NPC RNG 与不用能力的相同行动局保持一致。
- 换牌当下不产生公共事件；未来公共牌因发牌游标顺延而改变是能力的合法公开后果。
- 摊牌只显示最终底牌；旧牌保持私密。

## 10. CLI 交互

### 10.1 启动参数

新增：

```text
--mode <classic|ability-lab>
```

`--mode`、`--players`、`--seed` 顺序无关，各自最多一次。所有参数校验通过后才能生成缺省随机种子。

未传 `--mode` 时先询问：

```text
请选择模式（1 经典模式 / 2 能力实验，直接回车默认 1）：
```

随后再询问缺失的牌桌人数。显式传入 `--mode classic` 时不出现模式提问。

示例：

```bash
npm run play -- --mode classic --players 4 --seed classic-demo
npm run play -- --mode ability-lab --players 6 --seed ability-demo
```

### 10.2 命令

正常扑克命令继续支持：

```text
f
x
c
r <加到的总额>
a
```

能力命令：

```text
u peek <座位>
u read <座位>
u swap <1|2>
```

建议显示：

```text
能力：u peek <座位> | u read <座位> | u swap <1|2>
操作：f 弃牌 | c 跟注 4 | r 12-100 加注到 | a 全下 100
```

`parseTurnCommand(input, packet)` 是纯解析器；不执行能力、不写输出。外层循环负责解析、提交、显示拒绝或新包。

能力成功后立即重显同一决策：

```text
私有情报：座位 2 的一张底牌是 K♥（翻牌读取）
能力：本决策已使用能力，请完成扑克行动
操作：f 弃牌 | c 跟注 4 | r 12-100 加注到 | a 全下 100
```

经典模式输入 `u ...` 必须显示明确的“经典模式不能使用能力”，不能落入笼统无效操作。

### 10.3 语义节奏块

现有逐行 pacer 保留为兼容 API；新 CLI 使用语义块：

```ts
interface RenderBlock {
  readonly kind:
    | 'ordinary-actions'
    | 'street-reveal'
    | 'showdown'
    | 'settlement'
    | 'decision';
  readonly delayBeforeMs: 0 | 1000;
  readonly text: string;
}
```

固定行为：

- 连续盲注和普通玩家行动合并为一个 `ordinary-actions` 块，块内不逐行等待。
- 翻牌、转牌、河牌显示前等待 1 秒。
- 摊牌显示前等待 1 秒。
- 结算表显示前等待 1 秒。
- 决策面板立即显示。
- 结算包完整渲染后才请求驱动器开始下一手。
- 测试注入假时钟，不真实等待。

## 11. 结算摘要

本手结算不再逐条重复打印 `PotConstructed`、`PotAwarded` 和 `HandCompleted`；这些事件仍完整保存在回放中，由纯聚合器生成一张总结表。

```ts
interface HandSeatResult {
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

interface HandResultSummary {
  readonly handNumber: number;
  readonly seats: readonly HandSeatResult[];
  readonly pots: readonly Readonly<{
    potId: string;
    label: '底池' | '主池' | `边池 ${number}`;
    amount: number;
    eligibleSeatIndexes: readonly number[];
    winnerSeatIndexes: readonly number[];
    awards: readonly number[];
  }>[];
}
```

计算：

```text
invested = 盲注投入 + 所有 PlayerActed.paid
potWon   = 该座位从所有 PotAwarded 获得的筹码
returned = 所有 UncalledBetReturned
net      = potWon + returned - invested
```

固定表头：

```text
玩家 | 手牌 | 牌型 | 赢得底池 | 本手投入 | 退回 | 净结果
```

展示规则：

- 一个玩家赢多个底池时合并为一行。
- 退款单列，不再使用含糊的“总收入”。
- 进入摊牌者显示权威牌型和最佳五张。
- 未亮牌的 NPC 显示 `—`，不得从权威状态补齐。
- 人类即使已经弃牌，也可显示自己已知的两张底牌。
- 表后直接给出赢家结论。
- 最终只有资格集合不同才显示“主池 / 边池”；资格相同的相邻层按现有规则合并。

## 12. 拒绝码与错误纯度

能力拒绝码固定为：

```ts
type AbilityRejectionCode =
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
```

拒绝场景至少覆盖：

- 经典模式调用能力。
- 无进行中牌局、不是人类回合、人类已弃牌/全下/淘汰。
- 旧 `decisionKey`、旧 `expectedPacketIndex` 或重复提交。
- 能力已耗尽。
- 同一决策使用第二种能力。
- 目标是自己、不存在、已弃牌、已淘汰或已经公开底牌。
- 换牌索引不是 CLI `1|2` 或领域 `0|1`。
- 畸形对象、字符串座位、小数、负数、超大整数。

每次拒绝后以下值必须与干净对照组逐字段相同：

- 核心 state、version、eventLog。
- session eventLog 和 sessionEventIndex。
- charges、privateKnowledge、decisionKey。
- acceptedCommandIndex、packetIndex 和公共事件游标。
- 下一次合法能力的随机结果。

能力成功后若扑克操作非法，能力消耗不回滚；只拒绝扑克操作并继续等待合法扑克行动。

## 13. 测试与验收

本阶段采用“小而充分”的测试矩阵，不复制现有规则引擎的大量压力测试。

### 13.1 经典模式门禁

- 在改控制器前固化一个短局完整 golden fixture。
- 相同种子、配置、座位和扑克行动下，重构前后核心最终状态与事件日志逐字段相同。
- 牌堆、筹码、Agent RNG 路径和现有 `ReplayEnvelopeV1` 保持不变。
- `classic` 中三种能力全部拒绝。
- 现有完整测试套件继续通过。

### 13.2 TurnPacket

- 初始决策 → 成功能力 → 正常行动 → NPC 行动组 → 新街的完整流程。
- 能力前后 `decisionKey` 相同、`packetIndex` 递增。
- 核心版本范围连续且不重叠，公开事件不重复、不漏发。
- 玩家弃牌、玩家淘汰和比赛结束均可产生独立 `hand-result` / `game-result`。
- 本手总结完整显示后才出现下一手。

### 13.3 三种能力

- 偷看：固定种子锁定随机牌位；只扣 peek；全下目标合法；本手结束清空。
- 读牌：弱/中/强和两个阈值等号均有纯函数测试；四条街可用；只输出档位。
- 换牌：固定牌堆验证旧牌进入弃牌区、新牌是游标下一张、后续公共牌顺延、河牌换牌和最终摊牌正确。
- 每个能力成功后仍必须提交正常扑克行动。

### 13.4 隐私双世界

- 偷看：两世界被偷看的牌相同，其他隐藏牌不同；比较范围固定为“能力提交前状态到能力结果包”，在同一公开事件前缀上 NPC observation、spectator 事件投影和 viewer-safe 核心事件完全相同，玩家包不含未偷看的牌。
- 读牌：两组不同真实手牌落在同一档位时，比较范围同样截止到能力结果包；玩家只得到目标、街道、档位和版本，不得到手牌、原始 equity、种子或采样明细。
- 换牌：比较范围截止到换牌结果包；换牌当下 viewer-safe 核心增量为空，NPC 不知道能力发生，旧牌永不公开；之后未来公共牌顺延差异被允许。
- 所有人类 viewer、NPC 和 spectator 输出均不含完整牌堆、烧牌、runSeed、权威 handId 或内部牌力 vector；含私密数据的 `SessionReplayEnvelopeV1` 明确包含 runSeed，不属于 viewer-facing 输出。

### 13.5 RNG、回放与不变量

- 不用能力与使用 peek/read 的两局，在扑克行动相同时核心事件与 Agent RNG 结果相同。
- 非法命令后再使用合法能力，与直接使用合法能力得到相同随机结果。
- 每个 SessionEvent 前缀重建的核心状态、次数、情报、索引、弃牌区和游标逐字段一致。
- 篡改 mode、版本、索引、非法目标、偷看卡牌与目标槽不一致、读牌统计与档位不一致，或换牌卡牌与权威状态不一致时会被拒绝。
- 换牌后每个核心事件前缀仍满足 52 张牌账本和筹码守恒。
- 运行 2–6 人 × 3 种能力的 15 个固定种子完整会话，检查有限步结束、无停滞、筹码守恒、牌唯一和回放一致。
- 不新增另一套 100 手能力随机门禁；经典规则已有 2–6 人随机覆盖。

### 13.6 人工体验验收

自动测试不能证明“像活人”。至少完成一次 4 人和一次 6 人终端试玩，确认：

- 普通 NPC 行动不会逐行拖慢。
- 新街、摊牌、结算仍有清晰停顿。
- 玩家无需翻历史日志即可看懂当前底池、需跟金额和合法操作。
- 能力结果在当前手内持续可见，且不会挤乱正常行动菜单。
- 结算表能直接回答“谁赢了、赢了多少、为什么有边池”。

人工试玩结果单独记录；自动测试通过不能替代人工体验结论。

## 14. 建议模块边界

建议新增：

```text
src/game/tournament-driver.ts
src/game/session-types.ts
src/game/session-events.ts
src/game/game-session.ts
src/game/session-replay.ts
src/game/turn-packet.ts
src/game/ability-strength.ts
src/core/hole-card-replacement.ts
src/cli/turn-command.ts
src/cli/turn-renderer.ts
src/cli/semantic-pacing.ts
```

建议修改：

```text
src/game/tournament-controller.ts   # 兼容适配到 driver
src/core/events.ts                  # HoleCardReplaced
src/core/state.ts                   # reducer 与可选弃牌区
src/core/invariants.ts              # 新卡牌账本
src/core/public-events.ts           # 明确 suppress 换牌事件
src/core/replay.ts                  # classic 明确拒绝能力事件
src/agents/equity.ts                # 抽取通用 known-hand estimator
src/agents/observation.ts           # 安全识别并忽略换牌事件
src/cli/options.ts                  # --mode
src/cli/index.ts                    # session + packet composition
src/index.ts                        # 仅导出稳定公开接口
```

具体文件拆分可在实施计划中微调，但职责边界不得合并成一个同时持有权威状态、UI、能力和随机数的大型控制器。

## 15. 实施分期建议

该设计包含 UX 驱动器和能力系统两个子系统，实施时必须使用三个可独立验收的里程碑，不能在一个大提交中同时重写：

### 里程碑 A：经典回合包

1. 固化经典模式 golden fixture，并抽取可暂停 TournamentDriver。
2. 定义 TurnPacket、delivery API、行动面板、结算聚合器和语义节奏。
3. 只在 classic 模式跑通 CLI，证明核心事件、筹码与 Agent RNG 不变。
4. 完成一次 4 人经典模式人工试玩。

完成 A 后即得到可独立使用的“更像活人”的 classic CLI；能力系统尚未接入也不影响该里程碑成立。

### 里程碑 B：信息能力会话

1. 建立 ability-lab GameSession、模式、命令索引、次数、私有知识和 Session replay 骨架。
2. 实现偷看能力、私有投影和 RNG 隔离。
3. 抽取权益估算纯函数并实现读牌能力。
4. 完成隐私双世界、非法输入纯度和 classic/ability-lab 模式隔离。

完成 B 后，能力实验模式可使用偷看和读牌；纯德州模式继续可选。

### 里程碑 C：权威换牌

1. 实现核心 `HoleCardReplaced`、能力弃牌区和新卡牌账本。
2. 接入原子的 `HoleCardSwapResolved`、CLI 命令和完整 session replay。
3. 完成 2–6 人 × 3 能力的 15 个固定种子会话、完整回归和 6 人人工试玩。

完成 C 后三种能力全部可用，本阶段才达到最终完成标准。

任一步发现经典核心事件、Agent RNG 或规则结果发生变化，都应先停止并修复兼容性，再继续后续能力。

## 16. 非目标

- NPC 使用、识别或反制能力。
- 怀疑值、作弊被抓、能力费用或平衡系统。
- 能力成长、装备、卡组、肉鸽奖励和剧情。
- 跨手永久情报、玩家画像或长期对手记忆。
- 浏览器牌桌、动画、音效、头像和美术资源。
- 联网多人、账户、服务端存档和公共回放分享。
- 回放文件加密、签名或防作弊服务端验证。
- 完整终端 TUI；本阶段仍是普通文本 CLI。

## 17. 完成标准

本阶段完成需要同时满足：

1. 玩家可选择 classic 或 ability-lab，经典模式核心行为不变。
2. TurnPacket 能在决策、本手结算和比赛结束三个边界稳定交付，无事件重复或遗漏。
3. 偷看、读牌、换牌各可成功一次，非法使用完全纯净。
4. 能力信息只向人类玩家投影，NPC 与旁观者不泄漏。
5. 换牌后的牌堆、游标、弃牌区、未来公共牌、摊牌和 52 张牌账本全部正确。
6. Session replay 可逐前缀精确重建核心和能力状态。
7. CLI 的普通行动成组显示，新街/摊牌/结算延迟 1 秒，玩家面板立即显示。
8. 结算表直接解释赢家、投入、退款、净结果和真实边池。
9. 现有完整自动化测试、类型检查和构建继续通过。
10. 至少完成一场 4 人与一场 6 人人工试玩，并单独记录体验结论。
