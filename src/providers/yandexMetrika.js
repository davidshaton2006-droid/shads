const { getAccessToken } = require('../lib/connections');
const { yandexFetch } = require('../lib/network');

// Яндекс.Метрика API (только чтение — цели/конверсии/посещаемость). Доки:
// https://yandex.ru/dev/metrika/doc/api2/api_v1/intro.html

const API_URL = 'https://api-metrika.yandex.net';

async function request(projectId, path, query = {}) {
  const { accessToken } = await getAccessToken(projectId, 'yandex_metrika');
  const url = new URL(path, API_URL);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await yandexFetch(url, { headers: { Authorization: `OAuth ${accessToken}` } });
  if (!res.ok) throw new Error(`Metrika API ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const getGoals = (projectId, counterId) => request(projectId, `/management/v1/counter/${counterId}/goals`);

const getConversions = (projectId, counterId, { date1, date2, goalId }) =>
  request(projectId, '/stat/v1/data', {
    ids: counterId,
    metrics: `ym:s:goal${goalId}reaches,ym:s:goal${goalId}conversionRate`,
    date1,
    date2,
  });

module.exports = { getGoals, getConversions };
