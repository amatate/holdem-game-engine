# GitHub Pages 可玩单机版

地址：<https://amatate.github.io/holdem-game-engine/>。

GitHub Pages 只托管静态 HTML/CSS/JS。此构建不代理 localhost，不要求运行 Node，也不是截图展示页。

## 运行与构建

```bash
npm ci
npm run check
npm run build
npx vitest run --maxWorkers=1 --testTimeout=30000
npm run build:pages
npm run preview:pages
```

预览默认地址：`http://127.0.0.1:4182/holdem-game-engine/`。可用 `HOLDEM_PAGES_PORT` 调整预览端口。正常 Node 版仍是 `npm run web`。

工作流 `.github/workflows/pages.yml` 在 main 推送或手动触发时执行验证，只发布 `.pages-dist`。必须在仓库 Settings → Pages 中选择 GitHub Actions。没有自定义域名、云后端或额外密钥。

## 代码边界

- `table-session.ts`：Node 与 Pages 共用的开局、阵容、公开视图、人物记忆、教学与近期结算记录。
- `transport.ts`：Node 模式使用原 HTTP API；Pages 模式只向专用 Worker 发送 JSON 请求。没有失败后自动重发下注。
- `browser-api.ts`：同一 GameSession 的浏览器宿主，检查旧牌桌、旧决策、教学限制、能力限制和保存时机。
- `browser-worker.ts`：隔离运行规则计算，不占用 UI 线程；只返回公共视图及玩家获准看到的情报。
- `browser-store.ts`：IndexedDB 原子保存，并比较已有存档 ID，避免另一个标签页静默覆盖。
- `proxy-detection.ts`：Node 保留原检测；构建工具仅在 Worker 包替换为 `browser-proxy-detection.ts`。浏览器无法可靠识别 Proxy，因此对外输入必须先经过结构化消息和 JSON 解析；不接受插件对象、函数或自定义 Participant。

浏览器单机不具备服务端防作弊、隐藏牌库保密或防开发者工具篡改保证。引擎没有向 NPC 泄露额外信息，但访问者控制自己的浏览器，因此不要用此架构承载真人对战、真钱或可信排行榜。

## 存档

仅结算时保存随机种子、已接受操作和结果摘要，以重放恢复能力次数、人物记忆、剧情选择和教学答案。刷新后主页提供继续入口，不恢复未完成的一手，也不重复派奖。牌局与存档不上传服务器。

按源码构建版本、2 MiB 大小、1,000 次操作与 30 秒重放上限校验。不同构建或损坏的存档不直接恢复，原记录保留；新开桌成功结算时才替换同一旧存档。另一标签页更新后拒绝覆盖并显示错误。禁用存储／空间不足时牌局仍可继续，但不能保证续玩。

存档绑定当前网站路径及浏览器。清理网站数据会删除记录；不提供账号、云同步、跨设备和 localhost 导入。

## 验证记录

- 适配前：62 文件／813 项串行测试通过。
- 适配后：63 文件／823 项测试通过（包含浏览器 JSON 宿主、恢复摘要、能力与教学、存储失败、旧版本拒绝，以及原 Node 边界回归）。
- 本地真实静态页面：四人经典全下，五张公共牌、底池 201、玩家结算筹码 201；刷新后点击继续，公共牌与筹码一致，未重复派奖。静态图片和 Worker 均从 `/holdem-game-engine/` 子目录加载。
- 公开网址的部署状态以对应 Actions 运行结果为准；自动测试不等于完整设备兼容性或人工玩法平衡验收。
