const playbooks = require('./playbooks');
const yandex = require('./yandex');
const vk = require('./vk');

// Единый реестр MCP-инструментов. riskLevel: 'read' — безопасно вызывать без ограничений;
// 'write' — всегда проходит через guardedWrite/preflight внутри самого хендлера
// (см. src/mcp/tools/writeHelper.js), поэтому сервер не обязан сам блокировать write-вызовы,
// но помечает их явно для логирования и для клиента (Claude) в описании тула.
const allTools = [...playbooks.tools, ...yandex.tools, ...vk.tools];

function getAllTools() {
  return allTools;
}

function getTool(name) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Неизвестный инструмент: ${name}`);
  return tool;
}

module.exports = { getAllTools, getTool };
