/**
 * Wire contract + networking for talking to an Odysseus server over the LAN.
 *
 * Auth: every request carries `Authorization: Bearer ody_<token>`. Odysseus's
 * AuthMiddleware accepts this on every route, attributes it to the token owner,
 * and runs as the sandboxed pseudo-user "api". We use the companion bridge for
 * model discovery (so we see the owner's models, not the empty "api" set) and
 * the stock endpoints for sessions + streaming chat.
 *
 * Streaming uses `expo/fetch` explicitly (the named import keeps streaming even
 * if EXPO_PUBLIC_USE_RN_FETCH=1 is set) and reads the SSE body incrementally.
 */
import { fetch as expoFetch } from 'expo/fetch';

import type { Pairing } from '@/lib/pairing';

const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'unauthorized' | 'network' | 'server' | 'bad_response',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CompanionInfo {
  name: string;
  version: string;
  owner: string | null;
  capabilities: Record<string, boolean>;
}

export interface ModelEndpoint {
  endpoint_id: string;
  name: string;
  endpoint_url: string;
  models: string[];
  supports_tools: boolean | null;
}

export interface Session {
  id: string;
  name: string;
  model: string;
  rag: boolean;
  archived: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
}

export interface ModelChoice {
  endpoint_id: string;
  endpoint_url: string;
  model: string;
  label: string;
}

export interface Note {
  id: string;
  title?: string;
  content?: string;
  items?: { text: string; done: boolean }[];
  pinned?: boolean;
}

export interface Task {
  id: string;
  name: string;
  schedule?: string;
  enabled?: boolean;
  last_run?: string | null;
}

export interface Memory {
  id: string;
  text: string;
  category?: string;
}

function baseUrl(p: Pairing): string {
  return `http://${p.host}:${p.port}`;
}

function authHeaders(p: Pairing): Record<string, string> {
  return { Authorization: `Bearer ${p.token}` };
}

async function request(
  p: Pairing,
  path: string,
  init?: { method?: string; body?: BodyInit; headers?: Record<string, string> },
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl(p)}${path}`, {
      method: init?.method ?? 'GET',
      headers: { ...authHeaders(p), ...(init?.headers ?? {}) },
      body: init?.body,
      signal: controller.signal,
    });
    if (res.status === 401) {
      throw new ApiError('The pairing token was rejected. Re-pair from your server.', 'unauthorized', 401);
    }
    return res;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // A reachable-but-slow server hit the timeout; distinguish that from a host
    // we never reached so the message isn't misleading.
    if (timedOut) {
      throw new ApiError('The server took too long to respond. Is it busy or far away?', 'network');
    }
    throw new ApiError('Could not reach Odysseus. Is the server on and on the same network?', 'network');
  } finally {
    clearTimeout(timer);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
  const data = (await res.json().catch(() => null)) as T | null;
  if (data === null) throw new ApiError('Unexpected response from server.', 'bad_response');
  return data;
}

/** Verify host/port/token during pairing. Returns server identity on success. */
export async function ping(p: Pairing): Promise<{ ok: boolean; name: string; version: string }> {
  const res = await request(p, '/api/companion/ping');
  return json(res);
}

export async function getInfo(p: Pairing): Promise<CompanionInfo> {
  const res = await request(p, '/api/companion/info');
  return json(res);
}

/** Owner-scoped model endpoints (via the companion bridge). */
export async function listModels(p: Pairing): Promise<ModelEndpoint[]> {
  const res = await request(p, '/api/companion/models');
  const data = await json<{ endpoints: ModelEndpoint[] }>(res);
  return data.endpoints ?? [];
}

/** Flatten endpoints → individual selectable (endpoint, model) choices. */
export function flattenModels(endpoints: ModelEndpoint[]): ModelChoice[] {
  const out: ModelChoice[] = [];
  // A model name can be served by more than one endpoint. Qualify the label with
  // the endpoint name in that case so choices stay distinguishable in a picker.
  const counts = new Map<string, number>();
  for (const ep of endpoints) for (const m of ep.models) counts.set(m, (counts.get(m) ?? 0) + 1);
  for (const ep of endpoints) {
    for (const m of ep.models) {
      const label = (counts.get(m) ?? 0) > 1 && ep.name ? `${m} · ${ep.name}` : m;
      out.push({ endpoint_id: ep.endpoint_id, endpoint_url: ep.endpoint_url, model: m, label });
    }
  }
  return out;
}

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function createSession(p: Pairing, choice: ModelChoice, name = 'Mobile chat'): Promise<Session> {
  const res = await request(p, '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      name,
      endpoint_url: choice.endpoint_url,
      model: choice.model,
      endpoint_id: choice.endpoint_id,
      // The server can't re-probe the endpoint to validate (the API key lives
      // server-side; this bearer caller can't pass it). Trust the model from
      // /api/companion/models and skip the probe — the session inherits the
      // endpoint's stored key via endpoint_id.
      skip_validation: 'true',
    }),
  });
  return json<Session>(res);
}

export async function listSessions(p: Pairing): Promise<Session[]> {
  const res = await request(p, '/api/sessions');
  const data = await json<Session[] | { sessions: Session[] }>(res);
  return Array.isArray(data) ? data : (data.sessions ?? []);
}

export async function getHistory(p: Pairing, sessionId: string): Promise<ChatMessage[]> {
  const res = await request(p, `/api/history/${encodeURIComponent(sessionId)}`);
  const data = await json<{ history: ChatMessage[] }>(res);
  return data.history ?? [];
}

/** Rename a session. Form field `name`. Ignores the response body. */
export async function renameSession(p: Pairing, id: string, name: string): Promise<void> {
  const res = await request(p, `/api/session/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ name }),
  });
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
}

