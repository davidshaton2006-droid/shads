// Демо-данные и поддельный "backend" для GitHub Pages (статический хостинг — реального
// Express/Supabase/API Директа/VK здесь нет и быть не может). mockApi() повторяет форму ответов
// реальных эндпоинтов src/routes/api.js, но читает/пишет в память (+ localStorage, чтобы
// изменения переживали перезагрузку страницы в этом браузере). Никаких сетевых запросов наружу.

const ACTION_TYPES = {
  'negative_keyword.add': { label: 'Добавление минус-слова/фразы', riskLevel: 'low', defaultRequiresConfirmation: true },
  'bid.update': { label: 'Изменение ставки', riskLevel: 'medium', defaultRequiresConfirmation: true },
  'budget.update': { label: 'Изменение дневного/недельного бюджета', riskLevel: 'high', defaultRequiresConfirmation: true },
  'campaign.pause': { label: 'Остановка кампании', riskLevel: 'medium', defaultRequiresConfirmation: true },
  'campaign.resume': { label: 'Запуск/возобновление кампании', riskLevel: 'medium', defaultRequiresConfirmation: true },
  'strategy.change': { label: 'Смена стратегии ставок', riskLevel: 'high', defaultRequiresConfirmation: true },
  'ad.create': { label: 'Создание объявления', riskLevel: 'high', defaultRequiresConfirmation: true },
  'ad.pause': { label: 'Остановка объявления', riskLevel: 'low', defaultRequiresConfirmation: true },
  'audience.update': { label: 'Изменение аудитории/таргетинга', riskLevel: 'medium', defaultRequiresConfirmation: true },
  'placement.exclude': { label: 'Исключение площадки (РСЯ/VK)', riskLevel: 'low', defaultRequiresConfirmation: true },
  'campaign.create': { label: 'Создание кампании', riskLevel: 'high', defaultRequiresConfirmation: true },
  'ad_group.create': { label: 'Создание группы объявлений (ключевые фразы/минус-слова/аудитории)', riskLevel: 'high', defaultRequiresConfirmation: true },
};

function daysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function dailySpend(pattern) {
  return pattern.map((spend, i) => ({ date: daysAgo(6 - i), spend }));
}

