import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { Notes, AppError } from './notes';
import { SCOPES, type OAuth } from './oauth';
import { isNoteToken } from '../../packages/core/src/note';

export async function accountMcpRequest(
  request: Request,
  oauth: OAuth,
  notes: Notes,
) {
  const raw = request.headers
    .get('authorization')
    ?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1];
  const access = raw ? await oauth.access(raw) : undefined;
  const metadata = `${oauth.origin}/.well-known/oauth-protected-resource/mcp/account`;
  if (!access)
    return new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${metadata}", scope="${SCOPES.join(' ')}"`,
      },
    });
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  const server = new McpServer({ name: 'memo-account', version: '1.0.0' });
  const reply = async (
    action: () => Promise<Record<string, unknown>>,
    { structured = false } = {},
  ) => {
    try {
      // Recheck revocation on tools/call as well as the transport request.
      if (!(await oauth.access(raw!))) throw new AppError('unauthorized', 401);
      const value = await action();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(value) }],
        ...(structured ? { structuredContent: value } : {}),
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text:
              error instanceof AppError
                ? error.code
                : error instanceof Error && error.message === 'note_too_large'
                  ? 'note_too_large'
                  : 'request_failed',
          },
        ],
      };
    }
  };
  const token = z.string().refine(isNoteToken);
  const page = {
    cursor: token.optional(),
    limit: z.number().int().min(1).max(20).default(20),
  };
  const urls = (token: string) => ({
    token,
    url: `${oauth.origin}/${token}`,
    mcp_url: `${oauth.origin}/mcp/${token}`,
  });
  const batch = async (
    cursor: string | undefined,
    limit: number,
    order: 'list' | 'token' = 'token',
  ) => {
    const list = await notes.list(access.account, {
      after: cursor,
      limit: limit + 1,
      order,
    });
    const selected = list.slice(0, limit);
    return {
      selected,
      next_cursor: list.length > limit ? selected.at(-1)!.token : null,
    };
  };
  if (access.scopes.includes('memo:read')) {
    server.registerTool(
      'list_notes',
      {
        description:
          'List notes currently in your account list. Use order "list" to see the saved order before moving notes. Keep the same order while following next_cursor until null.',
        inputSchema: z
          .object({
            ...page,
            order: z.enum(['token', 'list']).default('token'),
          })
          .strict(),
        annotations: { readOnlyHint: true },
      },
      (args) =>
        reply(async () => {
          const { selected, next_cursor } = await batch(
            args.cursor,
            args.limit,
            args.order,
          );
          return {
            notes: selected.map((n) => ({ ...n, ...urls(n.token) })),
            next_cursor,
          };
        }),
    );
    server.registerTool(
      'search_notes',
      {
        description:
          'Search titles and Markdown bodies with a case-insensitive literal substring. Scans up to limit notes per call. Follow next_cursor even if this page has no matches.',
        inputSchema: z
          .object({ ...page, query: z.string().trim().min(1).max(200) })
          .strict(),
        annotations: { readOnlyHint: true },
      },
      (args) =>
        reply(async () => {
          const { selected, next_cursor } = await batch(
              args.cursor,
              args.limit,
            ),
            query = args.query.toLocaleLowerCase();
          const results = [];
          for (const item of selected) {
            try {
              await notes.requireMember(access.account, item.token);
              const note = await notes.read(item.token);
              if (
                item.title.toLocaleLowerCase().includes(query) ||
                note.content.toLocaleLowerCase().includes(query)
              )
                results.push({ ...item, ...urls(item.token) });
            } catch (error) {
              if (!(error instanceof AppError && error.code === 'not_found'))
                throw error;
            }
          }
          return { notes: results, next_cursor };
        }),
    );
    server.registerTool(
      'read_note',
      {
        description:
          'Read a note currently in your account list and its version.',
        inputSchema: z.object({ token }).strict(),
        outputSchema: z.object({
          token,
          url: z.url(),
          mcp_url: z.url(),
          content: z.string(),
          version: z.number().int().positive(),
        }),
        annotations: { readOnlyHint: true },
      },
      (args) =>
        reply(
          async () => {
            await notes.requireMember(access.account, args.token);
            const note = await notes.read(args.token);
            return {
              ...urls(args.token),
              content: note.content,
              version: note.version,
            };
          },
          { structured: true },
        ),
    );
  }
  if (access.scopes.includes('memo:create'))
    server.registerTool(
      'create_note',
      {
        description:
          'Create a new note and add it to your list atomically. Return its URL. Retry identical requests with the same operation_id within 24 hours.',
        inputSchema: z
          .object({ content: z.string(), operation_id: z.string().uuid() })
          .strict(),
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (args) =>
        reply(async () => {
          const created = await notes.createInAccount(
            access.account,
            args.content,
            args.operation_id,
          );
          return { ...urls(created.token), version: created.version };
        }),
    );
  if (access.scopes.includes('memo:reorder'))
    server.registerTool(
      'move_note',
      {
        description:
          'Move a note in your account list immediately before another note, or to the end when before_token is null. Read list_notes with order "list" to see the current order.',
        inputSchema: z
          .object({ token, before_token: token.nullable() })
          .strict(),
        annotations: { destructiveHint: false },
        _meta: {
          securitySchemes: [{ type: 'oauth2', scopes: ['memo:reorder'] }],
        },
      },
      ({ token, before_token }) =>
        reply(async () => {
          await notes.moveInList(access.account, token, before_token);
          return { ok: true };
        }),
    );
  if (access.scopes.includes('memo:write'))
    for (const kind of ['write', 'append'] as const)
      server.registerTool(
        `${kind}_note`,
        {
          description:
            kind === 'write'
              ? 'Replace a note in your list. Read first and pass expected_version; on version_conflict read again. Retry identical operations with the same operation_id within 24 hours.'
              : 'Append exact text to a note in your list without adding newlines. Retry identical operations with the same operation_id within 24 hours.',
          inputSchema: z
            .object({
              token,
              content: z.string(),
              operation_id: z.string().uuid(),
              ...(kind === 'write'
                ? { expected_version: z.number().int().positive() }
                : {}),
            })
            .strict(),
          annotations: { idempotentHint: true },
        },
        (args) =>
          reply(async () => {
            await notes.requireMember(access.account, args.token);
            return notes.mutate(
              args.token,
              args.operation_id,
              kind,
              args.content,
              'expected_version' in args
                ? (args.expected_version as number)
                : undefined,
            );
          }),
      );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers,
    });
  } finally {
    await server.close();
  }
}
