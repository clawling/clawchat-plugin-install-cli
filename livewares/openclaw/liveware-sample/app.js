/* Liveware Sample front-end: render state.json, live-update via SSE, report interactions. */
(function () {
  var ID_RE = /^[A-Za-z0-9_-]+$/;

  function applyAgentId(agentId) {
    var row = document.getElementById("nav-row");
    var fallback = document.getElementById("nav-fallback");
    var link = document.getElementById("back-to-chat");
    if (typeof agentId === "string" && ID_RE.test(agentId)) {
      // Real <a> href — the mobile liveware container only dispatches
      // non-web schemes on a genuine user gesture (LINK_ACTIVATED).
      link.setAttribute("href", "clawchat://u/" + agentId + "?chat=1");
      row.hidden = false;
      fallback.hidden = true;
    } else {
      row.hidden = true;
      fallback.hidden = false;
    }
  }

  function render(state) {
    document.getElementById("title").textContent = state.title || "";
    document.getElementById("body").textContent = state.body || "";
    if (state.theme) document.documentElement.style.setProperty("--theme", state.theme);
    applyAgentId(state.agentId);
  }

  function sendEvent(type, payload) {
    fetch("/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: type, payload: payload }),
      // keepalive: the back-to-chat click navigates away immediately —
      // without it the POST would be aborted mid-flight.
      keepalive: true,
    }).catch(function () {});
  }

  fetch("/state")
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () { applyAgentId(null); });

  var es = new EventSource("/sse");
  es.addEventListener("state", function (ev) {
    try { render(JSON.parse(ev.data)); } catch (e) {}
  });

  document.getElementById("like").addEventListener("click", function () {
    sendEvent("click", { button: "like" });
  });
  document.getElementById("send").addEventListener("click", function () {
    var input = document.getElementById("note");
    var text = (input.value || "").trim();
    if (!text) return;
    sendEvent("note", { text: text });
    input.value = "";
  });
  document.getElementById("back-to-chat").addEventListener("click", function () {
    var input = document.getElementById("nav-input");
    sendEvent("click", { button: "back-to-chat", text: (input.value || "").trim() });
    // No preventDefault: the anchor's own navigation IS the deep link.
  });
})();
