/*
 * OpenVoicing embed SDK.
 *
 * Include this script and either mark elements with data-openvoicing-bundle
 * (auto-initialized on DOMContentLoaded) or call OpenVoicing.create(target,
 * options) for a scriptable controller.
 *
 *   <script src="https://player.example.com/openvoicing-embed.js"></script>
 *   <div data-openvoicing-bundle="https://example.com/tune.ovb"></div>
 *
 *   const player = OpenVoicing.create("#slot", { bundle: "tune.ovb" });
 *   player.on("position", (e) => ...);
 *   player.play();
 *
 * The player page defaults to embed.html next to this script; override with
 * options.player or data-openvoicing-player.
 */
(function () {
  "use strict";

  var currentScript = document.currentScript;
  var defaultPlayer = currentScript
    ? new URL("embed.html", currentScript.src).toString()
    : "/embed.html";

  function create(target, options) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) throw new Error("OpenVoicing: target element not found");
    var opts = options || {};
    var bundle = opts.bundle || el.getAttribute("data-openvoicing-bundle");
    if (!bundle) throw new Error("OpenVoicing: no bundle URL given");
    var playerUrl = opts.player || el.getAttribute("data-openvoicing-player") || defaultPlayer;
    var height = opts.height || el.getAttribute("data-openvoicing-height") || 480;

    var bundleUrl = new URL(bundle, window.location.href).toString();
    var src =
      playerUrl + (playerUrl.indexOf("?") === -1 ? "?" : "&") + "bundle=" + encodeURIComponent(bundleUrl);

    var iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.allow = "autoplay";
    iframe.style.width = "100%";
    iframe.style.height = typeof height === "number" ? height + "px" : height;
    iframe.style.border = "0";
    iframe.setAttribute("title", "OpenVoicing player");
    el.appendChild(iframe);

    var ready = false;
    var queue = [];
    var listeners = {};

    function emit(type, data) {
      (listeners[type] || []).forEach(function (cb) {
        cb(data);
      });
    }

    function send(message) {
      if (ready && iframe.contentWindow) {
        message.ov = true;
        iframe.contentWindow.postMessage(message, "*");
      } else {
        queue.push(message);
      }
    }

    function onMessage(e) {
      if (!iframe.contentWindow || e.source !== iframe.contentWindow) return;
      var msg = e.data;
      if (!msg || msg.ov !== true) return;
      if (msg.type === "ready" && !ready) {
        ready = true;
        var pending = queue.splice(0);
        pending.forEach(send);
      }
      emit(msg.type, msg);
    }

    window.addEventListener("message", onMessage);

    return {
      element: iframe,
      play: function () {
        send({ type: "play" });
      },
      pause: function () {
        send({ type: "pause" });
      },
      toggle: function () {
        send({ type: "toggle" });
      },
      seek: function (seconds) {
        send({ type: "seek", seconds: seconds });
      },
      setSpeed: function (value) {
        send({ type: "setSpeed", value: value });
      },
      on: function (type, cb) {
        (listeners[type] = listeners[type] || []).push(cb);
        return function () {
          listeners[type] = listeners[type].filter(function (x) {
            return x !== cb;
          });
        };
      },
      destroy: function () {
        window.removeEventListener("message", onMessage);
        iframe.remove();
      },
    };
  }

  function autoInit() {
    var nodes = document.querySelectorAll("[data-openvoicing-bundle]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.__openvoicing) el.__openvoicing = create(el, {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }

  window.OpenVoicing = { create: create };
})();
