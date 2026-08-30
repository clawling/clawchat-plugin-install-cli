#!/usr/bin/env node
// ClawChat 云端 agent —— 照 docs/external-interfaces/agent-protocol.md 从零实现。
// 这是那份文档的第 N 个实现，写它的目的之一就是检验文档本身够不够。
//
// 模式：
//   node agent.mjs check   非消耗性预检（/v1/agents/connect/check），不烧码
//   node agent.mjs run     激活 + 常驻（默认）
//
// 凭据只从 env 读：CLAWCHAT_CONNECT_CODE。永不落盘、永不打印。
import { createHash, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';

const REST = process.env.CLAWCHAT_REST || 'https://app.clawling.com';
const WS_URL = process.env.CLAWCHAT_WS || 'wss://app.clawling.com/ws';
const STATE_PATH = process.env.CLAWCHAT_STATE || '/state/agent.json';
// §1.3 / gotcha 8：`platform` 是客户端自选的自由字符串，check 端点不校验它 ——
// 它是「新宿主不改后端白名单就能上线」的那根保险丝。所以默认报真话，被 /connect
// 拒了再退回 `openclaw`（代价只是管理页那枚 platform 芯片显示成 openclaw，
// 功能无损）。冒名顶替换来的「一定能过」不值那个谎。
const PLATFORM = process.env.CLAWCHAT_PLATFORM || 'cloud-agent-probe';
const PLATFORM_FALLBACK = 'openclaw';
const PLUGIN_VERSION = 'cloud-agent-probe/0.2.0';

// 脑子。给不出端点就退回复述模式 —— 🟡 降级要说出来，不静默变哑巴。
const MODEL_BASE = process.env.CLAWCHAT_MODEL_BASE || '';
const MODEL_NAME = process.env.CLAWCHAT_MODEL || '';
const MODEL_KEY = process.env.CLAWCHAT_MODEL_KEY || 'none';
const HAS_BRAIN = Boolean(MODEL_BASE && MODEL_NAME);

// §7.1：平台惯例是**通道的**职责，不是宿主的。一个没被告知处境的模型会
// 「发明自己的工具清单，并反问这个群是哪个聊天平台」—— 而它当时正在 ClawChat 里
// 跟主人说话。英文、极简（Precaution 11：进模型上下文的文本不随界面语言分叉）。
const SYSTEM_PROMPT = [
  'You are an agent account inside ClawChat, an instant messenger.',
  'You are talking with your owner, in a real-time chat, as a contact in their list.',
  'Reply in the language they write in. Keep it short — this is a chat, not a document.',
  'You run in a container. You cannot read files, browse the web, or run commands.',
  'You do have a few tools for acting on your own ClawChat account — use them when asked;',
  'they act for real, so do not call them to "check" something you were not asked about.',
  'You can change your own display name and bio with update_profile — that is your own account.',
  'If you are asked for something you cannot do, say so plainly instead of pretending.',
].join(' ');

// §1.6 两个 device id —— 混淆它们是这个协议里最贵的一次错误。
// REST 侧：字面常量，永远逐字节相同（后端比对，不同就 400 → 永久登出）。
const CHANNEL_ID = 'clawchat-cloud-agent-probe';

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── 状态：refresh token 是单次性的，必须先落盘再换内存（§1.5 gotcha 3）──────
function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// ── §2.6 message_id：`msg-` + 26 字符 Crockford base32 ULID，契约级 ──────────
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let ts = Date.now(), time = '';
  for (let i = 0; i < 10; i++) { time = CROCKFORD[ts % 32] + time; ts = Math.floor(ts / 32); }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[randomInt(32)];
  return time + rand;
}
const newMessageId = () => `msg-${ulid()}`;

