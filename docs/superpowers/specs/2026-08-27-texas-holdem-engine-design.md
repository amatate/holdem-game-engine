# TypeScript 德州扑克底层引擎 V1 设计规格

日期：2026-08-27
状态：设计已在对话中确认，等待用户复核本文件后进入实施计划

## 1. 目标

构建一个零运行时依赖、可在 Node.js 与浏览器中复用的 TypeScript 无限注德州扑克引擎。V1 先证明三件事：

1. 2–6 人德州扑克规则在常规与边界情况下都正确。
2. 人类玩家可以在终端中与三名具有不同牌风的 AI 完成一场单桌淘汰赛。
3. 相同配置、版本、随机种子和行动序列可以得到完全相同的牌局与回放。

V1 不包含主角能力或作弊机制。未来能力系统必须通过独立扩展接口接入，不得污染基础规则、隐藏信息投影和底池结算。

## 2. 已确认的产品决策

- 语言：TypeScript。
- 交付形态：无界面规则核心、角色决策层、对局控制器和可玩的终端适配器。
- 默认对局：一名人类玩家对三名 AI，单桌淘汰赛。
- 引擎人数：可配置 2–6 人。
- 规则：锦标赛式 No-Limit Texas Hold'em、table stakes、整数筹码。
- 实现策略：自建规则状态机与牌力判断；开源项目仅作为架构和测试参照，不复制其源码，也不成为正式运行依赖。
- 随机测试硬门槛：至少 100 手牌，覆盖 2–6 人配置；10,000 手牌为可选压力测试，不作为 V1 完成条件。

## 3. 默认比赛体验

- 四个座位：玩家、林岚“猎手”、阿凯“疯狗”、莫叔“跟注站”。
- 另提供老周“岩石”配置，可替换任意默认 AI。
- 每名玩家初始 100 筹码。
- 初始盲注 1/2，即 50BB。
- 每 8 手牌提升一次盲注，默认等级为：1/2、2/4、3/6、5/10、10/20、20/40、40/80、80/160；若比赛在最后一级后仍未结束，之后每一级把 SB 和 BB 分别翻倍。
- 无 ante、rake、rebuy、straddle、保险、run-it-twice 或真钱兑换。
- 仅剩一名筹码大于零的玩家时比赛结束。
- 目标单局时长为 20–40 分钟；该时长是设计目标，不是规则正确性的验收条件，须在实现后的真人试玩中确认。

## 4. 范围与非目标

### 4.1 V1 范围

- 52 张无鬼牌标准牌组。
- 每手在 flop、turn、river 前各烧一张牌；烧牌属于内部隐藏信息，不进入玩家或 AI 观察。
- 固定物理座位；淘汰后不压缩座位编号。
- 按钮、大小盲、四轮下注、All-in、主池、任意层数边池、退款、摊牌、平分、奇数筹码和淘汰。
- 可注入固定牌堆或随机种子。
- 完整领域事件日志与精确回放。
- 人类终端输入和参数化角色 AI。
- Node.js 测试、批量模拟和浏览器兼容构建。

### 4.2 V1 非目标

- 主角能力、作弊、装备、剧情和肉鸽升级。
- 联网多人、账户、匹配、排行榜和服务端持久化。
- 图形界面、动画和声音。
- GTO 求解器、强化学习和长期对手模型。
- 现金局、抽水、真钱、提现或类真钱付费系统。
- 发牌失误、string bet、oversized chip 等真人牌桌裁判问题。
- sit-out、missed blind、重购、比赛名次细分和并列淘汰排序。

## 5. 总体架构

系统分为四层：

```text
CLI Adapter
    ↓
Tournament Controller
    ├── Human Participant
    └── PokerAgent
            ↓
PlayerObservation → ActionIntent
            ↓
Pure Rules Core
    ├── validate intent
    ├── reduce state
    ├── emit domain events
    └── advance automatic phases
```

### 5.1 规则核心

规则核心是唯一权威来源，持有完整牌堆、所有底牌和内部状态。它只接受结构化行动，不认识角色姓名、性格或 UI。

建议公开 API：

