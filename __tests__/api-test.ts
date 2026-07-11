/**
 * Layer 3 — wire contract. Runs against a mocked transport (no device, no real
 * server), so it's fast and deterministic, but it pins the exact bytes we put on
 * the wire and the exact shapes we accept back. This is the guard against the
 * Odysseus server quietly changing a route/payload and the app breaking silently.
 *
 * Two transports are mocked:
 *   - global `fetch`     — used by api.ts `request()` for normal JSON/form calls
 *   - `expo/fetch`       — used by api.ts for the SSE streaming endpoints
 */
import * as ExpoFS from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

import {
  ApiError,
  ping,
  listModels,
  createSession,
  listNotes,
  listPresets,
  flattenModels,
  sourcesFromMetadata,
  streamChat,
  upload,
  setUnauthorizedHandler,
  type ModelEndpoint,
} from '@/lib/api';
import { type Pairing } from '@/lib/pairing';

jest.mock('@/lib/log', () => ({ dlog: () => {} }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
// upload() uses expo-file-system's native multipart uploader (File(...).upload).
// Mock the File class so a shared `upload` jest.fn records the call and drives the
// result — this exercises the REAL upload() code path (unlike stubbing FormData).
jest.mock('expo-file-system', () => {
  const upload = jest.fn();
  return {
    __esModule: true,
    UploadType: { MULTIPART: 1, BINARY_CONTENT: 0 },
    File: jest.fn(() => ({ upload })),
    _upload: upload,
  };
});

const P: Pairing = { v: 1, host: '192.168.1.50', port: 7000, token: 'ody_abcdefgh' };
const BASE = 'http://192.168.1.50:7000';
const mockExpoFetch = expoFetch as jest.MockedFunction<typeof expoFetch>;

/** Build a minimal Response-like object for the global-fetch mock. */
function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200;
  return {
    status,
    ok: init.ok ?? (status >= 200 && status < 300),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  setUnauthorizedHandler(null);
  global.fetch = jest.fn();
});

describe('request building', () => {
  test('ping hits the companion ping route with the bearer token', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ ok: true, name: 'odysseus', version: '1.2.3' }),
    );

    const out = await ping(P);

    expect(out).toEqual({ ok: true, name: 'odysseus', version: '1.2.3' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${BASE}/api/companion/ping`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer ody_abcdefgh');
  });

  test('createSession posts a urlencoded form with skip_validation', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ id: 's1', name: 'Mobile chat', model: 'gpt', rag: false, archived: false }),
    );

    await createSession(
      P,
      { endpoint_id: 'e1', endpoint_url: 'http://x', model: 'gpt-4o', label: 'gpt-4o' },
      'My chat',
    );

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${BASE}/api/session`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // Form body is url-encoded key=value&... — assert the contract fields are present.
    const body = init.body as string;
    expect(body).toContain('name=My%20chat');
    expect(body).toContain('endpoint_url=http%3A%2F%2Fx');
    expect(body).toContain('model=gpt-4o');
    expect(body).toContain('endpoint_id=e1');
    expect(body).toContain('skip_validation=true');
  });
});

describe('response tolerance', () => {
  test('listModels unwraps { endpoints }', async () => {
    const endpoints: ModelEndpoint[] = [
      { endpoint_id: 'e1', name: 'Local', endpoint_url: 'http://x', models: ['a'], supports_tools: null },
    ];
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ endpoints }));
    expect(await listModels(P)).toEqual(endpoints);
  });

  test('listModels returns [] when the key is absent', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));
    expect(await listModels(P)).toEqual([]);
  });

  test.each([
    ['a bare array', [{ id: 'n1' }]],
    ['an { items } wrapper', { items: [{ id: 'n1' }] }],
    ['a { notes } wrapper', { notes: [{ id: 'n1' }] }],
  ])('listNotes tolerates %s', async (_label, payload) => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(payload));
    expect(await listNotes(P)).toEqual([{ id: 'n1' }]);
  });

  test('listNotes returns [] for an unexpected shape', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ nope: 1 }));
    expect(await listNotes(P)).toEqual([]);
  });

  test('listPresets keeps only preset-shaped object values, dropping arrays/scalars', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        p1: { name: 'Coder', system_prompt: 'be terse', temperature: 0.2 },
        p2: { name: 'Writer' },
        user_templates: [{ id: 'ignored' }], // array sibling — must be dropped
        version: '3', // scalar sibling — must be dropped
        empty: { foo: 'bar' }, // object but not preset-shaped — dropped
      }),
    );
    const presets = await listPresets(P);
    expect(presets.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(presets.find((p) => p.id === 'p1')).toMatchObject({ name: 'Coder', temperature: 0.2 });
  });
});

