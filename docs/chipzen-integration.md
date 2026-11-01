# ChipZen 接入与机器人评测

2026-10-19：已实现官方 JavaScript SDK 0.3.1 的本地适配与不计排名练习入口。账号已登录，`NightTable-Hunter-v0` 远程机器人已创建，令牌仅存本机且大厅认证成功；尚未完成线上对局。现有 `hunter-challenge` 策略原样保留为基线，没有将接入成功当作牌力提升。网页竞技练习及普通 NPC 不变。

## 如何开始

1. 登录 [ChipZen 机器人控制台](https://chipzen.ai/bots)，创建 `external_api` 类型机器人。注册、接受条款和生成令牌需账号持有人操作或针对相应步骤明确授权。
2. 将项目根目录 `.env.chipzen.example` 复制为 `.env.chipzen`，在本机编辑器中填写 `CHIPZEN_BOT_ID` 和 `CHIPZEN_BOT_TOKEN`。不要把令牌发到聊天、截图或 GitHub。令牌只显示一次，丢失需要在平台重新签发。
3. 在本项目工作目录运行：

```bash
# 只检查配置格式，不联网，也不代表认证通过
npm run ai:chipzen -- --check

# 离线：验证真实策略线程及硬超时
npm run ai:chipzen -- --worker-smoke

# 持续在线待机：只认证及回应心跳；不会创建或接入任何比赛
npm run ai:chipzen -- --standby

# 另开终端：查看本地状态、心跳时间、重连次数与最近掉线原因
npm run ai:chipzen -- --status

# 联网：只发起一场不计排名的官方 house-bot 练习，结束后退出
# 必须先在待机终端按 Ctrl+C；同一 bot 不能同时启动两个会话
npm run ai:chipzen -- --practice

# 仅恢复日志中的指定比赛，不新建；最多等 2 分钟
npm run ai:chipzen -- --resume <match-uuid>
```

命令需要支持 `--env-file-if-exists` 的 Node 22.9+；本次验证环境为 Node 26.7.0。令牌通过 SDK 的认证消息及 WebSocket 子协议传输，不放入 URL。`.env.chipzen`、`chipzen.toml` 和 `artifacts/chipzen/` 已忽略 Git；报告与日志以仅当前用户可读写的权限创建。

默认连接生产站；如账号和机器人属于测试站，设置 `CHIPZEN_ENV=staging`。只允许这两个官方域名。机器人保持唯一大厅连接，不要同时从两台机器启动同一 bot。连接会使其显示在线；本适配器只接受本次请求的那一场不计排名练习，不接受其他人发来的比赛。

### 在线待机与参赛是两件事

`--standby` 没有两分钟 / 十五分钟上限，持续运行直到 Ctrl+C / SIGTERM。它只建立大厅连接、认证和回应心跳；收到 `matched`（包括不计排名、恢复中的比赛）也只记录提醒，不连接比赛网关。**不要在网页发起挑战后期待待机程序自动参赛**，否则比赛仍可能超时。首战请先停止待机，再运行 `--practice`；该命令会自己上线并请求唯一的一场练习。站内自动接受挑战应保持关闭。

- 收到服务器 `hello` 后才显示在线，不把连接打开当成认证通过。
- 心跳直接在接收回调发送，不等待策略或 HTTP 请求。45 秒没有心跳会关闭旧连接并重连；普通网络失败以 2、4、8、16、30 秒上限加少量随机延迟退避，不密集重试。
- 令牌失效 / 撤销、连接限流、服务器错误或被其他实例替换时停止并报告，避免抢占连接或绕过平台限制；不自动升级额度。
- 同一工作目录、同一 bot 和环境下，待机 / 练习 / 恢复共用排他锁；不会相互踢下线。不同机器仍需自行保持唯一实例。正常退出释放锁；强杀 / 崩溃遗留锁时，检查锁中 PID 并确认原进程结束后，才手动删除错误提示中的那一个 `.lock` 文件。
- `--status` 是本地快照，不调用管理 API。进程存在且最近认证 / 心跳未过期才显示 `onlineConfirmed: true`，它不代表比赛就绪或已经完成对局。状态文件原子更新，日志及状态均只允许当前用户读写。
- 当前是前台长期运行命令，不是开机服务：需要保持终端和电脑运行；休眠、关机、进程退出都会掉线。没有安装开机启动或阻止电脑休眠。平台可能按大厅在线时长计免费额度，闲置时可 Ctrl+C 关闭。

挑战列表中的旧 `Your bot is offline` 是那次发起失败的历史结果，上线不会自动重跑旧挑战。当前在线状态应看机器人详情页的 CONNECTED 标记及新心跳。

## 哪些操作不需要浏览器

官方提供 HTTP API、WebSocket 协议和 JavaScript / Python / Rust SDK。出牌不依赖 Browser Use：本项目已直接复用 TypeScript 策略，通过官方 SDK 收发牌局消息。

| 操作 | 官方接口 | 本项目用法 |
| --- | --- | --- |
| 在线大厅与配对通知 | `wss://chipzen.ai/ws/external/bot/{bot_id}` | 机器人令牌认证、心跳、接收比赛通知 |
| 牌局状态、出牌与结算 | `wss://chipzen.ai/ws/external/match/{match_id}/{participant_id}` | 使用通知给出的网关，由 SDK 处理消息；本地保存脱敏战报 |
| 单场不计排名练习 | `POST /api/external-api/challenges/house-bot` | `--practice` 自动调用，只请求一次，不需点击网页 |
| 排名队列与指定远程对手 | `/api/external-api/matchmaking/*`、`/api/external-api/challenges/remote*` | 官方支持，但本项目未启用，也未报名 |
| 令牌管理、决策延迟统计 | `/api/external-api/bots/{bot_id}/tokens`、`/api/external-api/bots/{bot_id}/latency-stats` 等 | 需要人的 Clerk 会话身份，不能拿机器人令牌调用；不提取浏览器会话或尝试绕过权限 |

首次登录、创建机器人、签发令牌仍使用官方管理页面；运行时只需要本机令牌，不必保持管理网页打开。官方协议也提及 `chipzen-mcp`，本项目没有安装或验证它；已有 SDK 可完成机器人核心循环，暂不需要再加一层工具转发。

注意官方协议的令牌权限概述与后续新增的远程挑战小节存在更新不同步，应按具体接口小节和服务器实际响应确认。不能将机器人令牌等同于账号全权限 API Key。参考：[官方远程 API 协议](https://github.com/chipzen-ai/chipzen-sdk/blob/main/docs/EXTERNAL-API-BOT-PROTOCOL.md)、[官方 SDK](https://github.com/chipzen-ai/chipzen-sdk)。

## 实现范围

- 用官方 `@chipzen-ai/bot@0.3.1` 处理大厅、双层握手、请求编号、拒绝重试和重连；本项目的传输封装负责限定比赛、保存原始消息、心跳及计算线程调度。
- 当前只支持双人 NLHE。未经适配的变体、人数或缺少必要历史的消息会记录错误并安全回退，不猜测规则。
- SDK 的简化 `GameState` 不保留 `action_history.phase`，且缺少座位字段时会默认 0。适配器在 SDK 解析前保留原始消息，从 `match_start.seats.is_self` 识别自己，依据公开盲注历史恢复按钮位。
- 加注传总额；跟注只付所需增量，短码跟注不超过剩余筹码。全下转换为 `raise` 或 `call`，不发送 `all_in`。不会把非法加注静默截断为另一个下注。
- 原始历史的 raise 按本轮总额处理，call 按增量处理；校验重建投入与当前底池、跟注价格一致。官方旧文档中的个别示例金额有不一致，不能拿它们当线上成功证据；不一致的真实消息要先用日志定位，不修改下注去迎合错误。
- 只把自己的两张牌、公共牌、公开动作、筹码和合法动作交给策略。完整牌库、发牌种子和对手未亮底牌不进入策略；日志也去除认证字段和 `deck_reveal`。
- 每次决策用独立线程运行现有 600 次采样策略，最多 1500ms，按消息剩余时间另留 150ms 余量；线程超时即终止，主线程仍可回应心跳。异常只过牌或弃牌。
- 重连时同一请求编号复用已有动作，不重新随机；编号相同而局面改变则停止。进程内可恢复，退出进程后不会自动续打旧比赛；`--resume` 只允许显式指定的不计排名比赛，且不发新建请求。跨进程不保留请求缓存或策略随机种子，恢复结果不能当作完整、同一随机轨迹的评测。
- HTTP 创建练习只尝试一次，避免响应丢失后重复创建；额度错误不自动重试、不升级付费。单次会话上限 15 分钟，可用 Ctrl+C 结束。中止未结束比赛可能被平台判超时或弃权。
- 不上传容器、不报名赛事、不加入排名队列、不自动发布代码。平台的比赛结果可能公开；不计排名不等于私密。

## 看什么结果

每次真实运行保存 `artifacts/chipzen/<时间>-<随机后缀>.jsonl` 和 `.json`：可见局面、实际发送的动作、策略回退、平台拒绝/超时、手牌结算、比赛最终结果、源码构建指纹和策略采样数。没有完成、被取消/弃权、发生回退或没有真实决策时，不标记为干净评测。

本次真实接入已通过大厅认证与练习创建，但连接异常关闭、没有有效牌局数据，暂不能评估牌力。具体请求、比赛 ID 与恢复结果见[接入验证记录](playtests/chipzen-adapter-v0.md)。错误记录现保留原始请求错误、连接关闭码和 SDK 结果，不再被重试时的通用错误覆盖。

首战先验收协议：自己的座位正确、每笔钱正确、没有非法动作/超时，公开记录可逐手核对。特别检查实际升盲信息：当前盲注元数据来自平台 `game_config`，若线上升盲另用事件发布，必须补齐后再分析按 BB 归一化的结果。线上目前保留原始排名与分数，不伪造现金桌 `bb/100`。

强度结论需要多个对手和足够独立比赛。淘汰赛优先看每场输赢、起始筹码/盲注/时限、对手及版本；不能把一场里的每一手当独立比赛，也不能拿赢随机基线证明职业水平。

## 持续优化流程

1. 冻结当前版本、样本数和评测种子，保留带失败的报告，不挑掉输局。
2. 先修合法性、协议错位、超时及日志遗漏，再讨论策略。
3. 每轮只做一个候选改进，例如短码翻前范围、面对连续下注的范围更新，或针对跟注站的价值下注尺寸。与基线使用相同采样预算。
4. 开发种子与未用于调参的保留种子分开；同时对标准猎手、紧手、激进型和跟注站评测，轮换座位。用种子组级置信区间，避免同一组的换座结果被当作独立样本。
5. 候选通过离线回归后，手动启动有限场次的线上练习；确认多对手收益与稳定性，再决定是否进入网页。不会根据几场连胜自动替换正式 NPC。

本地对照命令示例：

```bash
npm run ai:arena -- --mode cash --blocks 100 --hero hunter-challenge --opponents hunter-standard --samples 600 --seed chipzen-holdout-a --decision-ms 5000
npm run ai:arena -- --mode cash --blocks 100 --hero hunter-challenge --opponents calling-station --samples 600 --seed chipzen-holdout-b --decision-ms 5000
```

这里是原有离线模拟器，不是 ChipZen 服务端；本地 5000ms 是避免将机器短暂停顿混入牌力对照的软期限，线上仍使用独立线程硬期限。测试通过不证明与线上全部边界一致。

## 官方资料

- [平台规则](https://chipzen.ai/rules)：机器人应使用官方 SDK 和公开 API；普通对局免费、无赌注；有独立的赛事奖励规则。
- [远程机器人开通](https://chipzen.ai/external-api/onboarding/)：账号、bot ID、令牌和本机运行方式。
- [官方 SDK](https://github.com/chipzen-ai/chipzen-sdk)及 [JavaScript 包](https://www.npmjs.com/package/@chipzen-ai/bot)：本项目锁定 0.3.1。
- [远程协议](https://github.com/chipzen-ai/chipzen-sdk/blob/main/docs/EXTERNAL-API-BOT-PROTOCOL.md)、[扑克状态](https://github.com/chipzen-ai/chipzen-sdk/blob/main/docs/protocol/POKER-GAME-STATE-PROTOCOL.md)、[传输协议](https://github.com/chipzen-ai/chipzen-sdk/blob/main/docs/protocol/TRANSPORT-PROTOCOL.md)。核对时 SDK 仓库 HEAD 为 `dae54ce7d44e468a2e14a2687912608da33493af`；线上行为仍需真实首战验证。

首页、引导页及早期公告的时限和示例有版本差异，实际运行以收到的比赛配置、合法动作、剩余时间和服务器校验为准。
