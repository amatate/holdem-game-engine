# Browser Classic Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved slice inline. Steps use checkboxes for tracking.

**Goal:** Deliver a locally playable browser classic table without changing poker rules or NPC decisions.

**Architecture:** A loopback Node server owns GameSession. A pure public-view reducer and HTML renderer serve a native TypeScript browser client. Only whitelisted compiled client files and public JSON are exposed.

**Tech Stack:** Existing TypeScript, node:http, Vitest, HTML/CSS. No new packages.

**Spec:** `docs/superpowers/specs/2026-09-05-browser-classic-design.md`

## Global Constraints

- Preserve CLI, core, NPC algorithms and the dirty main checkout. Work only in the existing linked worktree; sources/ is read-only.
- 2–6 players, default 4, existing auto roster. Classic only, no cloud deployment.
- Node owns all hidden state; browser never receives deck, run seed or unexposed NPC cards.

## Task 1: Public view + local table service

Files: `src/web/protocol.ts`, `src/web/view.ts`, `src/web/server.ts`, `tests/web/server.test.ts`, `tests/web/view.test.ts`.

Interfaces: `createLocalServer(): http.Server`; `advanceTableView(previous, packet, roster): TableView`; `WebTable = {id, roster, packet, view}`. HTTP: GET `/api/bootstrap`, POST `/api/table` with `{players}`, POST `/api/action` with `{tableId,command}`, POST `/api/continue` with `{tableId,expectedPacketIndex}`. Errors are fixed safe messages, stale operations include current table to resynchronize.

- [x] Write tests against actual loopback requests and actual GameSession; a valid action must increment packetIndex, resubmitting that action must not advance it.
- [x] Run `npm test -- tests/web`; observe missing implementation failure.
- [x] Implement public-event view, session Cookie, request guards, bounded in-memory table lifetime and whitelisted static serving.
- [x] Re-run focused tests and `npm run check`.

## Task 2: Browser play surface

Files: `src/web/render.ts`, `src/web/client.ts`, `src/web/index.html`, `src/web/style.css`, `tests/web/render.test.ts`, `package.json`.

Interfaces: `renderLobby(rosters, playerCount): string`, `renderTable(table): string`; client delegates actions through `data-action` to the service. HTML always escapes textual data. Buttons derive solely from current packet commands. No browser imports from the core at runtime.

- [x] Write renderer tests for legal controls, hidden cards, escaping, actual settlement rows and stale-action eligibility.
- [x] Run focused tests to see new renderer tests fail.
- [x] Implement one coherent playable desktop/mobile route and `npm run web` as build plus local service startup.
- [x] Compile, start retained server, request its exact local URL; open the meaningful preview before secondary refinements.

## Task 3: Handoff and regression

Files: README and this progress checklist; optional feature-detected WebMCP surface if supported by browser.

- [x] Check the new HTTP boundary on 2/6-seat tables and a complete hand, including rejected duplicates and next-hand acknowledgement.
- [x] Run `npm test`, `npm run check`, `npm run build`, `git diff --check`.
- [x] Keep the preview available for the user; document startup and current limits. Report what was actually verified, not human acceptance or cloud publication.

## 交付记录（2026-09-05）

- 完成第一段浏览器经典桌；第二段偷看能力尚未实施。
- 最终自动验证：52 个测试文件、705 项测试通过（新增 12 项）；类型检查、构建、diff 检查通过。
- 实际 loopback HTTP 验证了 2/6 人开桌、六人桌完整一手、筹码与净结果对账、重复命令、下一手、刷新及延迟旧请求。
- 客户端断线恢复通过真实 client/renderer + 浏览器 IO 测试替身验证；这不是实际浏览器点击或视觉验收。
- 编译后首页、样式和全部浏览器模块均 HTTP 200；本地服务保留在 http://127.0.0.1:4173/。
- 独立只读审查无剩余阻塞问题；发现的旧请求竞争和断线恢复停在大厅问题均已回归修复。
- 浏览器实际操作与窄屏视觉验收尚未进行，已向用户发出可选检查问题；不将自动验证标为人工接受。
- 可选只读 WebMCP 工具已做注册/输入契约单测，未在支持它的真实浏览器上下文验证；不影响普通浏览器玩法。
- 本地交付，不合并主分支、不推送、不发布 Release。原主目录的 package-lock.json 和 AGENTS.md 改动未触碰。
