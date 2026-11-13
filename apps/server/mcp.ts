import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { Notes, AppError } from './notes';
export async function mcpRequest(
  request: Request,
  token: string,
  notes: Notes,
): Promise<Response> {
  await notes.read(token);
  const server = new McpServer({ name: 'memo', version: '1.0.0' });
  const reply = async (action: () => Promise<unknown>) => {
    try {
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(await action()) },
        ],
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
  server.registerTool(
    'read_note',
    {
      description:
        'Read this note and its version. Only the endpoint URL selects the note.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    () =>
      reply(async () => {
        const note = await notes.read(token);
        return { content: note.content, version: note.version };
      }),
  );
  server.registerTool(
    'write_note',
    {
      description:
        'Replace this note. Read first and provide expected_version. On version_conflict read again. Retry identical operations with the same operation_id within 24 hours.',
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
        notes.mutate(token, operation_id, 'write', content, expected_version),
      ),
  );
  server.registerTool(
    'append_note',
    {
      description:
        'Append exact text atomically without adding a newline. Retry identical operations with the same operation_id within 24 hours.',
      inputSchema: z
        .object({ content: z.string(), operation_id: z.string().uuid() })
        .strict(),
    },
    ({ content, operation_id }) =>
      reply(() => notes.mutate(token, operation_id, 'append', content)),
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