// ── REST ────────────────────────────────────────────────────────────────────
async function rest(path, body, token = '') {
  const res = await fetch(`${REST}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-device-id': CHANNEL_ID,          // §1.6：所有 REST 调用都是这个常量
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  // §1.2 分支看信封 code，不看 HTTP status；非 2xx 也要解析体
  const json = await res.json().catch(() => ({}));
  return { http: res.status, code: json.code, msg: json.msg, data: json.data };
}

// §1.3 的安全预检 —— **不消耗连接码**
async function check(code) {
  const r = await rest('/v1/agents/connect/check', { code, platform: PLATFORM });
  log('check →', JSON.stringify({ http: r.http, code: r.code, data: r.data }));
  return r;
}

async function activate(code) {
  let r = await rest('/v1/agents/connect', { code, platform: PLATFORM, type: 'clawbot', plugin_version: PLUGIN_VERSION });
  if (r.code !== 0 && PLATFORM !== PLATFORM_FALLBACK) {
    // gotcha 8 那根保险丝：报了个后端不认的 platform → 退回 openclaw 再试一次。
    // ⚠️ 连接码是一次性的，而失败的 /connect **可能已经消耗掉它** —— 这一步是
    // 「反正已经失败了，不如再试一次」，不是可以随便重试的路径。
    log(`platform "${PLATFORM}" 被拒（code=${r.code}），退回 "${PLATFORM_FALLBACK}" 重试一次`);
    r = await rest('/v1/agents/connect', { code, platform: PLATFORM_FALLBACK, type: 'clawbot', plugin_version: PLUGIN_VERSION });
  }
  if (r.code !== 0) throw new Error(`activate failed code=${r.code} msg=${r.msg}`);
  const d = r.data;
  // §1.4：自己的 user_id 以 JWT 的 sub 为准 —— 覆盖任何配置值，
  // 不一致会静默弄坏自回声守卫（gotcha 5）。
  const claims = JSON.parse(Buffer.from(d.access_token.split('.')[1], 'base64url').toString());
  const state = {
    agentId: d.agent?.id,
    userId: claims.sub,
    ownerId: claims.oid,
    conversationId: d.conversation?.id,   // gotcha 4：主动发言只发这个 cnv_
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    exp: claims.exp, iat: claims.iat,
    // §7.1：`agent.behavior` 是**主人配置的那一层**，connect 响应直接交出来，
    // 参考插件一直在读 —— 把它丢在地上，主人在「Agent 行为」里写的每个字都不生效。
    behavior: d.agent?.behavior ?? '',
  };
  saveState(state);                        // 先落盘
  log('activated', JSON.stringify({ agentId: state.agentId, userId: state.userId, conversationId: state.conversationId }));
  return state;
}

// §7.1：behavior 的**自读**。`GET /v1/agents/:id` 是 owner-or-self 门，而 agent
// 就是那个 self —— 不需要、也绝不该用主人的凭据（混用两个身份正是 §1.6 那类事故）。
// 连接时拉一次是真兜底：那个失效信号**短暂且从不重放**，离线期间的编辑只能这样拿到。
async function pullBehavior(state) {
  try {
    const res = await fetch(`${REST}/v1/agents/${state.agentId}`, {
      headers: { authorization: `Bearer ${state.accessToken}`, 'x-device-id': CHANNEL_ID },
    });
    const j = await res.json();
    if (j.code !== 0) return;
    const b = j.data?.agent?.behavior ?? '';
    if (b !== state.behavior) { state.behavior = b; saveState(state); log('behavior updated', `${b.length} chars`); }
  } catch (e) { log('behavior pull failed (non-fatal):', e.message); }
}

// §1.5 刷新：**不带 Authorization**，body 里的 refresh token 就是凭据
async function refresh(state) {
  const res = await fetch(`${REST}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': CHANNEL_ID },
    body: JSON.stringify({ refresh_token: state.refreshToken }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.code !== 0) return { ok: false, permanent: j.code === 10003 || j.code === 400, code: j.code };
  const claims = JSON.parse(Buffer.from(j.data.access_token.split('.')[1], 'base64url').toString());
  Object.assign(state, {
    accessToken: j.data.access_token, refreshToken: j.data.refresh_token,
    exp: claims.exp, iat: claims.iat,
  });
  saveState(state);                        // 顺序强制：落盘 → 换内存 → 重连 WS
  log('token refreshed');
  return { ok: true };
}

// ── §2.5 入站过滤链，顺序即契约 ─────────────────────────────────────────────
function fragmentsToText(frags = []) {
  return frags.map((f) => {
    switch (f.kind) {
      case 'text': return f.text ?? '';
      case 'mention': return `@${f.display || f.user_id || ''}`;
      case 'image': return `![${f.name ?? ''}](${f.url})`;
      case 'file': case 'audio': case 'video': return `[${f.name ?? ''}](${f.url})`;
      default: return '';
    }
  }).join('').trim();
}

// §2.8：审批结果。**必须在业务链之前认出来** —— 它没有正文。
function isPermissionResult(frame) {
  return (frame.event === 'message.send' || frame.event === 'message.reply')
    && frame.sender?.id === 'system'
    && frame.payload?.metadata?.kind === 'permission_result';
}

function shouldHandle(frame, ownUserId) {
  // 1. 只有 message.send / message.reply 是业务事件
  if (frame.event !== 'message.send' && frame.event !== 'message.reply') return null;
  // 2. 自己的 userId 为空 → **fail closed**，否则会对着生产账号自回复成环
  if (!ownUserId) return null;
  // 3. 畸形 / 缺 chat_id / 缺 sender
  const p = frame.payload;
  if (!p || !frame.chat_id || !frame.sender?.id) return null;
  // 4. system 一律丢。**`permission_result` 不在这里放行 —— 它在整条链之前就被
  //    分流走了**（见 onmessage 里的 isPermissionResult）。文档 §2.8 的原话是
  //    「Do not let this frame fall through the normal inbound chain」：它没有可渲染
  //    正文，放行到第 7 步照样会被丢掉,而被告知「等审批」的 agent 会永远等下去。
  //    我第一版就是这么写的 —— 放行了、然后自己在第 7 步杀掉了。
  if (frame.sender.id === 'system') return null;
  // 5. 自回声
  if (frame.sender.id === ownUserId) return null;
  // 6. message_mode：**"" 就是 normal**（服务器下行不给默认值，gotcha 7）
  const mode = p.message_mode ?? '';
  if (mode !== '' && mode !== 'normal') return null;
  // 7. 没有可渲染文本也没有带 url 的媒体
  const frags = p.message?.body?.fragments ?? [];
  const text = fragmentsToText(frags);
  const hasMedia = frags.some((f) => f.url);
  if (!text && !hasMedia) return null;
  // 8/9. mentions 合并 + wasMentioned
  const ids = [
    ...frags.filter((f) => f.kind === 'mention').map((f) => f.user_id ?? f.userId ?? f.id),
    ...(p.message?.context?.mentions ?? []).map((m) => m.user_id ?? m.userId ?? m.id),
  ].filter(Boolean);
  const wasMentioned = frame.chat_type === 'direct' || ids.includes(ownUserId) || ids.includes('all');
  return { text, chatId: frame.chat_id, sender: frame.sender, wasMentioned };
}

// ── WS ──────────────────────────────────────────────────────────────────────
// §1.6 的派生式。⚠️ **它含 hostname，而容器的 hostname 每次 run 都是新的** ——
// 直接照抄会让每次重启在服务器眼里都是一台新设备，于是每次重连都触发一次全量
// inbox 重放（2026-08-30 实测撞到：重连后旧消息又收了一遍）。所以：
//   ① 第一次算出来就**落盘**，之后一直用同一个；
//   ② `hello-ok` 回的 server-resolved id **优先**（§2.3 明写「persist it and pass
//      it back next connect to avoid a full inbox replay」）。
// 这条对任何跑在容器 / 会换主机名的宿主里的实现都成立，不只这个探针。
function deriveWsDeviceId(accountId, userId) {
  const h = createHash('sha256')
    .update(`${CHANNEL_ID}\0${accountId}\0${userId}\0${hostname()}`).digest('hex');
  return `${CHANNEL_ID}-${h.slice(0, 24)}`;
}
function stableWsDeviceId(state) {
  const id = state.serverDeviceId || state.wsDeviceId
    || deriveWsDeviceId(state.ownerId, state.userId);
  if (state.wsDeviceId !== id) { state.wsDeviceId = id; saveState(state); }
  return id;
}

const traceId = () => `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// 每个会话留一小段上下文 —— 没有它就不是对话，是一问一答。
// think() 是模块级的，而 behavior 会随信号变 —— 用一个可变引用而不是快照。
let BEHAVIOR = '';
const HISTORY_TURNS = 12;
const history = new Map();
function remember(chatId, role, content) {
  const h = history.get(chatId) ?? [];
  h.push({ role, content });
  while (h.length > HISTORY_TURNS * 2) h.shift();
  history.set(chatId, h);
}

// 工具面。**没有一件是我们包装出来的能力** —— 每件都只是这个 agent 拿**自己的**
// token 打一次平台 REST，正是 machine-channel-contract §1-bis 那条判据说的
// 「会写代码的宿主不需要包装」。所以这里的上限就是这个账号本身的权限，不多不少。
const TOOLS = [
  { type: 'function', function: { name: 'whoami',
      description: "Read your own ClawChat profile (nickname, bio, behavior).",
      parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'list_conversations',
      description: 'List the conversations you are a member of (direct and group).',
      parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'update_profile',
      description: "Change your own display name and/or bio, as your owner's contact list shows them.",
      parameters: { type: 'object', properties: {
        nickname: { type: 'string' }, bio: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'list_friends',
      description: 'List your friends on ClawChat (their usr_ ids and nicknames).',
      parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'read_moments',
      description: "Read the moments feed you can see (your own plus your owner's circle).",
      parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'post_moment',
      description: 'Publish a moment. It appears publicly with your Agent badge.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'comment_on_moment',
      description: 'Comment on a moment.',
      parameters: { type: 'object', properties: {
        moment_id: { type: 'string' }, text: { type: 'string' } }, required: ['moment_id', 'text'] } } },
  { type: 'function', function: { name: 'delete_moment',
      description: 'Delete one of your own moments. This needs your owner to approve it first.',
      parameters: { type: 'object', properties: { moment_id: { type: 'string' } }, required: ['moment_id'] } } },
  { type: 'function', function: { name: 'send_to',
      description: 'Send a message into one of your conversations, by its cnv_ id.',
      parameters: { type: 'object', properties: {
        conversation_id: { type: 'string' }, text: { type: 'string' } }, required: ['conversation_id', 'text'] } } },
];

let TOOL_CTX = null;   // { state, api } —— 由 start() 装配

async function agentRest(method, path, body) {
  const res = await fetch(`${REST}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOOL_CTX.state.accessToken}`,
      'x-device-id': CHANNEL_ID,
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await res.json().catch(() => ({}));
  // §2.8 权限门：REST **不做事**，回一个门码。21001 = 已经给主人投了审批卡。
  // ⚠️ **批准之后由服务器自己执行,agent 绝不能重发** —— 重发回 `13001 not found`。
  if (j.code === 21001) {
    const rid = j.data?.request_id;
    PENDING.set(rid, { operation: j.data?.operation, at: Date.now() });
    return { pending_owner_approval: true, request_id: rid, operation: j.data?.operation,
             note: 'Your owner has been asked to approve this. Tell them, then stop — do NOT retry; the server runs it itself once they approve, and you will be told the outcome.' };
  }
  if (j.code === 21003) return { forbidden_by_owner: true, operation: j.data?.operation };
  return j;
}

// request_id → 这次门后操作。去重与「等到了没有」都靠它。
const PENDING = new Map();

async function runTool(name, args) {
  const st = TOOL_CTX.state;
  switch (name) {
    case 'whoami': {
      const j = await agentRest('GET', `/v1/agents/${st.agentId}`);
      const a = j.data?.agent ?? {};
      return { nickname: a.nickname, bio: a.bio, behavior_chars: (a.behavior ?? '').length,
               agent_id: st.agentId, owner_conversation: st.conversationId };
    }
    case 'list_conversations': {
      const n = Math.min(Math.max(Number(args.limit) || 20, 1), 30);
      const j = await agentRest('GET', `/v1/conversations?limit=${n}`);
      return (j.data?.conversations ?? []).map((c) => ({
        id: c.id, type: c.type, title: c.title || c.peer?.nickname || '' }));
    }
    case 'update_profile': {
      // ⚠️ **走影子用户,不走 `/v1/agents/:id`**(2026-08-30 实测):
      //   `PATCH /v1/agents/:id`  → `16005 not the owner`(owner-only)
      //   `PATCH /v1/users/me`    → `code 0`,而且**传导到 agent 档案**
      //     (改完 `/agents/:id` 的 nickname 一并变)。
      // 我先测了前者就下结论说「agent 改不了自己的名字」—— 错在拿一个端点的
      // 结果代表整个能力面。
      const body = {};
      if (typeof args.nickname === 'string' && args.nickname.trim()) body.nickname = args.nickname.trim();
      if (typeof args.bio === 'string') body.bio = args.bio;
      if (!Object.keys(body).length) return { ok: false, error: 'give a nickname or a bio' };
      const j = await agentRest('PATCH', '/v1/users/me', body);
      return j.code === 0 ? { ok: true, ...body } : { ok: false, code: j.code, msg: j.msg };
    }
    case 'list_friends': {
      const j = await agentRest('GET', '/v1/friendships');
      return (j.data?.friends ?? []).map((f) => ({ id: f.id, nickname: f.nickname, type: f.type }));
    }
    case 'read_moments': {
      const n = Math.min(Math.max(Number(args.limit) || 10, 1), 30);
      const j = await agentRest('GET', `/v1/moments?limit=${n}`);
      return (j.data?.moments ?? []).map((m) => ({
        id: m.id, author: m.user?.nickname ?? m.user_id, text: (m.text ?? '').slice(0, 300),
        comments: m.comments_total ?? 0 }));
    }
    case 'post_moment': {
      // §4 末段实测：`POST /v1/moments` 对 agent 的影子用户**不设门**，带 Agent 徽章渲染。
      const j = await agentRest('POST', '/v1/moments', { text: String(args.text ?? ''), images: [] });
      return j.code === 0 ? { ok: true, id: j.data?.moment?.id } : { ok: false, code: j.code, msg: j.msg };
    }
    case 'comment_on_moment': {
      const j = await agentRest('POST', `/v1/moments/${args.moment_id}/comments`, { text: String(args.text ?? '') });
      return j.code === 0 ? { ok: true } : { ok: false, code: j.code, msg: j.msg };
    }
    case 'delete_moment': {
      // ⚠️ 这一件是**门后的**（§4 末段：DELETE 受 owner-permission 门管）。
      // `agentRest` 会把 21001 翻成 pending，模型据此告诉主人「等你点」。
      return await agentRest('DELETE', `/v1/moments/${args.moment_id}`);
    }
    case 'send_to': {
      const id = String(args.conversation_id ?? '');
      // gotcha 4 的同一道闸,在工具层也守一遍:发给 usr_ 会被静默丢弃。
      if (!id.startsWith('cnv_')) return { ok: false, error: 'conversation_id must be a cnv_ id' };
      const r = await TOOL_CTX.api.sendText(id, String(args.text ?? ''));
      return { ok: r.event === 'message.ack', result: r.event };
    }
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}

async function think(chatId, text) {
  remember(chatId, 'user', text);
  // 工具循环有上限 —— 一个想不明白的模型会一直调下去,而每一轮都在花主人的钱。
  for (let round = 0; round < 5; round++) {
    const res = await fetch(`${MODEL_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${MODEL_KEY}` },
      body: JSON.stringify({
        model: MODEL_NAME,
        // 身份分层（§7.1 那张表）：**平台惯例是我们的、社区行为是主人的**，
        // 主人的那份接在我们后面 —— 同一根轴上，主人的话压轴。
        messages: [
          { role: 'system', content: BEHAVIOR ? `${SYSTEM_PROMPT}\n\n${BEHAVIOR}` : SYSTEM_PROMPT },
          ...(history.get(chatId) ?? []),
        ],
        tools: TOOLS,
        stream: false,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`model HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new Error('model returned no message');

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      const out = (msg.content ?? '').trim();
      if (!out) throw new Error('model returned empty');
      remember(chatId, 'assistant', out);
      return out;
    }

    // ⚠️ DeepSeek 要求带 tool_calls 的 assistant 消息**必须有 content**,而且带
    // reasoning 的模型要把 reasoning_content 一起回传(pi 的 compat 表里
    // `requiresAssistantContentForToolCalls` / `requiresReasoningContentForToolCalls`
    // 就是这两条)。少一个就是 400,而错在我们、不在模型。
    const h = history.get(chatId) ?? [];
    h.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls,
             ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}) });
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch {}
      log(`  tool ${c.function?.name}(${JSON.stringify(args).slice(0, 120)})`);
      let result;
      try { result = await runTool(c.function?.name, args); }
      catch (e) { result = { ok: false, error: e.message }; }
      h.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
    history.set(chatId, h);
  }
  throw new Error('工具循环超过 5 轮还没给出答复');
}

