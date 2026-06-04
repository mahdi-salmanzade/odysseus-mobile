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

// Centralized 401 handling. The server returns 401 the moment its admin revokes
// the paired token; without a global hook every screen would just show a
// dead-end error whose Retry re-hits the same 401. The pairing provider
// registers a callback here (which clears the stored pairing and lets the
// router swap back to the pair screen), so a revoked token routes the user to
// re-pair from anywhere. Fired once per detected 401, before the ApiError is
// thrown / handed to onError.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
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
  // Server-persisted per-message metadata. For assistant messages this carries
  // the citation lists (web_sources / rag_sources / research_sources /
  // memories_used) that arrived as SSE events while streaming — so a reloaded
  // conversation can render the same Sources footer the live stream showed.
  metadata?: Record<string, unknown>;
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

/** One entry in the RAG document library (list view — `snippet` is a preview). */
export interface DocumentSummary {
  id: string;
  title: string;
  language: string | null;
  snippet: string;
  updated_at: string | null;
}

/** A single document's full body (detail view). */
export interface DocumentDetail {
  id: string;
  title: string;
  language: string | null;
  content: string;
  archived: boolean;
  updated_at: string | null;
}

/** One image in the owner's gallery. `image_url` is a server-relative path
 *  (e.g. `/api/companion/gallery/image/<id>`) — build an authenticated source
 *  for it with {@link imageSource}. */
export interface GalleryImageItem {
  id: string;
  prompt: string;
  model: string | null;
  favorite: boolean;
  width: number | null;
  height: number | null;
  created_at: string | null;
  image_url: string;
}

export interface Preset {
  id: string;
  name: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  enabled?: boolean;
}

function baseUrl(p: Pairing): string {
  return `http://${p.host}:${p.port}`;
}

function authHeaders(p: Pairing): Record<string, string> {
  return { Authorization: `Bearer ${p.token}` };
}

/**
 * Build an authenticated <Image> source for a server-relative image URL (e.g.
 * a gallery image's `image_url`). The image endpoints require the Bearer token
 * like every other route, so a plain `{ uri }` would 401; React Native's Image
 * accepts per-request headers, so we pass the absolute URL plus the auth header.
 */