```ts
createTournament(config, participants, runSeed): TournamentState
startHand(state): TransitionResult
getLegalActions(state, seatId): LegalActionSet
projectObservation(state, seatId): PlayerObservationV1
applyIntent(state, seatId, intent): TransitionResult
advanceAutomaticPhases(state): TransitionResult
replay(initialConfig, eventLog): TournamentState
```

`TransitionResult` 返回新状态与本次产生的领域事件。被拒绝的行动不得改变状态、事件数量或状态版本。

### 5.2 角色决策层

角色只消费显式白名单生成的 `PlayerObservationV1`，并返回一个 `ActionDecision`。规则核心必须再次验证行动，不能信任 AI。

### 5.3 对局控制器

控制器负责选择当前参与者、调用人类或 AI、把行动提交给规则核心、推进自动阶段、开始下一手并判断比赛结束。控制器不得直接修改筹码、发牌或决定赢家。

### 5.4 终端适配器

终端只负责展示公开状态、玩家自己的底牌、合法操作、AI 行动和比赛结果。以后替换为网页界面时，规则核心、事件格式和角色接口保持不变。

## 6. 核心领域模型

所有筹码使用非负安全整数。公共 API 的加注金额统一表示“本街累计投入到多少”，字段名使用 `raiseTo`，绝不表示额外增加量。

```ts
type Street = 'preflop' | 'flop' | 'turn' | 'river';

type Phase =
  | 'waiting'
  | 'post-blinds'
  | 'deal-hole'
  | 'preflop'
  | 'deal-flop'
  | 'flop'
  | 'deal-turn'
  | 'turn'
  | 'deal-river'
  | 'river'
  | 'showdown'
  | 'settlement'
  | 'hand-complete'
  | 'game-complete';

type PlayerHandStatus = 'active' | 'folded' | 'all-in' | 'eliminated';
```

每个座位至少包含：

- `playerId`、`seatIndex`、`stack`、`status`。
- 内部 `holeCards`。
- `committedStreet`：本街累计投入。
- `committedHand`：本手累计投入，包含盲注和弃牌前的投入。
- `lastActedAtBetTo`：本街最近行动时面对的最高累计下注目标，用于判断短码 All-in 是否重新开放加注。

每手牌至少包含：

- `handId`、`handNumber`、`phase`、`board`、牌堆与发牌游标。
- `buttonPosition`、`smallBlindSeat`、`bigBlindSeat`。
- `currentActorSeat`。
- `currentBetTo`：本街所有未弃牌玩家需要匹配的最高累计投入。
- `lastFullRaiseSize`：下一次完整加注所需的最小增量。
- `lastAggressorSeat`：本街最后一次提高 `currentBetTo` 的玩家；短码 All-in 也更新此字段。
- 仍需行动或响应的座位集合。
- 初始总筹码，用于持续验证筹码守恒。

`currentBetTo`、`lastFullRaiseSize` 和 `lastAggressorSeat` 必须分开维护，不能用一个“最后下注”字段替代。

## 7. 行动与领域事件

```ts
type ActionIntent =
  | { readonly type: 'fold' }
  | { readonly type: 'check' }
  | { readonly type: 'call' }
  | { readonly type: 'raiseTo'; readonly amount: number }
  | { readonly type: 'allIn' };
```

`allIn` 是便利输入，进入规则核心后必须归一化为 call-all-in、bet-all-in、short-raise-all-in 或 full-raise-all-in。

最小领域事件集合：

- `GameStarted`、`HandStarted`、`PositionsAssigned`。
- `BlindPosted`、`HoleCardsDealt`、`CommunityCardsDealt`。
- `BettingRoundStarted`、`PlayerActed`、`BettingRoundClosed`。
- `UncalledBetReturned`。
- `ShowdownStarted`、`HandEvaluated`。
- `PotConstructed`、`PotAwarded`。
- `PlayerEliminated`、`HandCompleted`、`GameCompleted`。
- `AgentInvalidAction`，仅由控制器记录，不改变规则结算。

包含底牌或内部牌力的事件必须有私密投影；面向玩家和 AI 的公开日志在摊牌前不得泄露隐藏牌。

## 8. 规则口径

### 8.1 按钮、盲注与行动顺序