function connect(state, onReady) {
  const ws = new WebSocket(WS_URL);
  const pending = new Map();          // trace_id → {resolve, timer}
  let hb = null, pongTimer = null;

  const send = (frame) => ws.send(JSON.stringify({ version: '2', emitted_at: Date.now(), payload: {}, ...frame }));

  ws.onopen = () => log('ws open');

  ws.onmessage = (ev) => {
    let f; try { f = JSON.parse(String(ev.data)); } catch { return; }
    if (f.version !== '2' || typeof f.event !== 'string') return;

    switch (f.event) {
      case 'connect.challenge':
        send({ event: 'connect', trace_id: traceId(), payload: {
          token: state.accessToken,
          nonce: f.payload?.nonce,
          device_id: state.wsDeviceId,
          capabilities: { multi_device: false, device_replay: true, chat_meta_events: true, notify_signals: true, permission_events: true },
        }});
        return;

      case 'hello-ok':
        log('hello-ok', JSON.stringify(f.payload ?? {}));
        // 服务器认账的那个 id 优先，下次连接原样带回去 —— 否则全量重放。
        if (f.payload?.device_id && state.serverDeviceId !== f.payload.device_id) {
          state.serverDeviceId = f.payload.device_id;
          state.wsDeviceId = f.payload.device_id;
          saveState(state);
        }
        hb = setInterval(() => {
          send({ event: 'ping', trace_id: traceId() });
          clearTimeout(pongTimer);
          pongTimer = setTimeout(() => { log('heartbeat timeout'); try { ws.close(4000, 'heartbeat timeout'); } catch {} }, 10_000);
        }, 20_000);
        onReady?.(api);
        return;

      case 'hello-fail': {
        // §2.3 分类是**对一个字符串的精确匹配**，不是黑名单
        const reason = f.payload?.reason ?? '';
        log('hello-fail:', reason);
        if (reason === 'authentication failed') api.onAuthFailed?.();
        return;
      }

      case 'ping':
        // gotcha 9：emitted_at 必须原样回显，不许重新盖戳
        ws.send(JSON.stringify({ version: '2', event: 'pong', trace_id: f.trace_id, emitted_at: f.emitted_at, payload: {} }));
        return;

      case 'pong':
        clearTimeout(pongTimer);
        return;

      case 'message.ack': case 'message.error': {
        const p = pending.get(f.trace_id);
        if (p) { clearTimeout(p.timer); pending.delete(f.trace_id); p.resolve(f); }
        return;
      }
    }

    // §2.7 / §7.1：主人在任一设备上改了「Agent 行为」，信号经 agent 自己的私聊扇出。
    // **信号短暂且从不重放**，所以连接时那次自读是真兜底，不是保险带。
    if (f.event === 'chat.metadata.invalidated') {
      const scope = f.payload?.scope;
      if (!scope || (Array.isArray(scope) && scope.includes('behavior'))) {
        pullBehavior(state).then(() => { BEHAVIOR = state.behavior ?? ''; });
      }
      return;
    }

    // §2.8 审批结果 —— 在业务链**之前**分流（它没有正文，进链必被丢掉）。
    if (isPermissionResult(f)) { api.onPermissionResult?.(f, api); return; }

    // 业务事件
    const hit = shouldHandle(f, state.userId);
    if (hit) api.onMessage?.(hit, api);
  };

  ws.onclose = (e) => { clearInterval(hb); clearTimeout(pongTimer); log('ws closed', e.code); api.onClosed?.(e.code); };
  ws.onerror = () => log('ws error');

  const api = {
    // §2.6：本端指示器 6s 不见新帧就熄，所以整个思考期间每 ~4s 重发一次，
    // 结束时补一帧 false。fire-and-forget，不与 ack 对齐。
    typing(chatId, on) {
      send({ event: 'typing.update', trace_id: traceId(), chat_id: chatId, payload: { is_typing: on } });
    },
    sendText(chatId, text) {
      const tid = traceId();
      // gotcha 4：绝不把出站帧发给 usr_… —— chat_id 必须是 cnv_…
      if (!chatId.startsWith('cnv_')) throw new Error(`refusing to send to ${chatId} — chat_id must be a cnv_ id`);
      const p = new Promise((resolve) => {
        const timer = setTimeout(() => { pending.delete(tid); resolve({ event: 'ack.timeout' }); }, 15_000);
        pending.set(tid, { resolve, timer });
      });
      send({ event: 'message.send', trace_id: tid, chat_id: chatId, payload: {
        message_id: newMessageId(), message_mode: 'normal',
        message: { body: { fragments: [{ kind: 'text', text }] }, context: { mentions: [], reply: null } },
      }});
      return p;
    },
    close: () => { try { ws.close(1000, 'client close'); } catch {} },
  };
  return api;
}

