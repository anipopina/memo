import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { isNoteToken, MAX_NOTE_BYTES } from '../../packages/core/src/note';
import { MemoryNoteStore } from './store';

export function createMcpApp(store: MemoryNoteStore, origin: string): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    if (c.req.header('host') !== new URL(origin).host)
      return c.json({ error: 'invalid_host' }, 403);
    const requestOrigin = c.req.header('origin');
    if (requestOrigin && requestOrigin !== origin)
      return c.json({ error: 'invalid_origin' }, 403);
    await next();
  });
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_NOTE_BYTES * 6 + 8192,
      onError: (c) => c.json({ error: 'request_too_large' }, 413),
    }),
  );
  app.all('/mcp/:token', async (c) => {
    const token = c.req.param('token');
    if (!isNoteToken(token)) return c.json({ error: 'not_found' }, 404);
    try {
      store.read(token);
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST');
      return c.json({ error: 'method_not_allowed' }, 405);
    }
    const server = new McpServer({ name: 'memo-spike', version: '0.1.0' });
    const reply = (action: () => unknown) => {
      try {
        const data = action();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data) }],
        };
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'request_failed';
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
        };
      }
    };
    server.registerTool(
      'read_note',
      {
        description:
          'Read this note and its version. The note is selected only by the endpoint URL.',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true },
      },
      () => reply(() => store.read(token)),
    );
    server.registerTool(
      'write_note',
      {
        description:
          'Replace this note. Read first, provide expected_version. On version_conflict read again. Reuse operation_id only for an identical retry.',
        inputSchema: z
          .object({
            content: z.string(),
            expected_version: z.number().int().positive(),
            operation_id: z.string().uuid(),
          })
          .strict(),
      },
      ({ content, expected_version, operation_id }) =>
        reply(() =>
          store.mutate(token, operation_id, 'write', content, expected_version),
        ),
    );
    server.registerTool(
      'append_note',
      {
        description:
          'Append exact text atomically, without adding a newline. Reuse operation_id for an identical retry to avoid duplicate appends.',
        inputSchema: z
          .object({ content: z.string(), operation_id: z.string().uuid() })
          .strict(),
      },
      ({ content, operation_id }) =>
        reply(() => store.mutate(token, operation_id, 'append', content)),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(c.req.raw);
      // Buffer the bounded JSON response before disposing the per-request server.
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      await server.close();
    }
  });
  app.onError((_error, c) => c.json({ error: 'request_failed' }, 500));
  return app;
}