- 三人及以上采用锦标赛 dead-button 规则；按钮可位于刚淘汰玩家的空座，某一手允许没有小盲，但必须有大盲。
- 正常情况下，按钮左侧第一名存活玩家交 SB，再左侧交 BB。
- preflop 首位行动者是 BB 左侧第一名可行动玩家。
- postflop 首位行动者是按钮左侧第一名可行动玩家。
- 底牌从按钮左侧首个有资格玩家开始顺时针发两轮。
- 短码盲注只投入其剩余筹码，不能出现负数，仍收牌并保有对应底池资格。
- 多人牌局中，短码 BB 不降低其他玩家需要达到的完整 BB bring-in。
- HU 中若 BB 短码 All-in，按钮/SB 只需匹配 BB 实际能够赢取的金额；若内部先按完整 BB 处理，超额必须立即形成显式退款，且对外合法动作与最终净额相同。

Heads-up 特例：

- 按钮同时交 SB，另一人交 BB。
- BB 收到每轮第一张底牌。
- 按钮/SB 在 preflop 先行动，在 postflop 后行动。
- 三人转两人时按大盲连续性确定新 BB，避免同一玩家连续跳过大盲义务。

### 8.2 合法动作

- 只有当前行动者且状态为 `active` 的玩家可以行动。
- 所有金额必须是非负安全整数；`NaN`、`Infinity`、小数和越界金额一律拒绝。
- `toCall = max(0, currentBetTo - committedStreet)`。
- `toCall === 0` 时可以 check；无人下注时可 bet，正常最小开注为 BB，筹码不足时只允许短码 bet-all-in。
- `toCall > 0` 时可以 fold 或 call；call 自动支付 `min(toCall, stack)`。
- `maxRaiseTo = committedStreet + stack`。
- 正常 `minRaiseTo = currentBetTo + lastFullRaiseSize`。
- 低于正常最小加注且保留筹码的 underraise 非法；只有把全部剩余筹码投入的 short all-in raise 合法。
- 如果没有任何仍有筹码的对手能够响应，不提供 raise，超额无人跟注部分在结算前退款。

### 8.3 完整加注与短码 All-in 重开

每街初始化：

- preflop：`currentBetTo` 为完整 BB bring-in，`lastFullRaiseSize` 为 BB。
- postflop：`currentBetTo = 0`，`lastFullRaiseSize` 为 BB。

任何提高 `currentBetTo` 的行动都会更新 `lastAggressorSeat`。只有当加注增量至少等于 `lastFullRaiseSize` 时才是完整加注，并更新 `lastFullRaiseSize`。

对已经在该街行动过的玩家，仅当以下条件成立时重新取得加注权：

```text
currentBetTo - lastActedAtBetTo >= lastFullRaiseSize
```

尚未在该街行动的玩家即使只面对短码 All-in，仍保有正常加注权。短码 All-in 没有重开加注，不等于其他玩家无需补齐新的 `currentBetTo`。

### 8.4 下注轮闭合与自动推进

不能仅以“所有投入相等”判断闭轮，因为无人加注时 BB 仍有 check/raise 选择。闭轮要求：

- 所有仍有筹码的未弃牌玩家已匹配 `currentBetTo`。
- 所有仍有筹码的未弃牌玩家均完成该街所需行动或响应。

自动边界：

- 只剩一名未弃牌玩家：立即进入 fold settlement，不再发公共牌，不调用 evaluator。
- 没有可行动玩家：自动发完公共牌并摊牌。
- 只剩一名可行动玩家且无需补筹码：自动发完公共牌。
- 只剩一名可行动玩家但仍欠筹码：只允许 fold 或 call，不能向无人能跟注的对手 raise。

### 8.5 退款、主池与边池

结算时按所有玩家的 `committedHand` 唯一升序层级切分底池：

```text
layerAmount = (cap - previousCap) * count(contribution >= cap)
eligible = nonFolded players with contribution >= cap
```

- 已弃牌玩家的投入计入金额，但该玩家永远不在 eligible 中。
- 最高贡献层若只有一名贡献者，该层为未跟注额，先退款，不进入底池。
- 每个主池或边池独立保存金额和 eligible 玩家。
- 每个池独立比较牌力、平分和处理奇数筹码。
- fold 胜利同样先退未跟注额，再把争议筹码给唯一未弃牌玩家。

### 8.6 摊牌、平分和淘汰

