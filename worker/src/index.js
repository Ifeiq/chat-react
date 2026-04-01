/**
 * @typedef {{ CHAT_ROOM: DurableObjectNamespace }} Env
 */

/**
 * @typedef {{ name: string }} ClientAttachment
 */

/**
 * @typedef {{
 *   type: 'join'; name: string
 * } | {
 *   type: 'message'; text: string
 * } | {
 *   type: 'image'; dataUrl: string; filename?: string
 * }} ClientMessage
 */

/**
 * @typedef {{
 *   type: 'system'; text: string; ts: number
 * } | {
 *   type: 'presence'; users: string[]; ts: number
 * } | {
 *   type: 'message'; id: string; name: string; text: string; ts: number
 * } | {
 *   type: 'image'; id: string; name: string; dataUrl: string; filename?: string; ts: number
 * }} ServerEvent
 */

function jsonResponse(data, init) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  });
}

function safeName(input) {
  const raw = typeof input === 'string' ? input : '';
  const trimmed = raw.trim().slice(0, 24);
  return trimmed.replace(/[^\p{L}\p{N}_\-.\s]/gu, '') || 'Anon';
}

function safeText(input) {
  const raw = typeof input === 'string' ? input : '';
  return raw.trim().slice(0, 2000);
}

function isProbablyDataUrl(s) {
  return typeof s === 'string' && s.startsWith('data:image/') && s.includes(';base64,');
}

const MAX_IMAGE_CHARS = 450_000; // ~330KB base64 payload (rough)

/** @type {ExportedHandler<Env>} */
const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return jsonResponse({ ok: true });

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 426 });
      }

      const room = url.searchParams.get('room') ?? 'global';
      const id = env.CHAT_ROOM.idFromName(room);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};

export default worker;

export class ChatRoom {
  /** @param {DurableObjectState} state */
  constructor(state) {
    /** @type {DurableObjectState} */
    this.state = state;
    /** @type {Map<WebSocket, ClientAttachment>} */
    this.sessions = new Map();

    this.state.getWebSockets().forEach((ws) => {
      /** @type {ClientAttachment | undefined} */
      const attachment = ws.deserializeAttachment();
      this.sessions.set(ws, attachment ?? { name: 'Anon' });
      this.attachSocket(ws);
    });
  }

  /** @param {Request} request */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    /** @type {ClientAttachment} */
    const attachment = { name: 'Anon' };
    server.serializeAttachment(attachment);
    this.sessions.set(server, attachment);
    this.attachSocket(server);

    server.accept();
    this.broadcast({ type: 'presence', users: this.userList(), ts: Date.now() });

    return new Response(null, { status: 101, webSocket: client });
  }

  /** @param {WebSocket} ws */
  attachSocket(ws) {
    ws.addEventListener('message', (evt) => this.onMessage(ws, evt));
    ws.addEventListener('close', () => this.onClose(ws));
    ws.addEventListener('error', () => this.onClose(ws));
  }

  /** @param {WebSocket} ws */
  onClose(ws) {
    this.sessions.delete(ws);
    this.broadcast({ type: 'presence', users: this.userList(), ts: Date.now() });
  }

  /**
   * @param {WebSocket} ws
   * @param {MessageEvent} evt
   */
  onMessage(ws, evt) {
    const raw = typeof evt.data === 'string' ? evt.data : null;
    if (!raw) return;

    /** @type {ClientMessage | null} */
    let msg = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const attachment = this.sessions.get(ws) ?? { name: 'Anon' };

    if (msg.type === 'join') {
      attachment.name = safeName(msg.name);
      ws.serializeAttachment(attachment);
      this.sessions.set(ws, attachment);
      this.broadcast({ type: 'system', text: `${attachment.name} entrou no chat`, ts: Date.now() });
      this.broadcast({ type: 'presence', users: this.userList(), ts: Date.now() });
      return;
    }

    if (msg.type === 'message') {
      const text = safeText(msg.text);
      if (!text) return;

      /** @type {ServerEvent} */
      const payload = {
        type: 'message',
        id: crypto.randomUUID(),
        name: attachment.name,
        text,
        ts: Date.now(),
      };
      this.broadcast(payload);
      return;
    }

    if (msg.type === 'image') {
      if (!isProbablyDataUrl(msg.dataUrl)) return;
      if (msg.dataUrl.length > MAX_IMAGE_CHARS) {
        /** @type {ServerEvent} */
        const warn = {
          type: 'system',
          text: `Imagem muito grande. Limite aproximado: ${(MAX_IMAGE_CHARS / 1024).toFixed(0)}KB (base64).`,
          ts: Date.now(),
        };
        ws.send(JSON.stringify(warn));
        return;
      }

      /** @type {ServerEvent} */
      const payload = {
        type: 'image',
        id: crypto.randomUUID(),
        name: attachment.name,
        dataUrl: msg.dataUrl,
        filename: typeof msg.filename === 'string' ? msg.filename.slice(0, 120) : undefined,
        ts: Date.now(),
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
        // ignore
      }
    }
  }
}

