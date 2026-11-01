# 竞技 AI 实验版 v0 / Competitive AI laboratory

状态：本地基线与评测工具；2026-10-13 新增可玩的网页竞技练习入口。2026-10-19 新增独立的 [ChipZen 官方 SDK 适配与练习命令](chipzen-integration.md)，本地协议测试通过，机器人创建与大厅认证完成，线上首战尚未完成；未报名排名或奖金赛事，也未上传容器。没有新训练模型，普通模式 NPC 不变。

## 网页竞技练习

主页选择「进入竞技练习」即可对战同一 `hunter-challenge` 基线，固定 600 次采样、单挑、经典规则。200 筹码起始（盲注 1/2，即 100BB），沿用游戏每 8 手升盲的阶梯；不是 CLI 评测的倍增盲注预设，也不是已核实的 Chipzen 赛制。关闭跨手人物记忆和能力，保留林岚的形象，不以角色发言泄露策略。以淘汰定胜负，不提供经验证的段位或 Elo。结算点支持恢复。

网页集成仅复用 `src/arena/agents.ts` 的有限本地策略，不将 Node 评测驱动或任意第三方代码放入网页。Pages 在 Worker 中运行；Node 本地版仍在服务进程内运行。构建指纹覆盖 arena 策略变化，旧存档不静默重放。

[首次实际运行与验证记录](playtests/competitive-ai-v0.md)（包含负结果、超时污染及测试限制）。

## 第一版的目的

把规则正确、牌力提升、人物表现分开验收。沿用独立的 `PokerAgent` 接口，规则引擎决定合法动作；新增实验程序只接入经典规则，不使用能力、网页、人物对白或全局私有牌局状态作为策略输入。

`hunter-challenge` 是现有猎手的挑战策略，不是已证明最强的角色，不是新求解器。它保留单手公开范围推断与战术规则，但不加载网页人物互动的跨手记忆。每场、每个座位创建独立策略实例。默认挑战 600、标准 300 次胜率采样；要比较相同计算预算，传 `--samples 300`，实际预算记录在报告里。

## 运行

在项目目录安装依赖后：

```bash
# 100 个独立种子组，每组交换座位，共 200 手。每手重新买入 100BB。
npm run ai:arena -- --mode cash --blocks 100 --seed eval-v0-a --samples 300

# 与随机基线比较；赢随机玩家不证明职业或 GTO 水平。
npm run ai:arena -- --mode cash --opponents random --blocks 100 --seed eval-v0-b --samples 300

# 30 个种子组、共 60 场升盲淘汰赛；20BB 起步，每 5 手升盲。
npm run ai:arena -- --mode tournament --blocks 30 --stack-bb 20 --hands-per-level 5 --max-hands 100 --seed eval-v0-c --samples 300

# 六人混合场：这里只用少量牌和低采样做运行检查。
npm run ai:arena -- --players 6 --opponents rock,maniac,calling-station,random,check-call --blocks 5 --samples 48 --seed smoke-six-v0

npm run ai:arena -- --help
```

结果写到 `artifacts/arena/` 下带时间和随机后缀的新 `.json` / `.md` 文件，不覆盖以前的结果；该目录默认不入 Git。终端实时显示进度和结果路径。重复参数得到同样的动作、筹码结果与 `resultDigest`（未触发机器负载相关超时的前提下）；文件名、时间和耗时本身不相同。

退出码：0 为运行完成且无决策失败/未决场次；1 为参数或程序错误；2 为已保存报告但存在决策回退、未决场次或运行中源码变化。退出 0 **不等于**证明牌力提高。

## 实验设计

