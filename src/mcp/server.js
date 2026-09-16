require('dotenv').config();
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { getAllTools, getTool } = require('./tools/registry');

const server = new Server({ name: 'shads', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getAllTools().map(({ name, description, inputSchema, riskLevel }) => ({
    name,
    description: riskLevel === 'write' ? `[WRITE] ${description}` : description,
    inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = getTool(request.params.name);
  try {
    return await tool.handler(request.params.arguments ?? {});
  } catch (err) {
    return { content: [{ type: 'text', text: `Ошибка: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('SHADS MCP server failed to start:', err);
  process.exit(1);
});
