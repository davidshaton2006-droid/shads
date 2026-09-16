const fs = require('fs');
const path = require('path');

// Аналог get_methodology у LidFly: агент обязан прочитать плейбук перед тем, как предлагать
// структуру кампании, стратегию ставок или список минус-слов. Это не просто документация —
// правила из плейбука (раздел 9 в каждом файле) должны применяться при формировании
// write-действий в src/mcp/tools/yandex.js и vk.js.

const SKILLS_DIR = path.join(__dirname, '..', '..', '..', 'skills');

const PLAYBOOKS = {
  yandex_direct: 'yandex-direct-playbook.md',
  vk_ads: 'vk-ads-playbook.md',
};

function getPlaybook(provider) {
  const file = PLAYBOOKS[provider];
  if (!file) throw new Error(`Нет плейбука для провайдера: ${provider}`);
  return fs.readFileSync(path.join(SKILLS_DIR, file), 'utf8');
}

const tools = [
  {
    name: 'get_playbook',
    description:
      'Читает проверенный плейбук по настройке рекламы (структура кампаний, семантика/минус-слова, ' +
      'стратегии ставок, чек-лист, правила автономной работы). ОБЯЗАТЕЛЬНО вызывать перед любым ' +
      'предложением по структуре кампании, стратегии ставок или списку минус-слов для этого провайдера.',
    inputSchema: {
      type: 'object',
      properties: { provider: { type: 'string', enum: ['yandex_direct', 'vk_ads'] } },
      required: ['provider'],
    },
    riskLevel: 'read',
    handler: async ({ provider }) => ({ content: [{ type: 'text', text: getPlaybook(provider) }] }),
  },
];

module.exports = { tools, getPlaybook };