export function imageSource(
  p: Pairing,
  imageUrl: string,
): { uri: string; headers: Record<string, string> } {
  return { uri: `${baseUrl(p)}${imageUrl}`, headers: authHeaders(p) };
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
      onUnauthorized?.();
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

// ---------------------------------------------------------------------------
// Mobile push (companion bridge /api/companion/push/*).
//
// The phone registers its Expo push token so the server can deliver
// owner-scoped lifecycle events (research done, etc.) as native notifications.
// The token is a device handle, not a credential; the server stores it under
// the paired token's owner.
// ---------------------------------------------------------------------------

/** Register this device's Expo push token with the paired server. */
export async function registerPushToken(p: Pairing, token: string): Promise<void> {
  const res = await request(p, '/api/companion/push/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
}

/** Drop this device's Expo push token (e.g. on unpair). */
export async function unregisterPushToken(p: Pairing, token: string): Promise<void> {
  const res = await request(p, '/api/companion/push/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
}

/** Ask the server to push a test notification to this owner's devices. Returns
 *  the number of devices it targeted (0 if none are registered). */
export async function sendTestPush(p: Pairing): Promise<number> {
  const res = await request(p, '/api/companion/push/test', { method: 'POST' });
  const data = await json<{ ok: boolean; sent: number }>(res);
  return data.sent ?? 0;
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

/** List the owner's RAG documents (titles + previews; bodies via getDocument). */
export async function listDocuments(p: Pairing): Promise<DocumentSummary[]> {
  const res = await request(p, '/api/companion/documents');
  const items = await listFrom<DocumentSummary>(res, 'documents');
  // The server may send numeric ids; coerce to string so keys/route params match.
  return items.map((d) => ({ ...d, id: String(d.id) }));
}

/** Fetch one document's full body. */
export async function getDocument(p: Pairing, id: string): Promise<DocumentDetail> {
  const res = await request(p, `/api/companion/documents/${encodeURIComponent(id)}`);
  const d = await json<DocumentDetail>(res);
  return { ...d, id: String(d.id) };
}

/** List the owner's generated/uploaded gallery images (newest-first per the
 *  server). Fetch each image's bytes with an authenticated source built from
 *  its `image_url` via {@link imageSource}. */
export async function listGalleryImages(p: Pairing): Promise<GalleryImageItem[]> {
  const res = await request(p, '/api/companion/gallery');
  const items = await listFrom<GalleryImageItem>(res, 'items');
  // The server may send numeric ids; coerce to string so keys/route params match.
  return items.map((i) => ({ ...i, id: String(i.id) }));
}

/**
 * List the chat presets configured on the server (read-only — creating/editing
 * presets is admin-only server-side). Unlike the other list endpoints this one
 * returns a JSON OBJECT keyed by preset id, and that object is shared with
 * non-preset config: it also carries `user_templates` (an array) and possibly
 * other arrays/strings. So we keep only plain-object values that look like a
 * preset (a string `name` and/or `system_prompt`) and key each by its id.
 */
export async function listPresets(p: Pairing): Promise<Preset[]> {
  const res = await request(p, '/api/presets');
  const data = await json<Record<string, unknown>>(res);
  const out: Preset[] = [];
  for (const [id, value] of Object.entries(data)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name : undefined;
    const systemPrompt = typeof v.system_prompt === 'string' ? v.system_prompt : undefined;
    if (name === undefined && systemPrompt === undefined) continue;
    out.push({
      id,
      name: name ?? id,
      temperature: typeof v.temperature === 'number' ? v.temperature : undefined,
      max_tokens: typeof v.max_tokens === 'number' ? v.max_tokens : undefined,
      system_prompt: systemPrompt,
      enabled: typeof v.enabled === 'boolean' ? v.enabled : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Personal assistant (companion bridge /api/companion/assistant).
//
// The owner's single configurable assistant: its persona (name, what it calls
// you, system prompt/personality), greeting, default model, and timezone. GET
// returns null until it's been set up; PATCH creates-or-updates with only the
// fields you pass (omitted fields are left unchanged). All scoped to the paired
// token's owner by the bridge.
// ---------------------------------------------------------------------------

export interface Assistant {
  id: string;
  name: string | null;
  user_name: string | null;
  personality: string | null;
  model: string | null;
  greeting: string | null;
  timezone: string | null;
  avatar: string | null;
  enabled: boolean;
}

/** Fetch the owner's assistant. Returns null when it hasn't been set up yet. */
export async function getAssistant(p: Pairing): Promise<Assistant | null> {
  const res = await request(p, '/api/companion/assistant');
  const data = await json<{ assistant: Assistant | null }>(res);
  return data.assistant ?? null;
}

/**
 * Update (creating it if absent) the owner's assistant. Only the provided
 * fields are sent — omitted keys are left unchanged server-side. Mirrors
 * {@link renameSession}'s PATCH-form pattern. Returns the updated assistant.
 */
export async function updateAssistant(
  p: Pairing,
  fields: {
    name?: string;
    user_name?: string;
    personality?: string;
    greeting?: string;
    model?: string;
    timezone?: string;
  },
): Promise<Assistant> {
  // Build the form body from only the keys the caller actually provided so
  // omitted fields stay untouched on the server.
  const provided = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v != null),
  ) as Record<string, string>;
  const res = await request(p, '/api/companion/assistant', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(provided),
  });
  const data = await json<{ assistant: Assistant }>(res);
  return data.assistant;
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

// ---------------------------------------------------------------------------
// Web search (stock /api/search endpoints).
//
// A one-shot lookup: POST a query, get back a `context` blob (the synthesized
// summary the LLM would otherwise consume) plus the `sources` it drew from.
// Reuses WebSource for sources since the shape matches ({url, title}).
// ---------------------------------------------------------------------------

export interface SearchProvider {
  id: string;
  label: string;
  available: boolean;
}

export interface SearchResult {
  context: string;
  sources: WebSource[];
  error?: string;
}

/** The web-search backends the server has configured (some may be unavailable). */
export async function listSearchProviders(p: Pairing): Promise<SearchProvider[]> {
  const res = await request(p, '/api/search/providers');
  const data = await json<SearchProvider[] | { providers: SearchProvider[] }>(res);
  return Array.isArray(data) ? data : (data.providers ?? []);
}

/**
 * Run a one-shot web search. The route accepts a form body; `time_filter` is
 * optional (e.g. 'day'/'week'/'month'/'year' — omit to let the server decide).
 * The server may return a 200 with an `error` field set rather than a non-2xx,
 * so the caller should surface `error` even on success.
 */
export async function webSearch(
  p: Pairing,
  query: string,
  timeFilter?: string,
): Promise<SearchResult> {
  const fields: Record<string, string> = { query };
  if (timeFilter) fields.time_filter = timeFilter;
  const res = await request(p, '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(fields),
  });
  const data = await json<Partial<SearchResult>>(res);
  return { context: data.context ?? '', sources: data.sources ?? [], error: data.error };
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

/**
 * Build the citation footer for a reloaded message from its persisted metadata.
 * The live stream delivers these lists as `*_sources` / `memories_used` SSE
 * events; on history reload the server returns the same lists under
 * `message.metadata`, keyed slightly differently — map them to ChatSources so
 * reopened conversations show the same Sources block as live ones. Returns
 * undefined when there are no citations to show.
 */
export function sourcesFromMetadata(metadata: ChatMessage['metadata']): ChatSources | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const out: ChatSources = {};
  if (Array.isArray(metadata.web_sources)) out.web = metadata.web_sources as WebSource[];
  if (Array.isArray(metadata.rag_sources)) out.rag = metadata.rag_sources as RagSource[];
  if (Array.isArray(metadata.research_sources)) out.research = metadata.research_sources as ResearchSource[];
  if (Array.isArray(metadata.memories_used)) out.memories = metadata.memories_used as MemoryUsed[];
  return out.web || out.rag || out.research || out.memories ? out : undefined;
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
  // forever, stranding the composer. We abort after the connect deadline and clear
  // the timer the moment response headers arrive, so an established stream is never
  // cut off mid-generation (long replies are expected and must not be truncated).
  //
  // Web search, research, and agent runs do their work BEFORE the first byte —
  // the server finishes context-building (live web search, RAG, etc.) and only
  // then returns the stream — so the connect phase legitimately takes much longer
  // than a plain chat. Give those a wider window so a slow search isn't mistaken
  // for an unreachable server and falsely aborted.
  const connectTimeoutMs =
    args.useWeb || args.useResearch || args.mode === 'agent' ? 45000 : TIMEOUT_MS;
  let connected = false;
  let connectTimedOut = false;
  const connectTimer = setTimeout(() => {
    if (connected) return;
    connectTimedOut = true;
    controller.abort();
  }, connectTimeoutMs);

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
      onUnauthorized?.();
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

// ---------------------------------------------------------------------------
// Deep Research launcher (companion bridge /api/companion/research/*).
//
// A run is a server-side background task: you start it, watch its progress over
// SSE, then read the finished report. Everything is scoped to the paired token's
// owner by the bridge, so we only ever see/control our own runs.
// ---------------------------------------------------------------------------

/** A research run the server reports as currently running, for this owner. */
export interface ResearchActiveRun {
  session_id: string;
  query: string;
  status: string;
  progress: Record<string, unknown>;
  started_at: number;
}

/**
 * One SSE frame from a run's progress stream. The server merges the run's
 * progress dict with a `status`, and sends a final frame with `final: true`
 * (and `error` on failure). Progress keys vary by server version, so this is
 * intentionally open — the UI reads known fields defensively.
 */
export interface ResearchProgressEvent {
  status: string;
  final?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface ResearchResult {
  result: string;
  sources: ResearchSource[];
  query: string;
  status: string;
}

export interface StartResearchInput {
  query: string;
  /** Use a specific endpoint+model (from the chat picker); omit to let the server resolve. */
  endpointId?: string;
  model?: string;
  /** 0 = Auto (server decides, capped at 20). */
  maxRounds?: number;
  maxTime?: number;
  category?: string;
}

/** Launch a research run. Body is JSON (the server route takes a model, not a form). */
export async function startResearch(
  p: Pairing,
  input: StartResearchInput,
): Promise<{ session_id: string; status: string; query: string }> {
  const body: Record<string, unknown> = { query: input.query };
  if (input.endpointId) body.endpoint_id = input.endpointId;
  if (input.model) body.model = input.model;
  if (input.maxRounds != null) body.max_rounds = input.maxRounds;
  if (input.maxTime != null) body.max_time = input.maxTime;
  if (input.category) body.category = input.category;
  const res = await request(p, '/api/companion/research/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return json(res);
}

/** The caller's own currently-running research runs (e.g. to resume watching one). */
export async function listActiveResearch(p: Pairing): Promise<ResearchActiveRun[]> {
  const res = await request(p, '/api/companion/research/active');
  const data = await json<{ active: ResearchActiveRun[] }>(res);
  return data.active ?? [];
}

/** Cancel a run. Best-effort: the stream will emit a final `cancelled` frame. */
export async function cancelResearch(p: Pairing, sid: string): Promise<void> {
  await request(p, `/api/companion/research/cancel/${encodeURIComponent(sid)}`, {
    method: 'POST',
  }).catch(() => {});
}

/** Read a run's report + sources (does not clear it server-side). */
export async function getResearchResult(p: Pairing, sid: string): Promise<ResearchResult> {
  const res = await request(p, `/api/companion/research/result/${encodeURIComponent(sid)}`, {
    method: 'POST',
  });
  return json<ResearchResult>(res);
}

export interface ResearchStreamHandlers {
  /** A progress frame while the run is still running. */
  onProgress: (evt: ResearchProgressEvent) => void;
  /** The run left `running` — status is `done`, `error`, `cancelled`, or `not_found`. */
  onDone: (evt: ResearchProgressEvent) => void;
  onError: (err: ApiError) => void;
}

/**
 * Stream a run's progress over SSE (GET, unlike chat's POST stream). Returns an
 * abort function. Mirrors the framing of {@link streamChat}: `data:` lines,
 * blank-line-separated frames, connect-phase timeout that's cleared once the
 * stream is established so a long run is never cut off.
 */
export function streamResearch(
  p: Pairing,
  sid: string,
  handlers: ResearchStreamHandlers,
): () => void {
  const controller = new AbortController();
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
      res = await expoFetch(`${baseUrl(p)}/api/companion/research/stream/${encodeURIComponent(sid)}`, {
        method: 'GET',
        headers: { ...authHeaders(p), Accept: 'text/event-stream' },
        signal: controller.signal,
      });
    } catch {
      clearTimeout(connectTimer);
      if (controller.signal.aborted && !connectTimedOut) return;
      handlers.onError(
        new ApiError(
          connectTimedOut ? 'Odysseus didn’t respond in time.' : 'Lost connection to Odysseus.',
          'network',
        ),
      );
      return;
    }
    connected = true;
    clearTimeout(connectTimer);

    if (res.status === 401) {
      handlers.onError(new ApiError('Token rejected. Re-pair from your server.', 'unauthorized', 401));
      return;
    }
    if (!res.ok || !res.body) {
      handlers.onError(new ApiError(`Server responded ${res.status}.`, 'server', res.status));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of frame.split('\n')) {
            const t = line.trimStart();
            if (t.startsWith(':') || !t.startsWith('data:')) continue;
            const payload = t.slice(5).trim();
            if (!payload) continue;
            try {
              const evt = JSON.parse(payload) as ResearchProgressEvent;
              // The run is finished the moment it leaves `running` (or sends the
              // final flag). Everything else is live progress.
              if (evt.final || (evt.status && evt.status !== 'running')) handlers.onDone(evt);
              else handlers.onProgress(evt);
            } catch {
              /* non-JSON data line — ignore */
            }
          }
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        handlers.onError(new ApiError('Research stream interrupted.', 'network'));
      }
    } finally {
      reader.releaseLock();
    }
  })();

  return () => controller.abort();
}

// ---------------------------------------------------------------------------
// Model Compare (companion bridge /api/companion/compare/*).
//
// The phone runs the two streams itself (two streamChat calls against two
// sessions) — the server never orchestrates the run. These endpoints only
// persist the OUTCOME: a recorded comparison + its winner vote, scoped to the
// paired token's owner, so past comparisons survive across app launches.
// ---------------------------------------------------------------------------

/** One persisted comparison: the prompt, the two models pitted, and the vote. */
export interface CompareRecord {
  id: string;
  prompt: string;
  model_a: string;
  model_b: string;
  winner: 'a' | 'b' | 'tie' | null;
  is_blind: boolean;
  voted_at: string | null;
  created_at: string | null;
}

/** List the owner's past comparisons (newest-first per the server). */
export async function listCompareHistory(p: Pairing): Promise<CompareRecord[]> {
  const res = await request(p, '/api/companion/compare/history');
  const items = await listFrom<CompareRecord>(res, 'items');
  // Coerce ids to string so list keys / route params match regardless of the
  // server sending numeric ids.
  return items.map((c) => ({ ...c, id: String(c.id) }));
}

/** Record a finished comparison + its winner vote. Returns the new entry's id. */
export async function recordComparison(
  p: Pairing,
  input: { prompt: string; modelA: string; modelB: string; winner: 'a' | 'b' | 'tie'; isBlind: boolean },
): Promise<{ id: string }> {
  const res = await request(p, '/api/companion/compare/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      prompt: input.prompt,
      model_a: input.modelA,
      model_b: input.modelB,
      winner: input.winner,
      is_blind: input.isBlind ? 'true' : 'false',
    }),
  });
  const data = await json<{ id: string | number; status: string }>(res);
  return { id: String(data.id) };
}