function initialStore() {
  return {
    projects: [
      { id: 'p1', name: 'Мебельный шоурум «Диван+»', status: 'active', goal_type: 'cpa', daily_budget_limit: 3000, currency: 'RUB' },
      { id: 'p2', name: 'Стоматология «Белая улыбка»', status: 'active', goal_type: 'leads', daily_budget_limit: 5000, currency: 'RUB' },
      { id: 'p3', name: 'TechPoint — магазин электроники', status: 'paused', goal_type: 'roas', daily_budget_limit: 2000, currency: 'RUB' },
    ],
    campaigns: {
      p1: [
        { provider: 'yandex_direct', id: 101, name: 'Диваны — Поиск', status: 'ACCEPTED', state: 'ON', dailyBudget: 1800, spendToday: 640, spend7d: 4120, dailySpend: dailySpend([520, 610, 480, 700, 590, 630, 640]) },
        { provider: 'yandex_direct', id: 102, name: 'Диваны — РСЯ', status: 'ACCEPTED', state: 'ON', dailyBudget: 1200, spendToday: 310, spend7d: 1890, dailySpend: dailySpend([240, 260, 300, 220, 280, 270, 310]) },
        { provider: 'vk_ads', id: 'vk-201', name: 'Ретаргетинг — посетители сайта', status: 'active', state: null, dailyBudget: 500, spendToday: 180, spend7d: 1120, dailySpend: dailySpend([140, 160, 150, 170, 160, 175, 180]) },
      ],
      p2: [
        { provider: 'yandex_direct', id: 201, name: 'Имплантация — Поиск', status: 'ACCEPTED', state: 'ON', dailyBudget: 3000, spendToday: 1450, spend7d: 9800, dailySpend: dailySpend([1200, 1350, 1100, 1500, 1400, 1380, 1450]) },
        { provider: 'vk_ads', id: 'vk-301', name: 'Холодная аудитория — интересы', status: 'active', state: null, dailyBudget: 1500, spendToday: 620, spend7d: 3900, dailySpend: dailySpend([500, 540, 610, 480, 590, 600, 620]) },
        { provider: 'vk_ads', id: 'vk-302', name: 'Look-alike по клиентам', status: 'active', state: null, dailyBudget: 1000, spendToday: 410, spend7d: 2600, dailySpend: dailySpend([320, 380, 350, 400, 370, 390, 410]) },
      ],
      p3: [
        { provider: 'yandex_direct', id: 301, name: 'Наушники и колонки — Поиск', status: 'SUSPENDED', state: 'OFF', dailyBudget: 2000, spendToday: 0, spend7d: 1900, dailySpend: dailySpend([600, 550, 400, 350, 0, 0, 0]) },
      ],
    },
    pending: {
      p1: [
        {
          id: 'pa-1', status: 'pending', action_key: 'negative_keyword.add', provider: 'yandex_direct',
          payload: { campaignId: 101, negativeKeywords: ['бесплатно', 'своими руками', 'б/у'] },
          reasoning: 'По итогам еженедельного разбора поисковых запросов — мусорные показы без конверсий.',
          requested_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'pa-2', status: 'pending', action_key: 'campaign.create', provider: 'vk_ads',
          payload: { name: 'Диваны — новая коллекция', objective: 'conversions', dailyBudget: 700 },
          reasoning: 'Запуск под новую коллекцию, пиксель проверен, событие "Покупка" настроено.',
          requested_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
        },
      ],
      p2: [
        {
          id: 'pa-3', status: 'pending', action_key: 'budget.update', provider: 'yandex_direct',
          payload: { campaignId: 201, dailyBudgetMicros: 4000000000 },
          reasoning: 'CPA стабильно ниже цели 3 недели подряд, накоплено 62 конверсии за месяц — предлагаю расширить бюджет на 33%.',
          requested_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        },
        {
          id: 'pa-4', status: 'approved', action_key: 'bid.update', provider: 'yandex_direct',
          payload: { bids: [{ KeywordId: 555001, Bid: 45000000 }] },
          reasoning: 'Разрешено автономно (низкий риск, порог ставки ограничен настройками проекта).',
          requested_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        },
      ],
      p3: [],
    },
    log: {
      p1: [
        { id: 'l1', action_key: 'negative_keyword.add', provider: 'yandex_direct', status: 'success', executed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
        { id: 'l2', action_key: 'ad.create', provider: 'vk_ads', status: 'success', executed_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
      ],
      p2: [
        { id: 'l3', action_key: 'bid.update', provider: 'yandex_direct', status: 'success', executed_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
        { id: 'l4', action_key: 'campaign.pause', provider: 'vk_ads', status: 'failed', executed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
      ],
      p3: [
        { id: 'l5', action_key: 'campaign.pause', provider: 'yandex_direct', status: 'success', executed_at: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString() },
      ],
    },
    stopEvents: {
      p1: [],
      p2: [],
      p3: [
        { id: 'se1', stop_rule_id: 'spend_no_conversions_pct (порог 50%)', metric_value: 68, triggered_at: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString() },
      ],
    },
    actionSettings: {
      p1: [{ action_key: 'bid.update', requires_confirmation: false }],
      p2: [{ action_key: 'bid.update', requires_confirmation: false }],
      p3: [],
    },
    nextId: 1000,
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem('shads-demo-store-v1');
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* приватный режим/заблокировано — работаем с чистыми демо-данными этой сессии */
  }
  return initialStore();
}

function saveStore() {
  try {
    localStorage.setItem('shads-demo-store-v1', JSON.stringify(store));
  } catch (e) {
    /* нет доступа к localStorage — демо всё равно работает, просто не переживёт перезагрузку */
  }
}

function resetDemoData() {
  try {
    localStorage.removeItem('shads-demo-store-v1');
  } catch (e) {
    /* ignore */
  }
  location.reload();
}

let store = loadStore();

function findPendingAcrossProjects(id) {
  for (const projectId of Object.keys(store.pending)) {
    const item = store.pending[projectId].find((p) => p.id === id);
    if (item) return { projectId, item };
  }
  return null;
}

async function mockApi(path, opts = {}) {
  const method = opts.method ?? 'GET';
  const body = opts.body ? JSON.parse(opts.body) : {};

  let m;

  if (path === '/projects' && method === 'GET') return store.projects;

  if (path === '/projects' && method === 'POST') {
    const id = 'demo-' + store.nextId++;
    const project = { id, name: body.name, status: 'active', goal_type: body.goal_type ?? 'cpa', daily_budget_limit: body.daily_budget_limit, currency: 'RUB' };
    store.projects.unshift(project);
    store.campaigns[id] = [];
    store.pending[id] = [];
    store.log[id] = [];
    store.stopEvents[id] = [];
    store.actionSettings[id] = [];
    saveStore();
    return project;
  }

  if (path === '/action-types') return ACTION_TYPES;

  if ((m = path.match(/^\/projects\/([^/]+)\/action-settings$/)) && method === 'GET') {
    return store.actionSettings[m[1]] ?? [];
  }

  if ((m = path.match(/^\/projects\/([^/]+)\/action-settings\/([^/]+)$/)) && method === 'PUT') {
    const [, projectId, actionKey] = m;
    const list = store.actionSettings[projectId] ?? (store.actionSettings[projectId] = []);
    const existing = list.find((s) => s.action_key === actionKey);
    if (existing) existing.requires_confirmation = body.requires_confirmation;
    else list.push({ action_key: actionKey, requires_confirmation: body.requires_confirmation });
    saveStore();
    return { ok: true };
  }

  if ((m = path.match(/^\/projects\/([^/]+)\/campaigns$/))) return store.campaigns[m[1]] ?? [];

  if ((m = path.match(/^\/projects\/([^/]+)\/pending-actions$/))) return store.pending[m[1]] ?? [];

  if ((m = path.match(/^\/projects\/([^/]+)\/action-log$/))) return store.log[m[1]] ?? [];

  if ((m = path.match(/^\/projects\/([^/]+)\/stop-events$/))) return store.stopEvents[m[1]] ?? [];

  if ((m = path.match(/^\/pending-actions\/([^/]+)\/approve$/)) && method === 'POST') {
    const found = findPendingAcrossProjects(m[1]);
    if (!found) throw new Error('pending action not found');
    found.item.status = 'executed';
    store.log[found.projectId].unshift({
      id: 'l-' + store.nextId++,
      action_key: found.item.action_key,
      provider: found.item.provider,
      status: 'success',
      executed_at: new Date().toISOString(),
    });
    saveStore();
    return { status: 'executed' };
  }

  if ((m = path.match(/^\/pending-actions\/([^/]+)\/reject$/)) && method === 'POST') {
    const found = findPendingAcrossProjects(m[1]);
    if (!found) throw new Error('pending action not found');
    found.item.status = 'rejected';
    saveStore();
    return found.item;
  }

  if (path === '/overview') {
    return store.projects.map((p) => {
      const campaigns = store.campaigns[p.id] ?? [];
      const spendToday = campaigns.reduce((sum, c) => sum + (c.spendToday || 0), 0);
      const pendingCount = (store.pending[p.id] ?? []).filter((a) => a.status === 'pending').length;
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        dailyBudgetLimit: p.daily_budget_limit,
        currency: p.currency,
        spendToday,
        campaignCount: campaigns.length,
        pendingCount,
      };
    });
  }

  throw new Error(`Демо-API: неизвестный маршрут ${method} ${path}`);
}
