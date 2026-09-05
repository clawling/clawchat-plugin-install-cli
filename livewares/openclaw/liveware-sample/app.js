/* Liveware Sample shell — the owner's guide to their first Liveware.
 *
 * A stage machine driven by state.json (agent-owned, pushed via SSE):
 *   intro        → one screen: what a Liveware is + three directions
 *   tool         → the chosen tool fills the screen (iframe /tool/) + a "make it more me" entry
 *   personalized → tool + a finish card (the tour is over; one「好的」→ kept)
 *   kept         → tool only; the guide is gone for good
 *
 * Every page → chat hop is a real <a href="clawchat://u/<agentId>?chat=1&draft=…">
 * click: the draft lands in the composer and is NEVER auto-sent, and the mobile
 * container only dispatches non-web schemes on a genuine user gesture.
 *
 * The FIXED SENTENCES below are a protocol: the SKILL.md description quotes
 * them verbatim and the agent routes on them. Change one → change all three
 * places (this table, both SKILL.md descriptions, the spec).
 */
(function () {
  var ID_RE = /^[A-Za-z0-9_-]+$/;
  var TOOLS = ["shopping-list", "countdown", "habits"];
  var STAGES = ["intro", "tool", "personalized", "kept"];

  var I18N = {
    zh: {
      introTitle: "做出你的第一个 Liveware",
      introLead1: "Liveware 是你的 Agent 为你造的小工具，一次造好、反复打开。",
      introLead2: "跟 Agent 说一句，它写好、上线；再说一句，它改。",
      pickTitle: "挑一个，这一页就会变成它",
      tools: {
        "shopping-list": { name: "购物清单", blurb: "在聊天里说一句「加牛奶」，清单就多一行" },
        "countdown": { name: "纪念日倒计时", blurb: "离那一天还有几天，一眼看见" },
        "habits": { name: "习惯打卡", blurb: "每天回来点一下，Agent 会记得你的坚持" },
      },
      // ---- fixed sentences (protocol) ----
      choose: {
        "shopping-list": "把 Liveware Sample 换成购物清单",
        "countdown": "把 Liveware Sample 换成纪念日倒计时",
        "habits": "把 Liveware Sample 换成习惯打卡",
      },
      restyleWith: function (tool, text) { return "把我的" + tool + "改成：" + text; },
      restyleEmpty: function (tool) { return "把我的" + tool + "改成更像我的风格（比如深色、更大字、手账风）"; },
      // ---- chrome ----
      pill: "个性化",
      restyleTitle: "个性化",
      restyleHint: "写一句你想要的样子，留空也行",
      restylePlaceholder: "比如：深色、更大字、手账风",
      restyleGo: "去跟 Agent 说",
      cancel: "取消",
      close: "关闭",
      finishTitle: "体验完成，这个 Liveware 留给你了",
      finishHint: "想改样子、改内容，随时在聊天里说一句；不想要了，也随时让 Agent 帮你删掉。",
      keep: "好的",
      fallbackHint: "点左上角 ‹ 回到聊天，对 Agent 说：",
      copy: "复制",
      copied: "已复制",
      restyleAgainDefault: "把个性化按钮从界面里去掉",
      toolLoadFailed: "工具没加载出来（{status}）",
      retry: "重试",
    },
    en: {
      introTitle: "Make your first Liveware",
      introLead1: "A Liveware is a small tool your Agent builds for you — built once, opened again and again.",
      introLead2: "Say one thing to your Agent and it writes it and ships it; say another and it changes it.",
      pickTitle: "Pick one, and this page becomes it",
      tools: {
        "shopping-list": { name: "Shopping list", blurb: "Say “add milk” in chat and the list grows a line" },
        "countdown": { name: "Countdown", blurb: "Days until that day, at a glance" },
        "habits": { name: "Habit tracker", blurb: "Come back and tap each day; your Agent remembers your streak" },
      },
      // ---- fixed sentences (protocol) ----
      choose: {
        "shopping-list": "Turn Liveware Sample into a shopping list",
        "countdown": "Turn Liveware Sample into a countdown",
        "habits": "Turn Liveware Sample into a habit tracker",
      },
      sentenceName: { "shopping-list": "shopping list", "countdown": "countdown", "habits": "habit tracker" },
      restyleWith: function (tool, text) { return "Restyle my " + tool + ": " + text; },
      restyleEmpty: function (tool) { return "Restyle my " + tool + " to feel more like me (e.g. dark, bigger text, journal style)"; },
      // ---- chrome ----
      pill: "Personalize",
      restyleTitle: "Personalize",
      restyleHint: "Describe the look you want — or leave it blank",
      restylePlaceholder: "e.g. dark, bigger text, journal style",
      restyleGo: "Tell my Agent",
      cancel: "Cancel",
      close: "Close",
      finishTitle: "That's the tour — this Liveware is yours to keep",
      finishHint: "Want it changed? Say so in chat. Don't want it any more? Ask your Agent to delete it, any time.",
      keep: "Got it",
      fallbackHint: "Tap ‹ at the top left to go back to chat and tell your Agent:",
      copy: "Copy",
      copied: "Copied",
      restyleAgainDefault: "Remove the Personalize button from the page",
      toolLoadFailed: "The tool did not load ({status})",
      retry: "Retry",
    },
  };

  // Locale contract (ClawChat docs/liveware/container.md §语言): the container
  // appends `?lang=<BCP-47>` with the app's own language setting at open time,
  // because a webview only ever sees the OS locale. `?lang` wins; the OS
  // locale is the fallback for a plain browser.
  var langTag = (function () {
    var m = /[?&]lang=([^&#]+)/.exec(location.search || "");
    return (m ? decodeURIComponent(m[1]) : "") || navigator.language || "";
  })();
  var lang = /^zh/i.test(langTag) ? "zh" : "en";
  var T = I18N[lang];
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

  // The tool's name as it appears inside a fixed sentence (zh: display name;
  // en: lowercase noun phrase).
  function sentenceToolName(tool) {
    return lang === "zh" ? T.tools[tool].name : T.sentenceName[tool];
  }

  function $(id) { return document.getElementById(id); }
  function applyI18n() {
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-i18n");
      if (typeof T[key] === "string") nodes[i].textContent = T[key];
    }
    $("restyle-input").placeholder = T.restylePlaceholder;
  }

  // ---------- deep link ----------
  var agentId = null;
  function setAgentId(v) {
    agentId = typeof v === "string" && ID_RE.test(v) ? v : null;
  }
  function deepLink(sentence) {
    if (!agentId) return null;
    return "clawchat://u/" + agentId + "?chat=1&draft=" + encodeURIComponent(sentence);
  }
  // Wire an <a> to a sentence: with an agent id it is a real deep link (the
  // anchor's own navigation IS the hop — no preventDefault); without one,
  // clicking shows the sentence so the owner can type it in chat. Hrefs are
  // kept current (refreshHrefs) so the anchor already points at the deep link
  // before the click — the handler only records the event.
  var bound = [];
  function bindSentence(a, getSentence, onClick) {
    bound.push({ a: a, getSentence: getSentence });
    a.onclick = function (ev) {
      var sentence = getSentence();
      if (onClick) onClick(sentence);
      var href = deepLink(sentence);
      if (href) { a.setAttribute("href", href); return; }
      ev.preventDefault();
      showFallback(sentence);
    };
  }
  function refreshHrefs() {
    for (var i = 0; i < bound.length; i++) {
      var href = null;
      try { href = deepLink(bound[i].getSentence()); } catch (e) {}
      bound[i].a.setAttribute("href", href || "#");
    }
  }

  // ---------- events (a trace the agent can check; never required) ----------
  function sendEvent(type, payload) {
    fetch("/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: type, payload: payload }),
      // keepalive: a deep-link click navigates away immediately —
      // without it the POST would be aborted mid-flight.
      keepalive: true,
    }).catch(function () {});
  }

  // ---------- sheets ----------
  function openSheet(id) { $(id).hidden = false; }
  function closeSheets() { $("restyle").hidden = true; $("fallback").hidden = true; }
  function showFallback(sentence) {
    $("fallback-text").textContent = sentence;
    openSheet("fallback");
  }
  function copyFrom(el, btn) {
    var text = el.textContent || "";
    function done() {
      var label = btn.textContent;
      btn.textContent = T.copied;
      setTimeout(function () { btn.textContent = label; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { selectText(el); });
    } else {
      selectText(el);
    }
  }
  function selectText(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  // ---------- intro cards ----------
  var ICONS = {
    "shopping-list":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 4h2l2.4 12.2a1 1 0 0 0 1 .8H18a1 1 0 0 0 1-.8L21 8H6.5"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
    "countdown":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="12" cy="15.5" r="1.8" fill="currentColor" stroke="none"/></svg>',
    "habits":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/></svg>',
  };
  var CHEVRON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

  function buildCards() {
    var host = $("cards");
    host.innerHTML = "";
    TOOLS.forEach(function (tool) {
      var a = document.createElement("a");
      a.className = "card";
      a.href = "#";
      a.innerHTML =
        '<span class="ico">' + ICONS[tool] + "</span>" +
        '<span class="txt"><span class="name"></span><span class="blurb" style="display:block"></span></span>' +
        '<span class="chev">' + CHEVRON + "</span>";
      a.querySelector(".name").textContent = T.tools[tool].name;
      a.querySelector(".blurb").textContent = T.tools[tool].blurb;
      bindSentence(a, function () { return T.choose[tool]; }, function () {
        sendEvent("choice", { tool: tool });
      });
      host.appendChild(a);
    });
  }

  // ---------- stage machine ----------
  var current = { stage: null, tool: null };
  function normalize(state) {
    var stage = STAGES.indexOf(state.stage) >= 0 ? state.stage : "intro";
    var tool = TOOLS.indexOf(state.tool) >= 0 ? state.tool : null;
    if (stage !== "intro" && !tool) stage = "intro"; // a tool-less tool stage is not renderable
    return { stage: stage, tool: tool };
  }

  function render(state) {
    if (state.title) document.title = state.title;
    if (state.theme) document.documentElement.style.setProperty("--theme", state.theme);
    applyIcon(state.iconVersion);
    setAgentId(state.agentId);

    var next = normalize(state);
    var changed = next.stage !== current.stage || next.tool !== current.tool;
    current = next;
    refreshHrefs();
    if (!changed) return;
    closeSheets();
    $("restyle-input").value = ""; // a new stage starts with a clean wish (the second round prefills its own)

    var intro = next.stage === "intro";
    $("intro").hidden = !intro;
    $("stage-tool").hidden = intro;
    $("finish-card").hidden = next.stage !== "personalized";
    $("pill").hidden = !(next.stage === "tool" || next.stage === "personalized");

    if (intro) $("tool-frame").removeAttribute("srcdoc");
    else loadTool();
  }

  // The tool is NOT loaded as an iframe navigation. The liveware tunnel's edge
  // gates document requests on what the ClawChat client put on the opening
  // URL, and an iframe navigating to a bare `/tool/` came back as its 400
  // "这个链接打不开" page (2026-09-05, first rollout) — while fetch() from the
  // page, which is how /state and /sse already work, goes through. So the
  // shell fetches the tool's HTML the same way and hands it to the iframe as
  // srcdoc: same origin as the shell, so the tool's own fetch('/data') and
  // EventSource('/sse') resolve against this page and carry its cookies. A
  // fresh fetch every time also sidesteps any cache in between (the agent's
  // personalized copy replaces the template at the same URL).
  // The HTML travels as JSON (`/tool.json`, the same shape as `/state`) — see
  // server.mjs. A failure is shown, with its status, never swallowed.
  var toolLoadSeq = 0;
  function loadTool() {
    var seq = ++toolLoadSeq;
    $("tool-error").hidden = true;
    fetch("/tool.json", { cache: "no-store" })
      .then(function (r) {
        if (r.status === 503) throw new Error("retry"); // agent mid-write
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (body) {
        if (seq !== toolLoadSeq) return; // a newer load superseded this one
        if (!body || typeof body.html !== "string") throw new Error("bad body");
        // Hand the resolved language to the template (an srcdoc frame has no
        // query string of its own).
        var html = body.html;
        var prelude = "<script>window.__lang=" + JSON.stringify(langTag) + ";</script>";
        $("tool-frame").srcdoc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (m) { return m + prelude; }) : prelude + html;
      })
      .catch(function (err) {
        if (seq !== toolLoadSeq) return;
        if (err && err.message === "retry") { setTimeout(function () { if (seq === toolLoadSeq) loadTool(); }, 1000); return; }
        $("tool-error-text").textContent = T.toolLoadFailed.replace("{status}", err && err.message ? err.message : "?");
        $("tool-error").hidden = false;
      });
  }

  // ---------- favicon (kept in sync for desktop-browser previews) ----------
  var iconVersion = null;
  function applyIcon(v) {
    if (v === iconVersion) return;
    iconVersion = v;
    var link = document.querySelector('link[rel="icon"]');
    if (typeof v === "string" && v) {
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/svg+xml";
        document.head.appendChild(link);
      }
      link.href = "/icon.svg?v=" + encodeURIComponent(v);
    } else if (link) {
      link.remove();
    }
  }

  // ---------- wiring ----------
  // The markup ships with the intro visible (a no-JS fallback); from here on
  // the stage machine owns visibility, so hide it until /state says otherwise.
  $("intro").hidden = true;
  applyI18n();
  buildCards();

  $("pill").addEventListener("click", function () {
    // Second round (already personalized): suggest the natural last wish —
    // taking the ✦ entry away. The agent answers it with stage:"kept".
    var input = $("restyle-input");
    if (current.stage === "personalized" && !input.value) { input.value = T.restyleAgainDefault; refreshHrefs(); }
    openSheet("restyle");
    input.focus();
  });
  $("tool-retry").addEventListener("click", loadTool);
  var closers = document.querySelectorAll("[data-close]");
  for (var i = 0; i < closers.length; i++) closers[i].addEventListener("click", closeSheets);
  var copiers = document.querySelectorAll("[data-copy]");
  for (var j = 0; j < copiers.length; j++) {
    (function (btn) {
      btn.addEventListener("click", function () { copyFrom($(btn.getAttribute("data-copy")), btn); });
    })(copiers[j]);
  }

  function restyleSentence() {
    var name = sentenceToolName(current.tool);
    var text = ($("restyle-input").value || "").trim();
    return text ? T.restyleWith(name, text) : T.restyleEmpty(name);
  }
  bindSentence($("btn-restyle"), restyleSentence, function (sentence) {
    sendEvent("restyle", { tool: current.tool, text: ($("restyle-input").value || "").trim() });
  });
  $("restyle-input").addEventListener("input", refreshHrefs);
  // 「好的」: the tour is acknowledged. The page settles this itself — the
  // server flips state.json to `kept` (no agent round-trip for a nod) and the
  // SSE state frame takes the card and the ✦ entry away. Deleting the
  // Liveware stays a chat request to the agent.
  $("btn-keep").addEventListener("click", function () {
    var btn = $("btn-keep");
    btn.disabled = true;
    fetch("/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: "kept" }),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      $("finish-card").hidden = true; // optimistic; the state frame confirms
    }).catch(function () { btn.disabled = false; });
  });

  fetch("/state")
    .then(function (r) { if (!r.ok) throw new Error("state " + r.status); return r.json(); })
    .then(render)
    .catch(function () { render({}); });

  var es = new EventSource("/sse");
  es.addEventListener("state", function (ev) {
    try { render(JSON.parse(ev.data)); } catch (e) {}
  });
  // The agent rewrote tool/index.html (another restyle round) → show it.
  es.addEventListener("tool", function () {
    if (current.stage !== "intro") loadTool();
  });
})();