export async function deleteComparison(p: Pairing, id: string): Promise<void> {
  const res = await request(p, `/api/companion/compare/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
}

// ---------------------------------------------------------------------------
// Calendar (companion bridge /api/companion/calendars + /events).
//
// An agenda view over the owner's calendars: list calendars (for the picker +
// color dots), list events in a time window, create an event, delete one. All
// scoped to the paired token's owner by the bridge.
// ---------------------------------------------------------------------------

/** One calendar the owner can file events under (the create picker lists these). */
export interface CalendarCal {
  id: string;
  name: string;
  color: string;
  source: string;
}

/** A single event. `dtstart`/`dtend` are ISO strings (null when absent). */
export interface CalendarEvent {
  uid: string;
  calendar_id: string;
  summary: string;
  description: string;
  location: string;
  dtstart: string | null;
  dtend: string | null;
  all_day: boolean;
  rrule: string;
  status: string;
  importance: string;
  event_type: string | null;
  color: string | null;
}

/** The owner's calendars (for the create picker + per-event color dots). */
export async function listCalendars(p: Pairing): Promise<CalendarCal[]> {
  const res = await request(p, '/api/companion/calendars');
  return listFrom<CalendarCal>(res, 'calendars');
}

/** Events in an optional [start, end] window (omit either to widen the range). */
export async function listEvents(
  p: Pairing,
  range: { start?: string; end?: string },
): Promise<CalendarEvent[]> {
  // Build the query string only for params the caller actually provided.
  const qs = form(
    Object.fromEntries(
      Object.entries({ start: range.start, end: range.end }).filter(([, v]) => v != null),
    ) as Record<string, string>,
  );
  const res = await request(p, `/api/companion/events${qs ? `?${qs}` : ''}`);
  return listFrom<CalendarEvent>(res, 'events');
}

/** Create an event under a calendar. Returns its uid + status. */
export async function createEvent(
  p: Pairing,
  input: {
    calendarId: string;
    summary: string;
    dtstart: string;
    dtend: string;
    description?: string;
    location?: string;
    allDay?: boolean;
  },
): Promise<{ uid: string; status: string }> {
  const fields: Record<string, string> = {
    calendar_id: input.calendarId,
    summary: input.summary,
    dtstart: input.dtstart,
    dtend: input.dtend,
    all_day: input.allDay ? 'true' : 'false',
  };
  if (input.description != null) fields.description = input.description;
  if (input.location != null) fields.location = input.location;
  const res = await request(p, '/api/companion/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(fields),
  });
  return json<{ uid: string; status: string }>(res);
}

export async function deleteEvent(p: Pairing, uid: string): Promise<void> {
  const res = await request(p, `/api/companion/events/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new ApiError(`Server responded ${res.status}.`, 'server', res.status);
}

// ---------------------------------------------------------------------------
// Email (companion bridge /api/companion/email/*).
//
// Browse one of the owner's configured mail accounts: list accounts, list a
// folder's headers, read a single message's body, send a new message. All
// scoped to the paired token's owner by the bridge. The mailbox itself lives
// behind IMAP/SMTP, so messages/message can return a 502 when it's unreachable
// — the UI surfaces that as a friendly "try again" rather than a crash.
// ---------------------------------------------------------------------------

/** One configured mail account (the account switcher lists these). */
export interface EmailAccount {
  id: string;
  name: string;
  from_address: string;
  enabled: boolean;
  is_default: boolean;
}

/** A message header in a folder listing (body fetched separately). */
export interface EmailHeader {
  uid: string;
  subject: string;
  from: string;
  date: string | null;
}

/** A single message's full detail (the reader view). */
export interface EmailMessage {
  uid: string;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  body: string;
}

/** The owner's configured mail accounts (for the account switcher). */
export async function listEmailAccounts(p: Pairing): Promise<EmailAccount[]> {
  const res = await request(p, '/api/companion/email/accounts');
  return listFrom<EmailAccount>(res, 'accounts');
}

/** Headers in a folder (defaults: INBOX, newest 30) for one account. */
export async function listEmailMessages(
  p: Pairing,
  { accountId, folder = 'INBOX', limit = 30 }: { accountId: string; folder?: string; limit?: number },
): Promise<EmailHeader[]> {
  const qs = form({ account_id: accountId, folder, limit: String(limit) });
  const res = await request(p, `/api/companion/email/messages?${qs}`);
  return listFrom<EmailHeader>(res, 'messages');
}

/** Fetch one message's full body + headers. */
export async function readEmailMessage(
  p: Pairing,
  { accountId, uid, folder = 'INBOX' }: { accountId: string; uid: string; folder?: string },
): Promise<EmailMessage> {
  const qs = form({ account_id: accountId, folder });
  const res = await request(p, `/api/companion/email/message/${encodeURIComponent(uid)}?${qs}`);
  return json<EmailMessage>(res);
}

/** Send a message from an account. `to` is comma-separated. Returns the recipients. */
export async function sendEmail(
  p: Pairing,
  { accountId, to, subject, body }: { accountId: string; to: string; subject: string; body: string },
): Promise<{ status: string; to: string[] }> {
  const res = await request(p, '/api/companion/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ account_id: accountId, to, subject, body }),
  });
  return json<{ status: string; to: string[] }>(res);
}
