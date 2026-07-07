/* Liveware Sample front-end: render state.json, live-update via SSE, report interactions. */
(function () {
  function render(state) {
    document.getElementById("title").textContent = state.title || "";
    document.getElementById("body").textContent = state.body || "";
    if (state.theme) document.documentElement.style.setProperty("--theme", state.theme);
  }

  function sendEvent(type, payload) {
    fetch("/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: type, payload: payload }),
    }).catch(function () {});
  }

  fetch("/state").then(function (r) { return r.json(); }).then(render).catch(function () {});

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
})();