describe('auth / error mapping', () => {
  test('a 401 fires the unauthorized handler and throws an unauthorized ApiError', async () => {
    const onUnauth = jest.fn();
    setUnauthorizedHandler(onUnauth);
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(null, { status: 401, ok: false }));

    await expect(ping(P)).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  test('a thrown transport error maps to a network ApiError', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await expect(ping(P)).rejects.toMatchObject({ kind: 'network' });
    await expect(ping(P)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('pure helpers', () => {
  test('flattenModels qualifies duplicate model names with the endpoint name', () => {
    const endpoints: ModelEndpoint[] = [
      { endpoint_id: 'e1', name: 'Local', endpoint_url: 'http://a', models: ['llama', 'solo'], supports_tools: null },
      { endpoint_id: 'e2', name: 'Cloud', endpoint_url: 'http://b', models: ['llama'], supports_tools: null },
    ];
    const choices = flattenModels(endpoints);
    const labels = choices.map((c) => c.label).sort();
    // `llama` is served by two endpoints → both labels are qualified; `solo` stays bare.
    expect(labels).toEqual(['llama · Cloud', 'llama · Local', 'solo']);
  });

  test('sourcesFromMetadata maps persisted keys and returns undefined when empty', () => {
    expect(sourcesFromMetadata(undefined)).toBeUndefined();
    expect(sourcesFromMetadata({})).toBeUndefined();
    const mapped = sourcesFromMetadata({
      web_sources: [{ url: 'u', title: 't' }],
      memories_used: [{ text: 'm' }],
    });
    expect(mapped).toEqual({
      web: [{ url: 'u', title: 't' }],
      memories: [{ text: 'm' }],
    });
  });
});

// ---------------------------------------------------------------------------
// SSE stream parser — the trickiest contract surface. We feed raw `data:` frames
// (split across chunk boundaries to mimic the network) and assert the parser
// accumulates deltas, skips reasoning tokens, routes source/error events, and
// fires onDone exactly once.
// ---------------------------------------------------------------------------

/** Build a fake streaming Response whose body yields the given UTF-8 chunks. */
function sseResponse(chunks: string[]): unknown {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    status: 200,
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined },
        releaseLock: () => {},
      }),
    },
  };
}

/** Run streamChat to completion, collecting what the handlers received. */
function runStream(chunks: string[]): Promise<{
  text: string;
  thinking: string;
  tools: { phase: string; tool: string; exitCode?: number }[];
  sources: unknown[];
  error: ApiError | null;
  doneCount: number;
}> {
  return new Promise((resolve) => {
    let text = '';
    let thinking = '';
    const tools: { phase: string; tool: string; exitCode?: number }[] = [];
    const sources: unknown[] = [];
    let error: ApiError | null = null;
    let doneCount = 0;
    mockExpoFetch.mockResolvedValue(sseResponse(chunks) as never);

    streamChat(
      P,
      { message: 'hi', session: 's1' },
      {
        onDelta: (t) => {
          text += t;
        },
        onThinking: (t) => {
          thinking += t;
        },
        onTool: (e) => {
          tools.push({ phase: e.phase, tool: e.tool, exitCode: e.exitCode });
        },
        onSources: (s) => {
          sources.push(s);
        },
        onError: (e) => {
          error = e;
          resolve({ text, thinking, tools, sources, error, doneCount });
        },
        onDone: () => {
          doneCount += 1;
          // Resolve on the next tick so a double-fire (the bug this guards) would
          // be observed as doneCount > 1 rather than racing the resolve.
          setImmediate(() => resolve({ text, thinking, tools, sources, error, doneCount }));
        },
      },
    );
  });
}