- 玩家可从两张底牌和五张公共牌中任选五张组成最佳牌，因此可使用 0、1 或 2 张底牌。
- 花色完全平等，不能打破平手。
- 平分时先整数均分；余下的奇数筹码从按钮左侧第一名该池并列赢家开始顺时针分配，每个边池重新计算。
- 所有人 All-in 且下注结束后，所有仍参与任何底池的牌自动公开。
- 非全下摊牌时，river 最后 aggressor 先亮；river 无下注时由按钮左侧第一名未弃牌玩家先亮。
- 本手中的零筹码 All-in 玩家仍有资格赢池，只有全部退款和派彩完成后，筹码仍为零者才转为 `eliminated`。
- 结算后仅剩一名筹码大于零的玩家时发出 `GameCompleted`，不得再开始新手牌。

## 9. 手牌求值器

求值器为项目自有纯 TypeScript 实现：

1. 验证牌数量、牌值、花色和全局无重复。
2. 从最多七张牌中枚举所有五张组合；德州摊牌固定为 `C(7,5)=21` 种。
3. 每种五张牌生成可按字典序比较的完整排名向量。
4. 返回最大向量及对应最佳五张牌。

排名向量必须完整覆盖：straight flush、four of a kind、full house、flush、straight、three of a kind、two pair、one pair、high card，以及每种牌型的全部踢脚。A2345 顺子按 5 高顺子处理；“皇家同花顺”是 A 高同花顺的展示名称，不是额外比较等级。

正式运行不依赖第三方求值库。测试阶段使用 PokerKit 或 pokersolver 的独立结果进行差分验证，测试 oracle 不参与生成自己的期望逻辑。

## 10. 随机性与回放

禁止规则和 AI 直接调用 `Math.random()` 或 `Date.now()`。从 `runSeed` 派生互不影响的随机流：

```text
deckSeed  = hash(runSeed, 'deck', handNumber)
agentSeed = hash(runSeed, 'agent', handNumber, seatId, decisionIndex)
equityRng = fork(agentSeed, 'equity-sampling')
sizingRng = fork(agentSeed, 'sizing')
```

- AI 消耗额外随机数不能改变发牌。
- 同一规则版本、洗牌算法版本、策略版本、配置、种子和行动历史必须产生同一结果。
- 回放保存初始配置、版本、实际规范化行动和所有领域事件；发牌可记录实际牌序，或同时保存种子与洗牌算法版本。
- 精确旧回放以记录的行动和发牌事件为准；重新运行新版 AI 不是旧回放的一部分。

## 11. AI 可见信息与防作弊边界

`PlayerObservationV1` 通过白名单显式构建并冻结，只包含：

- 自己的两张底牌。
- 已公开的公共牌。
- 按钮、盲注、街道和当前行动位。
- 所有座位的公开筹码、投入和 active/folded/all-in/eliminated 状态。
- 当前底池、公开可推导的边池和公开行动历史。
- 当前精确合法动作、call 金额、最小和最大 `raiseTo`。

它不得包含：

- 其他未公开底牌、弃牌者 muck 的牌、烧牌、未来公共牌或牌堆顺序。
- 主随机种子、规则引擎实例、真实剩余牌堆或预先计算的赢家。
- 其他角色的内部性格参数和随机流。
- 包含隐藏信息的内部事件日志或任何可变的权威状态引用。

V1 角色跨手无记忆。未来对手模型只能消费公开事件的派生统计。

## 12. 角色 AI

```ts
interface PokerAgent {
  readonly agentId: string;
  decide(context: Readonly<DecisionContext>): ActionDecision;
}
```

大多数角色共享 `ParametricHoldemAgent`。其 `StyleProfile` 包含：

- `looseness`：弱起手牌进入范围的程度。
- `aggression`：偏好主动 bet/raise 的程度。
- `bluffing`：弱牌或听牌进入主动范围的程度。
- `stickiness`：拿边缘牌继续跟注的倾向。
- `positionAwareness`：早位、按钮和盲位差异的权重。
- `riskAppetite`：进入大底池和 All-in 的意愿。
- `slowPlay`：强牌慢打倾向。
- `variability`：有限的策略混合温度。
- `sizing`：偏好尺寸与尺寸波动。

四个 V1 角色：

