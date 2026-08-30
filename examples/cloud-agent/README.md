# cloud-agent —— agent 侧协议的第二实现（容器里的云端 agent）

**它是什么**：一个跑在 Docker 容器里的、最小但完整的 ClawChat **agent 半边**实现，照
[`docs/external-interfaces/agent-protocol.md`](../../docs/agent-protocol.md)
从零写出来。约 300 行，零依赖（node 22 自带 `fetch` / `WebSocket` / `crypto`）。

**它为什么存在** —— 三件事，按重要性：

1. **它是那份文档的回归钉。** 文档漂了、后端契约变了，这个实现会跑不通，而不是等下一个
   重实现者去撞。`agent-protocol.md` 末尾那条「Refresh procedure」说的「a measured claim
   contradicted by a live probe」，这就是那个 probe。
2. **它是「云端 agent」的替身。** 容器没有 ClawChat、没有发现文件、只有出站网络 ——
   与一台云主机上的 agent 处境逐字相同。设备通道那条路（`machine-channel-contract.md`
   §0-bis 挂载面）在这里**结构性不可用**，只能走线上协议，这正是要验的。
3. **它回答了一个产品问题**：「一个 agent 能不能只凭一份标准文档写出接入程序？」
   —— 这 300 行全程没有一处需要猜，每个非显然的决定都在文档 §6 那张按踩坑代价排序的
   清单里等着。**文档够，缺的一直只是身份（一枚连接码）。**

---

## 跑它

### 先预检（**不消耗**连接码，可以随便试）

```sh
docker build -t clawchat-cloud-agent examples/cloud-agent
docker run --rm -e CLAWCHAT_CONNECT_CODE=<8 位码> clawchat-cloud-agent check
```

走的是 §1.3 那个安全预检端点，答 `{"pairable":true|false,"status":"pending|expired|invalid|paired"}`。

### 上线

```sh
docker run --rm -it \
  -e CLAWCHAT_CONNECT_CODE=<8 位码> \
  -v clawchat-agent-state:/state \
  clawchat-cloud-agent
```

上线后它给主人发一条招呼，之后你说什么它复述什么、并报一次往返毫秒。
**它没有脑子** —— 这一版只证明收发闭环，不接任何模型。

| env | 默认 | 说明 |
|---|---|---|
| `CLAWCHAT_CONNECT_CODE` | — | 连接码。**只经 `-e` 传**：不进镜像、不落盘、不打印 |
| `CLAWCHAT_REST` | `https://app.clawling.com` | |
| `CLAWCHAT_WS` | `wss://app.clawling.com/ws` | |
| `CLAWCHAT_STATE` | `/state/agent.json` | 身份与 token。**必须挂 volume** —— refresh token 是单次性的，丢了就得重新配对 |
| `CLAWCHAT_PLATFORM` | `cloud-agent-probe` | 被 `/connect` 拒则自动退回 `openclaw`（§1.3 那根保险丝） |
| `CLAWCHAT_MODEL_BASE` | —（空 = 无脑子） | OpenAI 兼容端点，例 `https://api.deepseek.com` |
| `CLAWCHAT_MODEL` | — | 例 `deepseek-v4-flash` |
| `CLAWCHAT_MODEL_KEY` | `none` | 模型 key。**只经 `-e` 传**，同连接码 |

**没配模型端点时它明说自己是探针**，不假装在聊天（🟡 降级不静默）。

⚠️ **连接码一次性。** TTL **实测 ≈30 分钟**（2026-08-30：`check` 回的 `expires_at`
距签发 29m56s），而文档旧口径写的是 5 分钟 —— 单次观测，别据此改契约，但也别按 5 分钟
去赶。失败的 `/connect` 也可能已经消耗掉它，重试前先用 `check` 确认还 `pairable`。

---

## 它实现了什么（以及为什么每一条都不能省）

全部来自 [`agent-protocol.md` §6](../../docs/agent-protocol.md)
那张「按踩坑代价排序」的清单 —— 这几条的共同点是**做错了不报错**：

| 条 | 做法 |
|---|---|
| **两个 device id** | REST 侧永远是字面常量 `clawchat-cloud-agent-probe`；WS 侧是 `sha256(channel\0owner\0user\0hostname)[0:24]` 派生。混淆它们 → refresh 收 400 → 自动登出 |
| **`message_id`** | `msg-` + 26 字符 Crockford base32 ULID。不是 UUID，不是 nanoid |
| **自回声守卫 fail closed** | 自己的 userId 取 JWT 的 `sub`；取不到 → 整条入站链不处理。失败开放 = 对生产账号打无限自回复 |
| **`message_mode: ""` 读作 `normal`** | 服务器下行不给默认值；照字面比对 `"normal"` 会丢掉每一条消息 |
| **`pong` 原样回显 `emitted_at`** | 重新盖戳是协议违规 |
| **绝不发给 `usr_…`** | 服务器**静默丢弃且无负 ack**。这里直接抛错拒发 —— 宁可炸也不要静默 |
| **refresh 顺序** | 落盘 → 换内存 → 重连 WS。顺序错了，崩溃时丢掉新的 refresh token |
| **`hello-fail` 精确匹配** | 只有逐字 `authentication failed` 是终局；其余（含 `auth service unavailable` 与任何未来新串）一律瞬时、原 token 退避重连 |
| **入站过滤链九步顺序** | `notify.signal` / `chat.metadata.invalidated` 必须在业务链**之前**分流出去 —— 它们被「这是不是 message.send？」滤死过三次 |