export async function deleteSession(p: Pairing, id: string): Promise<void> {
  const res = await request(p, `/api/session/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
}

/** Tolerate `{items}`, `{<key>}`, or a bare array from companion list endpoints. */
async function listFrom<T>(res: Response, key: string): Promise<T[]> {
  const data = await json<T[] | Record<string, unknown>>(res);
  if (Array.isArray(data)) return data;
  const items = (data as Record<string, unknown>).items ?? (data as Record<string, unknown>)[key];
  return Array.isArray(items) ? (items as T[]) : [];
}

export async function listNotes(p: Pairing): Promise<Note[]> {
  const res = await request(p, '/api/companion/notes');
  return listFrom<Note>(res, 'notes');
}

export async function listTasks(p: Pairing): Promise<Task[]> {
  const res = await request(p, '/api/companion/tasks');
  return listFrom<Task>(res, 'tasks');
}

export async function listMemories(p: Pairing): Promise<Memory[]> {
  const res = await request(p, '/api/companion/memory');
  return listFrom<Memory>(res, 'memory');
}

/** Categories the memory composer offers. Matches the server's allowed set. */
export const MEMORY_CATEGORIES = [
  'fact',
  'identity',
  'preference',
  'contact',
  'project',
  'goal',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** Create a memory owned by the paired token owner. Returns the new entry. */
export async function addMemory(
  p: Pairing,
  text: string,
  category: MemoryCategory = 'fact',
): Promise<Memory> {
  const res = await request(p, '/api/companion/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ text, category }),
  });
  return json<Memory>(res);
}

export async function deleteMemory(p: Pairing, id: string): Promise<void> {
  const res = await request(p, `/api/companion/memory/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
}

/**
 * Create a note. Pass `items` for a checklist (note_type=checklist server-side),
 * or `content` for a plain text note.
 */
export async function createNote(
  p: Pairing,
  input: { title?: string; content?: string; items?: { text: string; done: boolean }[]; pinned?: boolean },
): Promise<Note> {
  const fields: Record<string, string> = {
    title: input.title ?? '',
    pinned: input.pinned ? 'true' : 'false',
  };
  if (input.content != null) fields.content = input.content;
  if (input.items != null) fields.items = JSON.stringify(input.items);
  const res = await request(p, '/api/companion/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(fields),
  });
  return json<Note>(res);
}

