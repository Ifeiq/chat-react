import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';

type ServerEvent =
  | { type: 'system'; text: string; ts: number }
  | { type: 'presence'; users: string[]; ts: number }
  | { type: 'message'; id: string; name: string; text: string; ts: number }
  | { type: 'image'; id: string; name: string; dataUrl: string; filename?: string; ts: number };

type ChatItem =
  | { kind: 'system'; text: string; ts: number }
  | { kind: 'message'; id: string; name: string; text: string; ts: number }
  | { kind: 'image'; id: string; name: string; dataUrl: string; filename?: string; ts: number };

const ROOM = 'global';
const LS_NAME_KEY = 'chat:name';

function formatTime(ts: number) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  } catch {
    return '';
  }
}

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(' ');
}

function clampName(input: string) {
  const trimmed = input.trim().slice(0, 24);
  return trimmed || '';
}

function isImageFile(file: File) {
  return file.type.startsWith('image/');
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

export default function ChatApp() {
  const [name, setName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState('');
  const [isUsersOpen, setIsUsersOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const wsUrl = useMemo(() => {
    // Dev local: `astro dev` (4321+auto) + `wrangler dev` (8787)
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return `ws://localhost:8787/ws?room=${encodeURIComponent(ROOM)}`;
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws?room=${encodeURIComponent(ROOM)}`;
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(LS_NAME_KEY) ?? '';
    if (saved.trim()) {
      setDraftName(saved);
    }
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsUsersOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function pushSystem(text: string) {
    setItems((prev) => [...prev, { kind: 'system', text, ts: Date.now() }]);
  }

  function connect(nextName: string) {
    const safe = clampName(nextName);
    if (!safe) return;

    setConnecting(true);
    setConnected(false);

    wsRef.current?.close();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', name: safe }));
      setName(safe);
      localStorage.setItem(LS_NAME_KEY, safe);
      setConnecting(false);
      setConnected(true);
      pushSystem('Conectado.');
    });

    ws.addEventListener('close', () => {
      setConnected(false);
      setConnecting(false);
      pushSystem('Desconectado.');
    });

    ws.addEventListener('error', () => {
      setConnected(false);
      setConnecting(false);
      pushSystem('Erro de conexão.');
    });

    ws.addEventListener('message', (evt) => {
      if (typeof evt.data !== 'string') return;
      let parsed: ServerEvent | null = null;
      try {
        parsed = JSON.parse(evt.data) as ServerEvent;
      } catch {
        return;
      }

      if (parsed.type === 'presence') {
        setUsers(parsed.users);
        return;
      }

      if (parsed.type === 'system') {
        setItems((prev) => [...prev, { kind: 'system', text: parsed.text, ts: parsed.ts }]);
        return;
      }

      if (parsed.type === 'message') {
        setItems((prev) => [
          ...prev,
          { kind: 'message', id: parsed.id, name: parsed.name, text: parsed.text, ts: parsed.ts },
        ]);
        return;
      }

      if (parsed.type === 'image') {
        setItems((prev) => [
          ...prev,
          {
            kind: 'image',
            id: parsed.id,
            name: parsed.name,
            dataUrl: parsed.dataUrl,
            filename: parsed.filename,
            ts: parsed.ts,
          },
        ]);
      }
    });
  }

  function sendText() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    ws.send(JSON.stringify({ type: 'message', text: trimmed }));
    setText('');
  }

  async function sendImage(file: File) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!isImageFile(file)) {
      pushSystem('Selecione um arquivo de imagem.');
      return;
    }

    // Mantém UX boa no mobile e respeita o limite do backend (base64).
    if (file.size > 350_000) {
      pushSystem('Imagem muito grande. Tente uma imagem menor (até ~350KB).');
      return;
    }

    try {
      const dataUrl = await readAsDataUrl(file);
      ws.send(JSON.stringify({ type: 'image', dataUrl, filename: file.name }));
    } catch {
      pushSystem('Não foi possível enviar a imagem.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const isReady = connected && !connecting;

  return (
    <div className="min-h-dvh">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-6">
        <header className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-pink-500 shadow-sm">
              <Icon icon="tabler:message-circle-2-filled" className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-semibold leading-tight sm:text-lg">Chat</h1>
                <span
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                    connected ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-slate-200'
                  )}
                >
                  <span
                    className={cx(
                      'h-1.5 w-1.5 rounded-full',
                      connected ? 'bg-emerald-300' : 'bg-slate-300'
                    )}
                  />
                  {connected ? 'online' : connecting ? 'conectando' : 'offline'}
                </span>
              </div>
              <p className="truncate text-xs text-slate-300/90">
                {name ? (
                  <>
                    Você entrou como <span className="text-slate-100">{name}</span>
                  </>
                ) : (
                  'Entre com seu nome para começar'
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsUsersOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 hover:bg-white/10 sm:hidden"
              aria-label="Abrir usuários"
            >
              <Icon icon="tabler:users" className="h-5 w-5" />
              <span className="text-xs">{users.length}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                wsRef.current?.close();
                setName('');
                setUsers([]);
                setConnected(false);
                setConnecting(false);
                setItems([]);
                setText('');
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 hover:bg-white/10"
            >
              <Icon icon="tabler:logout" className="h-5 w-5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </header>

        <div className="mt-4 grid flex-1 grid-cols-1 gap-4 sm:grid-cols-[280px_1fr]">
          <aside className="hidden h-[calc(100dvh-170px)] min-h-0 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur sm:block">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon icon="tabler:users" className="h-5 w-5 text-slate-200" />
                <h2 className="text-sm font-semibold">Pessoas</h2>
              </div>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{users.length}</span>
            </div>
            <div className="h-[calc(100%-34px)] overflow-auto pr-1">
              {users.length === 0 ? (
                <p className="text-sm text-slate-300/80">Ninguém ainda.</p>
              ) : (
                <ul className="space-y-1">
                  {users.map((u) => (
                    <li
                      key={u}
                      className={cx(
                        'flex items-center justify-between rounded-xl px-3 py-2 text-sm',
                        u === name ? 'bg-indigo-500/15 text-indigo-100' : 'bg-white/0 text-slate-100'
                      )}
                    >
                      <span className="truncate">{u}</span>
                      {u === name ? (
                        <span className="ml-2 rounded-full bg-indigo-400/20 px-2 py-0.5 text-[11px] text-indigo-100">
                          você
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
            <div
              ref={scrollerRef}
              className="flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-4"
              aria-label="Mensagens"
            >
              {items.length === 0 ? (
                <div className="grid h-full place-items-center">
                  <div className="max-w-sm text-center">
                    <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/5">
                      <Icon icon="tabler:sparkles" className="h-6 w-6 text-fuchsia-200" />
                    </div>
                    <p className="text-sm text-slate-200">
                      Entre com um nome e comece a conversar. Você pode enviar texto e imagens.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((it) => {
                    if (it.kind === 'system') {
                      return (
                        <div key={`${it.ts}-${it.text}`} className="flex justify-center">
                          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
                            {it.text}
                          </div>
                        </div>
                      );
                    }

                    const mine = it.name === name;
                    const bubbleBase =
                      'max-w-[92%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[78%]';
                    const bubble = mine
                      ? 'bg-gradient-to-br from-indigo-500/85 via-fuchsia-500/75 to-pink-500/75 text-white'
                      : 'bg-white/7 text-slate-100';

                    if (it.kind === 'image') {
                      return (
                        <div key={it.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                          <div className={cx(bubbleBase, bubble, 'p-2')}>
                            <div className="mb-1 flex items-baseline justify-between gap-2">
                              <span className={cx('text-xs font-semibold', mine ? 'text-white/95' : 'text-slate-200')}>
                                {it.name}
                              </span>
                              <span className={cx('text-[11px]', mine ? 'text-white/80' : 'text-slate-300/80')}>
                                {formatTime(it.ts)}
                              </span>
                            </div>
                            <a href={it.dataUrl} target="_blank" rel="noreferrer" className="block">
                              <img
                                src={it.dataUrl}
                                alt={it.filename ?? 'imagem'}
                                className="max-h-[360px] w-full rounded-xl object-contain"
                                loading="lazy"
                              />
                            </a>
                            {it.filename ? (
                              <div className={cx('mt-1 text-[11px]', mine ? 'text-white/80' : 'text-slate-300/80')}>
                                {it.filename}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={it.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                        <div className={cx(bubbleBase, bubble)}>
                          <div className="mb-1 flex items-baseline justify-between gap-2">
                            <span className={cx('text-xs font-semibold', mine ? 'text-white/95' : 'text-slate-200')}>
                              {it.name}
                            </span>
                            <span className={cx('text-[11px]', mine ? 'text-white/80' : 'text-slate-300/80')}>
                              {formatTime(it.ts)}
                            </span>
                          </div>
                          <div className="whitespace-pre-wrap break-words">{it.text}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-white/10 bg-slate-950/10 px-3 py-3 sm:px-4">
              {!name ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    connect(draftName);
                  }}
                >
                  <div className="relative flex-1">
                    <Icon
                      icon="tabler:user"
                      className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-300"
                    />
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="Seu nome (ex: Pichau)"
                      className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-3 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-300/70 focus:border-indigo-400/40 focus:bg-white/7"
                      autoFocus
                      inputMode="text"
                      maxLength={24}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={connecting || !clampName(draftName)}
                    className={cx(
                      'inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white',
                      'bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-pink-500',
                      'disabled:opacity-50'
                    )}
                  >
                    {connecting ? (
                      <Icon icon="tabler:loader-2" className="h-5 w-5 animate-spin" />
                    ) : (
                      <Icon icon="tabler:login" className="h-5 w-5" />
                    )}
                    Entrar
                  </button>
                </form>
              ) : (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendText();
                  }}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void sendImage(f);
                    }}
                  />

                  <button
                    type="button"
                    disabled={!isReady}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 disabled:opacity-50"
                    aria-label="Enviar imagem"
                  >
                    <Icon icon="tabler:photo" className="h-5 w-5" />
                  </button>

                  <div className="relative flex-1">
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={connected ? 'Escreva uma mensagem…' : 'Conecte para enviar'}
                      className="max-h-28 min-h-11 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-300/70 focus:border-indigo-400/40 focus:bg-white/7"
                      disabled={!isReady}
                      rows={1}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendText();
                        }
                      }}
                    />
                    <div className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-slate-300/60">
                      Enter envia • Shift+Enter quebra linha
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!isReady || !text.trim()}
                    className={cx(
                      'inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white',
                      'bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-pink-500',
                      'disabled:opacity-50'
                    )}
                  >
                    <Icon icon="tabler:send-2" className="h-5 w-5" />
                    <span className="hidden sm:inline">Enviar</span>
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Mobile users drawer */}
      <div className={cx('fixed inset-0 z-50 sm:hidden', isUsersOpen ? '' : 'pointer-events-none')}>
        <div
          className={cx(
            'absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity',
            isUsersOpen ? 'opacity-100' : 'opacity-0'
          )}
          onClick={() => setIsUsersOpen(false)}
          aria-hidden="true"
        />
        <div
          className={cx(
            'absolute inset-x-0 bottom-0 rounded-t-3xl border border-white/10 bg-slate-950/95 p-4 transition-transform',
            isUsersOpen ? 'translate-y-0' : 'translate-y-full'
          )}
          role="dialog"
          aria-label="Usuários"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon icon="tabler:users" className="h-5 w-5 text-slate-200" />
              <h2 className="text-sm font-semibold">Pessoas</h2>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{users.length}</span>
            </div>
            <button
              type="button"
              onClick={() => setIsUsersOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-slate-100 hover:bg-white/10"
              aria-label="Fechar"
            >
              <Icon icon="tabler:x" className="h-5 w-5" />
            </button>
          </div>

          <div className="max-h-[50dvh] overflow-auto pr-1">
            {users.length === 0 ? (
              <p className="text-sm text-slate-300/80">Ninguém ainda.</p>
            ) : (
              <ul className="space-y-1">
                {users.map((u) => (
                  <li
                    key={u}
                    className={cx(
                      'flex items-center justify-between rounded-xl px-3 py-2 text-sm',
                      u === name ? 'bg-indigo-500/15 text-indigo-100' : 'bg-white/0 text-slate-100'
                    )}
                  >
                    <span className="truncate">{u}</span>
                    {u === name ? (
                      <span className="ml-2 rounded-full bg-indigo-400/20 px-2 py-0.5 text-[11px] text-indigo-100">
                        você
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