// ── main ────────────────────────────────────────────────────────────────────
const mode = process.argv[2] ?? 'run';
const code = process.env.CLAWCHAT_CONNECT_CODE;

if (mode === 'check') {
  if (!code) { console.error('CLAWCHAT_CONNECT_CODE 未设置'); process.exit(2); }
  await check(code);
  process.exit(0);
}

let state = loadState();
if (!state.accessToken) {
  if (!code) { console.error('没有已保存的身份，且 CLAWCHAT_CONNECT_CODE 未设置'); process.exit(2); }
  state = await activate(code);
} else {
  log('resuming saved identity', JSON.stringify({ agentId: state.agentId, conversationId: state.conversationId }));
}
state.wsDeviceId = stableWsDeviceId(state);
await pullBehavior(state);
BEHAVIOR = state.behavior ?? '';
log('behavior', BEHAVIOR ? `${BEHAVIOR.length} chars 已挂上` : '（主人还没写）');

let attempt = 0;
let greeted = Boolean(loadState().greeted);
function start() {
  const api = connect(state, (a) => {
    attempt = 0;
    log(`READY —— 在线，等主人说话${HAS_BRAIN ? `（脑子：${MODEL_NAME}）` : '（无脑子，探针模式）'}`);
    // **只在首次激活时问好。** 每次重连都发一句「我上线了」是刷屏,而重连是常态。
    if (!greeted) {
      greeted = true; state.greeted = true; saveState(state);
      a.sendText(state.conversationId, HAS_BRAIN
        ? '我在。跑在一个容器里，接的是本机网络里的一个模型——说点什么吧。'
        : '云端 agent 上线了（容器里跑的协议探针，还没接模型）。')
        .then((r) => log('greeting ack:', r.event));
    }
  });
  TOOL_CTX = { state, api };
  api.onMessage = async (hit, a) => {
    log(`收到 [${hit.chatId}] ${hit.sender.nick_name ?? hit.sender.id}: ${hit.text}`);
    if (!hit.wasMentioned) return;
    const t0 = Date.now();

    if (!HAS_BRAIN) {
      // 🟡 降级要说出来：没配模型就明说自己是探针，不假装在聊天。
      const r = await a.sendText(hit.chatId,
        `收到：「${hit.text}」\n\n（没有配模型端点，我现在只是协议探针。给容器设 CLAWCHAT_MODEL_BASE / CLAWCHAT_MODEL 我才有脑子。）`);
      log(`复述 ${r.event}，往返 ${Date.now() - t0}ms`);
      return;
    }

    // 本地模型一轮几十秒，没有指示器的话主人只能对着空白等。
    a.typing(hit.chatId, true);
    const keepTyping = setInterval(() => a.typing(hit.chatId, true), 4000);
    try {
      const answer = await think(hit.chatId, hit.text);
      clearInterval(keepTyping);
      a.typing(hit.chatId, false);
      const r = await a.sendText(hit.chatId, answer);
      log(`回复 ${r.event}，${answer.length} 字，耗时 ${Date.now() - t0}ms`);
    } catch (e) {
      clearInterval(keepTyping);
      a.typing(hit.chatId, false);
      // 宿主原话原样回 —— 不包装、不粉饰（`SEND_FAILED: <e>` 那条纪律的同族）。
      log('model failed:', e.message);
      await a.sendText(hit.chatId, `我这一轮没答上来：${e.message}`);
    }
  };
  // 门后的操作有了结论。**按 request_id 去重**，并且**绝不重发那次调用** ——
  // 批准之后是服务器自己执行的，重发只会拿到 `13001 not found`。
  const seenVerdicts = new Set();
  api.onPermissionResult = async (f, a) => {
    const m = f.payload?.metadata ?? {};
    const rid = m.request_id;
    if (!rid || seenVerdicts.has(rid)) return;
    seenVerdicts.add(rid);
    const asked = PENDING.get(rid);
    PENDING.delete(rid);
    log(`审批结果 ${m.operation ?? asked?.operation ?? '?'} → ${m.outcome}${m.reason ? ` (${m.reason})` : ''}`);
    const word = { approved: '你批准了', denied: '你拒绝了', expired: '那张卡过期了',
                   failed: '服务器执行失败了', auto_allowed: '按你的设置自动放行了',
                   auto_denied: '按你的设置自动拒绝了' }[m.outcome] ?? m.outcome;
    // ⚠️ 合成的这一轮**必须发给主人的 cnv_** —— usr_ 会被静默丢弃（gotcha 4）。
    await a.sendText(state.conversationId,
      `关于「${m.operation ?? asked?.operation ?? '刚才那件事'}」：${word}。${m.reason ? `（${m.reason}）` : ''}`);
  };

  api.onAuthFailed = async () => {
    const r = await refresh(state);
    if (r.ok) start(); else log('refresh 永久失败，停止重连', r.code);
  };
  api.onClosed = () => {
    attempt++;
    const delay = Math.min(15000, 500 * 2 ** (attempt - 1));
    setTimeout(start, delay + Math.random() * delay * 0.3);
  };
}
start();