## 它**没有**实现的（如实记账）

- **上行流式**（协议本来就没有）、**媒体上传**、**群合并与门控**（§3）、**权限门**（§2.8）、
  **`notify.signal` 的各 type 动作**（§2.7）—— 收到即忽略，不假装懂。
- **refresh 的定时排程**只有反应式那一半（`hello-fail` / 401 触发），没有 §1.5 那个
  `exp − max(30min, …)` 的提前量。长跑要补。
- **群语义（§3）与媒体（§4）**仍不实现 —— 收到即忽略，不假装懂。媒体这一条对容器
  尤其诚实：它盘上没有文件可发。
- **权限门（§2.8）实现了，但只走通了一半**：21001 翻成 pending 交给模型、
  `permission_result` 在链外分流并回话 —— 但**没有真跑过一次审批**（要一件门后操作，
  目前只有 `delete_moment`，而它得先有一条自己的动态）。
- **上下文只在进程内**（每会话 12 轮）——容器重启即忘。真 agent 要落盘或走 `clawchat/memory/` 那一层。

## 验到哪一步了（2026-08-30）

| | 状态 |
|---|---|
| 容器出站 REST（DNS/TLS/头/信封） | ✅ `check` 拿到 `{"code":0,"data":{"pairable":false,"status":"invalid"}}` |
| 容器出站 WS + 第一帧 | ✅ `event=connect.challenge version=2` |
| 发现文件不可见 → 该走线上协议 | ✅ 容器里三条候选路径全 ABSENT |
| **激活** | ✅ 一枚真码换到 `agt_…` / `usr_…` / `cnv_…` 三件套 |
| **握手** | ✅ `hello-ok`，服务器回 `device_id` + `delivery_mode: device_replay` |
| **出站 + ack** | ✅ 招呼消息 `message.ack` |
| **入站过滤链** | ✅ 主人的消息穿过九步链正确落地（sender 认出、自回声未误杀） |
| **一次真往返** | ✅ **68 ms** |
| refresh 轮换 | ⬜ 未验 —— 要等 token 临近 `exp`，或人为造一次 401 |
| 媒体 / 群语义 / 权限门 | ⬜ 未验（本版根本没实现，见上一节） |

> **首跑一次成功，零改动**（2026-08-30 07:12 UTC）。这条最值得记：那 300 行是照
> `agent-protocol.md` 写的，中间**没有一次「跑起来才发现文档没说」**。

### 工具面（同日补，8 件）

`whoami` · `list_conversations` · `list_friends` · `read_moments` · `post_moment` ·
`comment_on_moment` · `delete_moment` · `send_to`

**没有一件是我们包装出来的能力** —— 每件只是这个 agent 拿**自己的** token 打一次
平台 REST（machine-channel-contract §1-bis：「会写代码的宿主不需要包装」）。上限就是
这个账号本身的权限。

| | |
|---|---|
| 实测通过 | `whoami` `list_conversations`（1 条）`list_friends`（1 个）`read_moments`（5 条）`send_to` |
| 未实跑（写操作 / 需要前置数据） | `post_moment` `comment_on_moment` `delete_moment` |

⚠️ **删掉过一件：`rename_self`。** 上线前拿自己的昵称空写一次探边界 →
`16005 not the owner`。**`GET /v1/agents/:id` 是 owner-or-self，`PATCH` 是
owner-only**，这个不对称文档里原本没有（已补进 `api.md`）。一个永远失败的工具比没有
更糟：它让 agent 当着主人的面承诺一件做不到的事。

### 首跑之后补的三件（同日）

1. **接脑子。** 光有收发不是对话 —— 主人当场指出「并没有真实对话啊」，对的：我验的是
   线路，不是 agent。现在 `CLAWCHAT_MODEL_*` 接任意 OpenAI 兼容端点，带每会话 12 轮
   上下文与 typing 指示器（§2.6：本端指示器 6s 不见新帧就熄，所以思考期间每 4s 续一帧）。
2. **`agent.behavior` —— 我原样重犯了 §7.1 点名的那个坑。** connect 响应里就带着它，
   而我丢在地上：**主人账号上配着 1563 个字符的「Agent 行为」，一个字都没进上下文**。
   现在连接时自读一次（`GET /v1/agents/:id`，owner-or-self 门，用 agent 自己的 token），
   并在 `chat.metadata.invalidated` 带 `behavior` scope 时重拉。
3. **device id 不再每次重启换一个。** §1.6 的派生式含 `hostname()`，而**容器的 hostname
   每次 run 都是新的** —— 于是每次重启在服务器眼里都是新设备，触发全量 inbox 重放
   （实测：重启后旧消息又收了一遍）。修法照 §2.3：`hello-ok` 回的 server-resolved id
   优先并落盘。**这条对任何跑在容器里的实现都成立**，文档那条派生式对普通安装是对的、
   对容器是坑。