describe('streamChat SSE parsing', () => {
  test('accumulates deltas across chunk boundaries and finishes on [DONE]', async () => {
    const out = await runStream([
      'data: {"delta":"Hel"}\n\n',
      'data: {"delta":"lo"}\n', // frame split mid-stream
      '\ndata: {"delta":" world"}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(out.text).toBe('Hello world');
    expect(out.doneCount).toBe(1);
    expect(out.error).toBeNull();
  });

  test('surfaces reasoning tokens (thinking:true) separately from the answer', async () => {
    const out = await runStream([
      'data: {"delta":"reason","thinking":true}\n\n',
      'data: {"delta":"ing","thinking":true}\n\n',
      'data: {"delta":"answer"}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(out.text).toBe('answer');
    expect(out.thinking).toBe('reasoning');
  });

  test('routes tool_start / tool_output events with exit codes', async () => {
    const out = await runStream([
      'data: {"type":"tool_start","tool":"bash","command":"ls"}\n\n',
      'data: {"type":"tool_output","tool":"bash","output":"a b","exit_code":0}\n\n',
      'data: {"delta":"done"}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(out.tools).toEqual([
      { phase: 'start', tool: 'bash', exitCode: undefined },
      { phase: 'output', tool: 'bash', exitCode: 0 },
    ]);
  });

  test('routes web_sources events and ignores heartbeat comment lines', async () => {
    const out = await runStream([
      ': heartbeat\n\n',
      'data: {"type":"web_sources","data":[{"url":"u","title":"t"}]}\n\n',
      'data: {"delta":"x"}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(out.text).toBe('x');
    expect(out.sources).toEqual([{ web: [{ url: 'u', title: 't' }] }]);
  });

  test('surfaces an `event: error` frame as an ApiError', async () => {
    const out = await runStream(['event: error\ndata: {"error":"boom"}\n\n']);
    expect(out.error).toBeInstanceOf(ApiError);
    expect(out.error?.message).toBe('boom');
  });

  test('reports a stream that closes without [DONE] as a truncation error', async () => {
    const out = await runStream(['data: {"delta":"partial"}\n\n']); // no sentinel, stream ends
    expect(out.text).toBe('partial');
    expect(out.error).toBeInstanceOf(ApiError);
    expect(out.error?.kind).toBe('network');
  });
});

// ---------------------------------------------------------------------------
// Attachment upload + send. Pins the multipart contract (field name `files`, no
// hand-set Content-Type so the runtime adds the boundary, the companion route)
// and that chat passes the resulting ids through as a JSON-string form field.
// ---------------------------------------------------------------------------

describe('upload (native multipart via expo-file-system)', () => {
  // Shared handles to the mocked File class + its upload() fn (see jest.mock above).
  const FileMock = ExpoFS.File as unknown as jest.Mock;
  const uploadMock = (ExpoFS as unknown as { _upload: jest.Mock })._upload;

  test('streams the picked file to the companion route as multipart field `files`, returns the record', async () => {
    uploadMock.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ files: [{ id: 'f1', name: 'p.jpg', mime: 'image/jpeg', size: 10, width: 2, height: 3 }] }),
    });

    const out = await upload(P, { uri: 'file:///tmp/p.jpg', name: 'p.jpg', mimeType: 'image/jpeg' });
    expect(out).toEqual({ id: 'f1', name: 'p.jpg', mime: 'image/jpeg', size: 10, width: 2, height: 3 });

    // The local file uri is wrapped in expo-file-system's File.
    expect(FileMock).toHaveBeenCalledWith('file:///tmp/p.jpg');
    const [url, opts] = uploadMock.mock.calls[0];
    // Goes through the companion bridge (owner-attributed), NOT stock /api/upload.
    expect(url).toBe(`${BASE}/api/companion/upload`);
    expect(opts.uploadType).toBe(1); // UploadType.MULTIPART
    expect(opts.fieldName).toBe('files'); // server reads List[UploadFile] under "files"
    expect(opts.mimeType).toBe('image/jpeg');
    expect(opts.headers.Authorization).toBe('Bearer ody_abcdefgh');
  });

  test('throws a bad_response ApiError when the server returns no files', async () => {
    uploadMock.mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify({ files: [] }) });
    await expect(
      upload(P, { uri: 'file:///x', name: 'x', mimeType: 'image/png' }),
    ).rejects.toMatchObject({ kind: 'bad_response' });
  });

  test('a 401 from the upload fires the unauthorized handler and throws unauthorized', async () => {
    const onUnauth = jest.fn();
    setUnauthorizedHandler(onUnauth);
    uploadMock.mockResolvedValue({ status: 401, headers: {}, body: '' });
    await expect(
      upload(P, { uri: 'file:///x', name: 'x', mimeType: 'image/png' }),
    ).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  test('a transport failure maps to a network ApiError', async () => {
    uploadMock.mockRejectedValue(new Error('offline'));
    await expect(
      upload(P, { uri: 'file:///x', name: 'x', mimeType: 'image/png' }),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('streamChat attachments', () => {
  test('passes attachment ids as a JSON-encoded `attachments` form field', async () => {
    mockExpoFetch.mockResolvedValue(sseResponse(['data: [DONE]\n\n']) as never);
    await new Promise<void>((resolve) => {
      streamChat(
        P,
        { message: 'hi', session: 's1', attachmentIds: ['f1', 'f2'] },
        { onDelta: () => {}, onDone: () => resolve() },
      );
    });
    const [, init] = mockExpoFetch.mock.calls[0] as [string, { body: string }];
    expect(init.body).toContain(`attachments=${encodeURIComponent(JSON.stringify(['f1', 'f2']))}`);
  });

  test('omits the attachments field when there are none', async () => {
    mockExpoFetch.mockResolvedValue(sseResponse(['data: [DONE]\n\n']) as never);
    await new Promise<void>((resolve) => {
      streamChat(P, { message: 'hi', session: 's1' }, { onDelta: () => {}, onDone: () => resolve() });
    });
    const [, init] = mockExpoFetch.mock.calls[0] as [string, { body: string }];
    expect(init.body).not.toContain('attachments=');
  });
});