- 支持 2–6 人。第一位 entrant 是主测牌手，其余是指定对手；一个对手名称会填满所有其他座位，也可以给出恰好 `人数−1` 个名称。
- 每个种子组把整组牌手依次循环移位，让每个人坐遍所有物理座位。相同组共享牌库种子和初始按钮位，不用策略随机数消耗驱动发牌。
- 多人只采用循环移位，不是全部座位排列；同一组内结果相关。淘汰赛后续牌序的使用还会受淘汰和行动路径影响，不能声称完全消除运气。
- `cash` 每个 rotation 新建牌局、恢复筹码，只结算一手。净结果按初始大盲换算为 `bb/100`，不把赢得底池总额当作净赢。
- `tournament` 不重置筹码，初始盲注 1/2，每 `hands-per-level` 手翻倍，按引擎总筹码封顶。这是**本地预设，不是已经复现的 Chipzen 官方赛制**。仅剩一个有筹码者才是胜者。
- 达到 `max-hands` 仍未结束的比赛标记 `hand-cap`，绝不按筹码领先判胜。报告胜率下界（已赢场次/所有场次）与上界（已赢+未决/所有场次），不拿排除未决后的胜率冒充全体结果。
- 95% 区间使用 2000 次**种子组级** percentile bootstrap。少于 30 组、存在未决或任何策略回退时不提供区间。大底池、重尾分布、小样本仍可能使区间不稳定；30 组不是牌力认证门槛。
- JSON 记录每组各位置结果、动作摘要、精确选项、策略预算、规则/RNG 版本、Node 版本、源码 SHA-256 和 Git 状态。不要只记录一个会隐藏未提交变化的 commit ID。

## 错误与信息隔离

每次决策只传冻结的 `PlayerObservationV1` 和独立策略随机源。原始引擎的 `handId` 包含回放种子；实验入口将它换成不含发牌种子的手牌编号，不传牌库、弃牌、对手未公开底牌或权威状态。JSON 结果含离线回放种子，仅作本地测试，不发送给参赛对手。

非法动作、异常、异步超时与同步返回过晚分别计数；JSON 的 `failures` 记录对应种子组、轮换、手数、座位、下注轮、决策编号、耗时和回退动作，便于定位。回退只过牌或弃牌，不替机器人跟注或下注。不偷偷把错误加注截断到合法区间。计时只覆盖策略决策，不包含整套网络往返。电脑休眠或长时间暂停也可能触发超时；不要把这种运行当作干净的策略对照。

这是**可信本地策略的进程内工具，不是第三方代码沙箱**。异步等待有 watchdog，但超时不能取消任意后台工作；同步死循环也不能被同一事件循环中断。运行不可信程序前必须使用独立 worker/进程、硬期限、资源限额及重启机制。当前网页与本实验的正常代理均有有限计算量，CLI 不允许加载任意外部代码。

## 下一阶段门槛

1. 确认邀请活动的单挑/六人、筹码/升盲、托管/远程组、硬件和期限，以及比赛期间能否更新策略。
2. 接入官方协议的真实 schema 与 fixtures；验证 raise-to、短码跟注、最小加注、请求去重、断线重连与硬超时。先做本地协议测试，不以自造 JSON 冒充平台适配。
3. 将现有策略冻结为对照；使用与训练种子分离的评测种子。单独测试翻前/短码、范围质量或搜索的一项改进，保持其他条件相同。
4. 同时挑战多个风格和历史版本，避免只对一个弱基线过拟合。外部强基准需另行申请权限、遵守额度，不自动大量调用。
5. 策略变化只有在合法性、稳定性和独立评测均过关后才接入网页；角色表达继续与竞技强度解耦。

## English summary

This is a local baseline harness, not a stronger/newly trained poker AI. Existing heuristics are registered behind `PokerAgent`; ordinary NPC policies remain unchanged, while optional Competitive practice lets a human play the same hunter-challenge baseline at 600 samples. Use `npm run ai:arena -- --help` for options. Reports are bilingual and include source fingerprints, matched-deal cyclic seat rotations, independent-block bootstrap intervals, decision failures, and latency. Cash hands reset stacks; tournament matches use a local doubling-blind preset, not verified Chipzen rules. Capped matches remain unresolved. The watchdog is **not** a hard CPU sandbox. There is no network access, platform adapter, registration, upload, or submission in v0.