| 角色 | 核心牌风 | 预期可观察行为 |
|---|---|---|
| 老周“岩石” | 紧、偏被动 | VPIP 低，主动下注范围强，持续受压时弃牌较多 |
| 林岚“猎手” | 紧凶 | 重视位置，强牌主动取价值，使用少量合理诈唬 |
| 阿凯“疯狗” | 松凶 | 高频入池、高频施压、大尺寸较多，波动高 |
| 莫叔“跟注站” | 松、偏被动 | 很少主动加注，边缘牌也常跟注，难被普通诈唬赶走 |

每次决策基于：

- 起手牌或当前牌力。
- 听牌潜力。
- pot odds。
- 位置。
- 有效筹码与 SPR。
- 约 300 次、使用 AI 私有随机流的确定性蒙特卡洛 equity 采样。

蒙特卡洛必须从“排除 AI 已知牌后的全新未知牌集合”采样，不能读取权威状态中的真实剩余牌堆。下注尺寸仅从最小加注、半池、四分之三池、满池和 All-in 中选择，并裁剪到合法范围。

AI 返回非法动作时：

- 单元测试和开发模式直接抛出错误。
- 可玩终端模式记录 `AgentInvalidAction`；能 check 则 check，否则 fold。
- 规则核心永远不会静默把非法下注金额改成另一个看似合法的 raise。

V1 不追求 GTO 或职业牌手强度；目标是基本牌理合理、风格可解释、差异可重复测量。

## 13. 文件结构

```text
src/
  core/
    cards.ts
    random.ts
    hand-evaluator.ts
    state.ts
    positions.ts
    legal-actions.ts
    reducer.ts
    pots.ts
    replay.ts
    events.ts
  agents/
    types.ts
    observation.ts
    equity.ts
    style-profile.ts
    parametric-agent.ts
    characters.ts
  game/
    tournament-controller.ts
    participant.ts
  cli/
    index.ts
    renderer.ts
    prompts.ts
tests/
  core/
  agents/
  integration/
  fixtures/
```

文件可以在实施中进一步拆小，但不得跨越上述层级边界，例如 CLI 不能直接调整筹码，AI 不能导入牌堆或内部状态模块。

## 14. 测试策略

### 14.1 规则单元测试

必须覆盖：

- 全部牌型、A2345、所有踢脚、board plays 和完全平局。
- 2–6 人按钮、盲注与行动顺序。
- HU 按钮/SB 和 preflop/postflop 顺序。
- 短码 SB/BB 与多人完整 BB bring-in。
- check/call/fold/raiseTo/allIn 的合法与非法输入。
- BB 无人加注时的最后 check/raise option。
- 最小加注、保留筹码 underraise 拒绝、short all-in 接受。
- 单个和多个 short all-in 对不同玩家是否 reopen。
- 所有人 All-in 自动 runout；一人未弃牌时立即 fold settlement。
- 任意层主池和边池、弃牌贡献、未跟注额退款。
- 各池独立赢家、平分和奇数筹码。
- 派彩完成后淘汰，以及 3 人转 HU。

### 14.2 全局不变量

每次成功状态转换后验证：

- 所有筹码和投入为非负安全整数。
- 筹码、已投入底池、待退款和待派彩的总和恒定。
- 52 张实体牌无重复；每名参与者两张底牌；公共牌最多五张并按 3/1/1 增长。
- 当前行动者必须 active、非 all-in 且至少有一个合法动作。
- fold 玩家永不成为任何池的赢家。
- `sum(pots) + sum(refunds) = sum(committedHand)`。
- 每手在有限状态转换内结束。
- 相同输入产生相同事件流；事件重放产生逐字段相同的权威状态。

### 14.3 必须锁定的数值案例

以下案例的结果属于规格，不允许由实现自行解释：

