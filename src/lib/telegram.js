// Уведомления владельцу через Telegram Bot API. Настройка: создать бота через @BotFather,
// получить TELEGRAM_BOT_TOKEN, написать боту и узнать TELEGRAM_CHAT_ID (например через
// https://api.telegram.org/bot<TOKEN>/getUpdates после первого сообщения боту) — см. .env.example.
//
// Намеренно fire-and-forget с проглатыванием ошибок на уровне вызывающего кода (preflight.js,
// stopCranRunner.js): если Telegram не настроен или недоступен, это не должно ломать guardrail-
// логику (preflight/стоп-кран должны работать одинаково с уведомлениями и без них).

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[TELEGRAM] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы — уведомление не отправлено:', text);
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });

  if (!res.ok) {
    console.error('[TELEGRAM] Не удалось отправить уведомление:', res.status, await res.text().catch(() => ''));
  }
}

function notifyStopCranTriggered(project, rule, metricValue) {
  const ruleLabel = rule.rule_type === 'cpa_ceiling' ? 'превышен потолок CPA' : 'потрачен бюджет без конверсий сверх лимита';
  const text =
    `🛑 <b>Стоп-кран сработал</b>\n` +
    `Проект: <b>${escapeHtml(project.name)}</b>\n` +
    `Правило: ${ruleLabel} (${rule.rule_type})\n` +
    `Значение: ${metricValue} (порог: ${rule.threshold})\n` +
    `Кампании проекта поставлены на паузу автоматически.`;
  return sendTelegramMessage(text);
}

function notifyPendingActionCreated(pending) {
  const text =
    `⏳ <b>Требуется подтверждение</b>\n` +
    `Действие: <b>${escapeHtml(pending.action_key)}</b> (${pending.provider})\n` +
    `Проект: ${pending.project_id}\n` +
    (pending.reasoning ? `Обоснование агента: ${escapeHtml(pending.reasoning)}\n` : '') +
    `Подтвердите или отклоните в дашборде SHADS.`;
  return sendTelegramMessage(text);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { sendTelegramMessage, notifyStopCranTriggered, notifyPendingActionCreated };
