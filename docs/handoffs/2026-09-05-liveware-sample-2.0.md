# 交接：Liveware Sample 2.0.0（示例活件 → 第一个活件的引导）

> 2026-09-05 · 交给 Joe 走发版链 · 设计 SSOT 在 ClawChat 仓 `docs/superpowers/specs/2026-09-05-liveware-sample-onboarding.md`（拍板在 §0，别重开方向）。

## 0. 这版是什么

Hermes / OpenClaw 插件在 agent 首次连上 ClawChat 时自动装的「Liveware Sample」，从「四条管道演示页」重做成**主人做出第一个活件的引导**：

1. 一屏介绍 + 三张方向卡（购物清单 / 纪念日倒计时 / 习惯打卡）→ 点卡深链回聊天，输入框预填固定句「把 Liveware Sample 换成购物清单」（永不自动发）；
2. agent 写 `state.json`（`stage:"tool"`、`tool`、`title`）+ `data.json` 置空 → 页面一秒内换成该工具，瓦片改名；
3. 主人在聊天里改数据（「把牛奶加进清单」）→ agent 改 `data.json` → 页面秒更；
4. 右下角 ✦「个性化」→ 写一句愿望 → agent 把模板复制到 `<root>/tool/index.html` 只改样式文案，写 `stage:"personalized"` → 顶上出收尾卡；
5. 收尾卡「体验完成，这个 Liveware 留给你了……不想要了随时让 Agent 帮你删掉」+「好的」→ 页面自己 `POST /stage {kept}`，引导壳退场；删除 = 主人在聊天里说，agent 走 `clawchat_unregister_app`。

**客户端零改动、后端零接口、插件代码零改动**。全部改动在本仓：

| 路径 | 内容 |
|---|---|
| `livewares/openclaw/liveware-sample/` | 壳 `index.html` + `app.js`（stage 机、i18n zh/en、深链）、三个扁平模板 `tool-*.html`、`server.mjs`（新增 `/tool/`、`/tool.json`、`GET/PUT /data`、`POST /stage`、SSE `data`/`tool` 事件）、`state.json` 缺省 `stage:"intro"`、`liveware.json` **2.0.0** |
| `skills/{openclaw,hermes}/clawchat-liveware-sample/SKILL.md` | **2.0.0**，description 逐字带固定句 zh/en（路由面） |
| `livewares/manifest.json` · `skills/manifest.json` | 已重生成，`pnpm livewares:check && pnpm skills:check` 绿 |
| `docs/architecture.md` | 示例包文件清单 + 「扁平」契约 |

两家插件仓的 `skills/` 快照已 `pnpm skills:sync` 刷好，各推在分支 `skills-v1.8.0-sync`（见 §2）。

## 1. 已验证到哪

- 本机 Playwright 28 项行为检查全过（深链固定句、SSE 换幕不刷新、`/data` 契约与手改秒更、✦ 面板、`/stage` 只允许 personalized→kept、无 agentId 回退等）；四幕 × 亮暗 × 375/402 × zh/en 截图与 app 内教育页并排对照过。
- **winrig 上 Otter（OpenClaw 2026.8.27-2，DeepSeek v4 flash）真机走完**：换工具、聊天改数据、个性化（青色主题副本）三幕都按技能做对了，PM 手机/桌面端看过。

## 2. Joe 要做的（照 `docs/release.md` §Release a skills / livewares change）

1. **打 tag** `skills-v1.8.0` 于本仓 `main` 的交接 commit，推 tag。
2. **挪 pin，三处同名**：
   - 本仓 `packages/core/src/config.ts` `DEFAULT_SKILLS_REF` → `skills-v1.8.0`
   - `clawchat-plugin-openclaw` `src/skill-update.ts` `DEFAULT_SKILLS_REF` → `skills-v1.8.0`
   - `clawchat-plugin-hermes-agent` `clawchat_gateway/skill_update.py` 现在是 **`"main"`**（不是 tag）：本仓 `main` 一推，Hermes agent 下次重启就已经在拉 2.0.0 了；要不要改钉 tag 由你定。
3. **合并快照分支**：两个插件仓各有 `skills-v1.8.0-sync`（`skills/` 快照 + `manifest.json`），bundled-skills 一致性测试要求它和 pin 一起进。注意 `clawchat-core` 那两处漂移也在里面（本仓 `main` 上更早的两个 commit，之前没同步过）。
4. **发版**：OpenClaw 走 npm（最近几次 huaijie 操作）；Hermes bump `plugin.yaml` / `__version__`。
5. **winrig**：两个 agent 更新插件、重启 gateway。Otter 那台当前吃的是我 Mac 上的 LAN 镜像（插件 dist 的 `OFFICIAL_SKILLS_BASE` 被改到 `http://192.168.2.122:8788`，原文件在旁边 `skill-update.js.bak-v170`），正式版发出后由我换回。

## 3. 两条平台事实（务必看，别的活件也会踩）

1. **`apps.clawling.io` 边缘把 `.js` 静态资源缓存 30 天 immutable**（`cf-cache-status: HIT`，`age` 5.6h 实测），无视源站 `cache-control: no-cache`，**且静态资源不校验登录**。升级后客户端拿到新 HTML + 旧脚本 → 白屏。示例包已在 `/` 里注入 `app.js?v=<内容哈希>` 绕过；平台侧建议评估缓存策略与静态资源的鉴权。
2. **边缘对 HTML 文档请求另有一道门**：iframe 直接导航 `/tool/` 回的是边缘自己的 400「这个链接打不开」页，而页面内 `fetch` / `EventSource` 一直通。示例包改成 `fetch('/tool.json')` 拿 JSON 再塞 `srcdoc` 绕过；平台侧请确认这是预期行为并写进活件开发文档。

## 4. 已知未收口（ClawChat 仓，不阻塞发版）

- spec §2/§3 要同步三处现场改判：✦ 入口「让它更像我的」→「个性化」；收尾卡改一键「好的」（固定句「留下这个 Liveware」已删）；页面语言改按容器 `?lang=` 契约（`container.md` §语言）而非 `navigator.language`。
- `docs/liveware/README.md` 状态板一行。