export async function deleteNote(p: Pairing, id: string): Promise<void> {
  const res = await request(p, `/api/companion/notes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
}

/** Flip a note's pinned flag. Returns the new pinned state. */
export async function toggleNotePin(p: Pairing, id: string): Promise<boolean> {
  const res = await request(p, `/api/companion/notes/${encodeURIComponent(id)}/pin`, {
    method: 'POST',
  });
  const data = await json<{ ok: boolean; pinned: boolean }>(res);
  return data.pinned;
}

/** Toggle one checklist item's done state. Returns the updated item list. */
export async function toggleNoteItem(
  p: Pairing,
  id: string,
  index: number,
): Promise<{ text: string; done: boolean }[]> {
  const res = await request(
    p,
    `/api/companion/notes/${encodeURIComponent(id)}/items/${index}/toggle`,
    { method: 'POST' },
  );
  const data = await json<{ ok: boolean; items: { text: string; done: boolean }[] }>(res);
  return data.items ?? [];
}

export async function stopStream(p: Pairing, sessionId: string): Promise<void> {
  await request(p, `/api/chat/stop/${encodeURIComponent(sessionId)}`, { method: 'POST' }).catch(() => {});
}

export interface WebSource {
  url: string;
  title: string;
}

export interface RagSource {
  filename: string;
  snippet: string;
  similarity: number;
}

export interface ResearchSource {
  url: string;
  title: string;
  image?: string;
  summary?: string;
}

export interface MemoryUsed {
  text: string;
  category?: string;
  type?: string;
}

/**
 * Citations + context the server attached to a reply. Each field arrives as its
 * own SSE event during a stream; the UI merges these into the assistant message.
 */
export interface ChatSources {
  web?: WebSource[];
  rag?: RagSource[];
  research?: ResearchSource[];
  memories?: MemoryUsed[];
}

export interface ChatStreamHandlers {
  onDelta: (text: string) => void;
  onDone?: () => void;
  onModel?: (model: string) => void;
  /** Fired once per source event with just that event's slice of sources. */
  onSources?: (partial: ChatSources) => void;
  onError?: (err: ApiError) => void;
  /**
   * Research runs server-side as a background task: it streams progress events
   * but NOT the report text (that's persisted to the session history). The UI
   * uses onResearchProgress to show activity and onResearchDone to fetch +
   * render the finished report from history.
   */
  onResearchProgress?: (data: unknown) => void;
  onResearchDone?: () => void;
}

/**
 * Send a message and stream the assistant's reply.
 *
 * Odysseus streams Server-Sent Events: lines of `data: {json}\n\n`, where text
 * chunks arrive as `{"delta":"..."}`, other events as `{"type":"..."}`, and the
 * stream ends with `data: [DONE]`. Comment lines (`: heartbeat`) are ignored.
 *
 * Returns an abort function the UI can call to stop generation locally; it also
 * tells the server to stop via /api/chat/stop.
 */
export function streamChat(
  p: Pairing,
  args: { message: string; session: string; mode?: 'chat' | 'agent'; useWeb?: boolean; useResearch?: boolean },
  handlers: ChatStreamHandlers,
): () => void {
  const controller = new AbortController();

  // Bound only the CONNECT phase: if the host is offline/wrong the fetch can hang
  // forever, stranding the composer. We abort after TIMEOUT_MS and clear the timer
  // the moment response headers arrive, so an established stream is never cut off
  // mid-generation (long replies are expected and must not be truncated).
  let connected = false;
  let connectTimedOut = false;
  const connectTimer = setTimeout(() => {
    if (connected) return;
    connectTimedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  (async () => {
    let res: Response;
    try {
      res = await expoFetch(`${baseUrl(p)}/api/chat_stream`, {
        method: 'POST',
        headers: {
          ...authHeaders(p),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/event-stream',
        },
        body: form({
          message: args.message,
          session: args.session,
          mode: args.mode ?? 'chat',
          use_web: args.useWeb ? 'true' : 'false',
          ...(args.useResearch ? { use_research: 'true' } : {}),
        }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(connectTimer);
      // A user-initiated abort isn't an error to report.
      if (controller.signal.aborted && !connectTimedOut) return;
      handlers.onError?.(
        new ApiError(
          connectTimedOut ? 'Odysseus didn’t respond in time. Is the server reachable?' : 'Lost connection to Odysseus.',
          'network',
        ),
      );
      return;
    }
    connected = true;
    clearTimeout(connectTimer);

    if (res.status === 401) {
      handlers.onError?.(new ApiError('Token rejected. Re-pair from your server.', 'unauthorized', 401));
      return;
    }
    if (!res.ok || !res.body) {
      handlers.onError?.(new ApiError(`Server responded ${res.status}.`, 'server', res.status));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    // onDone must fire exactly once. The server sends `data: [DONE]` AND then
    // closes the stream, so without this latch onDone would fire twice (once
    // for the sentinel, once when the reader drains) — a foot-gun for any
    // non-idempotent completion handler.
    let doneFired = false;
    const finish = () => {
      if (doneFired) return;
      doneFired = true;
      handlers.onDone?.();
    };

    // Did the stream end the way the protocol says it should — a `[DONE]`
    // sentinel or a `research_done`? If the connection instead closes cleanly
    // after partial output (server crash, killed worker), the reader reaches
    // `done` with no error; without this flag we'd report a truncated reply as a
    // clean completion.
    let endedCleanly = false;

    const handleFrame = (eventName: string, payload: string) => {
      if (payload === '[DONE]') {
        endedCleanly = true;
        finish();
        return;
      }
      // The server signals a failed generation as an SSE `event: error` frame
      // with a JSON `data` payload. Surface it via onError instead of letting
      // it fall through unmatched — otherwise a failed reply looks like a clean
      // but empty completion.
      if (eventName === 'error') {
        let msg = 'The server reported an error.';
        try {
          const e = JSON.parse(payload);
          if (e && typeof e.error === 'string') msg = e.error;
        } catch {
          if (payload) msg = payload;
        }
        handlers.onError?.(new ApiError(msg, 'server'));
        return;
      }
      try {
        const evt = JSON.parse(payload);
        // Reasoning tokens arrive flagged `thinking:true`. The server now keeps
        // them out of saved history; drop them here too so the live bubble shows
        // only the final answer (matching what a reloaded conversation shows).
        if (typeof evt.delta === 'string') {
          if (evt.thinking) return;
          handlers.onDelta(evt.delta);
        }
        else if (evt.type === 'model_info' && evt.model) handlers.onModel?.(evt.model);
        // Source/citation events — each carries its list under `data`. We hand
        // the UI just this slice; it accumulates across the stream.
        else if (evt.type === 'web_sources' && Array.isArray(evt.data))
          handlers.onSources?.({ web: evt.data });
        else if (evt.type === 'rag_sources' && Array.isArray(evt.data))
          handlers.onSources?.({ rag: evt.data });
        // Only `research_sources` carries the source list the UI renders;
        // `research_findings` is a different shape (raw findings) and would
        // pollute the list, so it's intentionally not mapped here.
        else if (evt.type === 'research_sources' && Array.isArray(evt.data))
          handlers.onSources?.({ research: evt.data });
        else if (evt.type === 'memories_used' && Array.isArray(evt.data))
          handlers.onSources?.({ memories: evt.data });
        else if (evt.type === 'research_progress') handlers.onResearchProgress?.(evt.data);
        else if (evt.type === 'research_done') {
          // A finished research run is a legitimate stream end even if no [DONE]
          // sentinel follows.
          endedCleanly = true;
          handlers.onResearchDone?.();
        }
      } catch {
        /* non-JSON data line — ignore */
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. A frame may carry an
        // `event:` line (e.g. `event: error`) plus one or more `data:` lines;
        // collect both so we can route by event type.
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            const trimmed = line.trimStart();
            if (trimmed.startsWith(':')) continue; // heartbeat/comment
            if (trimmed.startsWith('event:')) eventName = trimmed.slice(6).trim();
            else if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).trim());
          }
          if (dataLines.length) handleFrame(eventName, dataLines.join('\n'));
        }
      }
      // Reader drained. If the server never sent its end sentinel and we didn't
      // abort, the reply was cut short — surface it instead of silently passing
      // a truncated answer off as complete.
      if (!endedCleanly && !controller.signal.aborted) {
        handlers.onError?.(new ApiError('The reply ended unexpectedly — the connection closed early.', 'network'));
      } else {
        finish();
      }
    } catch {
      if (!controller.signal.aborted) {
        handlers.onError?.(new ApiError('Stream interrupted.', 'network'));
      }
    } finally {
      reader.releaseLock();
    }
  })();

  return () => {
    controller.abort();
    stopStream(p, args.session);
  };
}
