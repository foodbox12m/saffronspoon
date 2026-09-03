/**
 * MCP server (stdio transport).
 *
 * Exposes the same eight tools to any MCP client — Claude Desktop, Cursor, or
 * the owner's own tooling — under the same policy gate the WhatsApp agent uses.
 * There is no second, looser code path: `callTool` is the only entry.
 *
 * Auth: an MCP client is a local trusted operator, so it authenticates by
 * setting MCP_ROLE (staff|admin|agent) and MCP_SUBJECT in its env. Default is
 * `staff`, which can read orders and verify payments but not rewrite the menu.
 *
 * Run standalone:  npm run mcp
 * Claude Desktop config:
 *   { "mcpServers": { "saffronspoon": {
 *       "command": "node",
 *       "args": ["/abs/path/saffronspoon/server/dist/mcp/server.js"],
 *       "env": { "MCP_ROLE": "staff", "MCP_SUBJECT": "staff:owner", "JWT_SECRET": "…" } } } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { assertConfigValid } from '../config.js';
import { assertMenuValid } from '../domain/menu.js';
import { initialiseKnowledgeBase } from '../kb/ingest-ubereats.js';
import { scopesForRole, type Principal, type Role } from '../security/index.js';
import { callTool, describeTools } from './tools.js';

function principalFromEnv(): Principal {
  const requested = (process.env.MCP_ROLE ?? 'staff').toLowerCase();
  const role: Role = (['agent', 'staff', 'admin', 'customer', 'service'] as const).includes(requested as Role)
    ? (requested as Role)
    : 'staff';

  const subject = process.env.MCP_SUBJECT?.trim() || `mcp:${role}`;

  return {
    subject,
    role,
    scopes: scopesForRole(role),
    displayName: process.env.MCP_DISPLAY_NAME?.trim() || subject,
  };
}

export async function startMcpServer(): Promise<void> {
  assertConfigValid();
  assertMenuValid();
  const kb = await initialiseKnowledgeBase();

  const principal = principalFromEnv();

  const server = new Server(
    { name: 'saffronspoon-catering', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: describeTools(principal).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: 'object' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(request.params.name, request.params.arguments ?? {}, principal);

    if (!result.ok) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: result.error?.code, message: result.error?.message }, null, 2),
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
    };
  });

  // stderr, never stdout — stdout is the MCP protocol channel.
  process.stderr.write(
    `[mcp] saffron & spoon ready as ${principal.role} (${principal.subject}). ` +
      `${describeTools(principal).length} tool(s). KB: ${kb.seeded} seed + ${kb.ingested} ingested.\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start when this file is the process entrypoint.
const isEntrypoint = process.argv[1]?.includes('mcp/server');
if (isEntrypoint) {
  startMcpServer().catch((error: unknown) => {
    process.stderr.write(`[mcp] failed to start: ${String(error)}\n`);
    process.exit(1);
  });
}
