var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
function jsonResponse(data, init) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers ?? {}
    }
  });
}
__name(jsonResponse, "jsonResponse");
function safeName(input) {
  const raw = typeof input === "string" ? input : "";
  const trimmed = raw.trim().slice(0, 24);
  return trimmed.replace(/[^\p{L}\p{N}_\-.\s]/gu, "") || "Anon";
}
__name(safeName, "safeName");
function safeText(input) {
  const raw = typeof input === "string" ? input : "";
  return raw.trim().slice(0, 2e3);
}
__name(safeText, "safeText");
function isProbablyDataUrl(s) {
  return typeof s === "string" && s.startsWith("data:image/") && s.includes(";base64,");
}
__name(isProbablyDataUrl, "isProbablyDataUrl");
var MAX_IMAGE_CHARS = 45e4;
var worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return jsonResponse({ ok: true });
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }
      const room = url.searchParams.get("room") ?? "global";
      const id = env.CHAT_ROOM.idFromName(room);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  }
};
var src_default = worker;
var ChatRoom = class {
  static {
    __name(this, "ChatRoom");
  }
  /** @param {DurableObjectState} state */
  constructor(state) {
    this.state = state;
    this.sessions = /* @__PURE__ */ new Map();
    this.state.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment();
      this.sessions.set(ws, attachment ?? { name: "Anon" });
      this.attachSocket(ws);
    });
  }
  /** @param {Request} request */
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment = { name: "Anon" };
    server.serializeAttachment(attachment);
    this.sessions.set(server, attachment);
    this.attachSocket(server);
    server.accept();
    this.broadcast({ type: "presence", users: this.userList(), ts: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }
  /** @param {WebSocket} ws */
  attachSocket(ws) {
    ws.addEventListener("message", (evt) => this.onMessage(ws, evt));
    ws.addEventListener("close", () => this.onClose(ws));
    ws.addEventListener("error", () => this.onClose(ws));
  }
  /** @param {WebSocket} ws */
  onClose(ws) {
    this.sessions.delete(ws);
    this.broadcast({ type: "presence", users: this.userList(), ts: Date.now() });
  }
  /**
   * @param {WebSocket} ws
   * @param {MessageEvent} evt
   */
  onMessage(ws, evt) {
    const raw = typeof evt.data === "string" ? evt.data : null;
    if (!raw) return;
    let msg = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const attachment = this.sessions.get(ws) ?? { name: "Anon" };
    if (msg.type === "join") {
      attachment.name = safeName(msg.name);
      ws.serializeAttachment(attachment);
      this.sessions.set(ws, attachment);
      this.broadcast({ type: "system", text: `${attachment.name} entrou no chat`, ts: Date.now() });
      this.broadcast({ type: "presence", users: this.userList(), ts: Date.now() });
      return;
    }
    if (msg.type === "message") {
      const text = safeText(msg.text);
      if (!text) return;
      const payload = {
        type: "message",
        id: crypto.randomUUID(),
        name: attachment.name,
        text,
        ts: Date.now()
      };
      this.broadcast(payload);
      return;
    }
    if (msg.type === "image") {
      if (!isProbablyDataUrl(msg.dataUrl)) return;
      if (msg.dataUrl.length > MAX_IMAGE_CHARS) {
        const warn = {
          type: "system",
          text: `Imagem muito grande. Limite aproximado: ${(MAX_IMAGE_CHARS / 1024).toFixed(0)}KB (base64).`,
          ts: Date.now()
        };
        ws.send(JSON.stringify(warn));
        return;
      }
      const payload = {
        type: "image",
        id: crypto.randomUUID(),
        name: attachment.name,
        dataUrl: msg.dataUrl,
        filename: typeof msg.filename === "string" ? msg.filename.slice(0, 120) : void 0,
        ts: Date.now()
      };
      this.broadcast(payload);
    }
  }
  userList() {
    const names = Array.from(this.sessions.values()).map((s) => s.name);
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }
  /** @param {ServerEvent} evt */
  broadcast(evt) {
    const data = JSON.stringify(evt);
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(data);
      } catch {
      }
    }
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ZpsxBU/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ZpsxBU/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker2) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker2;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker2.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker2.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker2,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker2.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker2.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ChatRoom,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