1. BB=10，A `raiseTo 30`，完整加注增量为 20；B 的最小 `raiseTo` 为 50，不是 60。
2. A bet 100，B All-in 到 150；回到已经行动的 A 时只能 fold 或 call，不能 raise。
3. A bet 100，B All-in 到 125，C call 125，D All-in 到 200，E call 200；回到 A 时累计面对增加 100，A 可以 raise；若 A call，回到 C 时只累计增加 75，C 不能 raise。
4. 贡献为 `[25, 50, 100, 100]` 时，生成金额 100 的主池、金额 75 的第一边池、金额 100 的第二边池；总额 275。
5. 贡献为 `[60, 100, 200]` 且无人能继续跟注时，最高贡献者退款 100；争议底池为 180 的主池和 80 的边池，总额 260。
6. 101 筹码由两名玩家平分时得到 50/51；额外一枚给按钮左侧起第一名该池并列赢家。
7. 所有人 preflop 只 call 到 BB 后，不能直接发 flop；BB 必须得到一次 check 或 raise 的行动机会。
8. HU 中按钮/SB preflop 先行动、postflop 后行动；该顺序必须同时在正常筹码和短码 BB All-in 场景成立。

### 14.4 随机测试

- V1 完成硬门槛：使用固定种子随机运行至少 100 手牌；2、3、4、5、6 人配置各不少于 20 手，并覆盖不同筹码深度和盲注比例；每手均须终止并持续满足全部不变量。
- 可选 `test:stress`：运行至少 10,000 手牌，用于发布前或规则大改后的人工压力验证，但不是 V1 完成条件。
- 求值器对随机七张牌与独立 oracle 做差分。

### 14.5 AI 隔离与牌风测试

- 双世界测试：两份权威状态具有相同可见信息，但对手底牌、烧牌和未来牌不同；投影结果和同 seed 决策必须相同。
- 隐藏牌哨兵、逐座位投影、muck 历史与不可变性测试。
- AI 多消耗随机数不得改变发牌序列。
- 负数、小数、`NaN`、`Infinity`、越界 raise 和非法 check/call 必须被拒绝。
- 使用至少 200 个固定的 preflop 决策夹具，并让每个角色在完全相同的牌、位置、筹码、前序行动和种子集合上决策：阿凯的继续入池率至少比老周高 20 个百分点，主动 raise 率至少高 15 个百分点。
- 使用至少 200 个固定的 postflop 边缘牌面对下注夹具：莫叔的 fold 率至少比老周低 20 个百分点。该测试验证角色相对顺序，不声称模拟真实职业牌手统计。

## 15. 错误处理

- 配置错误、重复玩家、非法座位、无效筹码或无效牌直接拒绝创建比赛。
- 玩家或 AI 非法行动不改变规则状态。
- 规则不变量失败属于程序错误，立即中止并输出 handId、事件索引、种子和最小可复现场景。
- CLI 输入错误应重新提示，不转换成其他行动。
- 回放版本不兼容时明确拒绝，不尝试猜测旧事件含义。

## 16. V1 完成标准

V1 只有同时满足以下条件才算完成：

1. 玩家可在终端与三名风格不同的 AI 打完一场默认单桌淘汰赛。
2. 引擎可配置 2–6 人，并能在纯 AI 模式下批量运行。
3. 已确认的牌型、下注、短码 All-in、边池、平分、淘汰和 HU 测试全部通过。
4. 至少 100 手牌随机不变量测试全部通过。
5. 相同 seed 和行动记录可精确回放。
6. AI 隐藏信息隔离测试通过，角色之间的牌风差异可通过统计稳定观察。
7. TypeScript 类型检查、Node.js 测试和浏览器兼容构建通过。
8. 真人实际完成至少一场终端比赛；这证明产品路径可用，不等同于已经验证长期乐趣或平衡。

## 17. 参考与许可证边界

规则依据优先采用：

- Poker Tournament Directors Association 2024 Rules：https://www.pokertda.com/poker-tda-rules/
- PokerStars Texas Hold'em Rules：https://www.pokerstars.com/poker/learn/lesson/texas-holdem-rules/
- PokerStars side-pot、heads-up blinds、minimum raise 与 small all-in 说明：https://www.pokerstars.com/help/articles/poker-rules-master/217425/

只读设计与测试参考：

- PokerKit：https://github.com/uoftcprg/pokerkit
- poker-engine-ts：https://github.com/Ge-limin/poker-engine-ts
- pokersolver：https://github.com/goldfire/pokersolver
- PyPokerEngine：https://github.com/ishikota/PyPokerEngine

这些项目不进入 V1 正式运行依赖，不复制其实现代码。若测试阶段安装任何 oracle 或测试工具，必须记录精确版本与许可证，并保证产品核心在移除该测试依赖后仍可独立构建和运行。
