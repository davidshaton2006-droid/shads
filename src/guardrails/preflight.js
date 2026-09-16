const { getSupabase } = require('../lib/supabase');
const { isKnownActionType } = require('./actionTypes');
const { notifyPendingActionCreated } = require('../lib/telegram');

// Preflight — единственная дверь, через которую write-инструменты MCP могут дойти до реального
// API площадки. Ни один write-инструмент не должен вызывать provider API напрямую в обход этой
// функции (см. src/mcp/tools/*.js — там write-обёртки всегда идут через requestAction).

class ActionRequiresConfirmation extends Error {
  constructor(pendingActionId) {
    super('Действие требует подтверждения владельца перед выполнением');
    this.name = 'ActionRequiresConfirmation';
    this.pendingActionId = pendingActionId;
  }
}

/**
 * Регистрирует намерение агента выполнить write-действие.
 * Если тип действия для проекта помечен как автономный (requires_confirmation = false),
 * возвращает { autoApproved: true, pendingActionId } — вызывающий код должен сам выполнить действие
 * и записать результат через recordExecution.
 * Иначе создаёт запись со статусом 'pending' и бросает ActionRequiresConfirmation.
 */
async function requestAction({ projectId, actionKey, provider, payload, reasoning }) {
  if (!isKnownActionType(actionKey)) {
    throw new Error(`Неизвестный тип действия: ${actionKey}`);
  }

  const supabase = getSupabase();

  const { data: setting } = await supabase
    .from('project_action_settings')
    .select('requires_confirmation')
    .eq('project_id', projectId)
    .eq('action_key', actionKey)
    .maybeSingle();

  // Отсутствие явной настройки == требуется подтверждение (безопасный дефолт).
  const requiresConfirmation = setting ? setting.requires_confirmation : true;

  const { data: pending, error } = await supabase
    .from('pending_actions')
    .insert({
      project_id: projectId,
      action_key: actionKey,
      provider,
      payload,
      reasoning: reasoning ?? null,
      status: requiresConfirmation ? 'pending' : 'approved',
      decided_at: requiresConfirmation ? null : new Date().toISOString(),
      decided_by: requiresConfirmation ? null : 'auto',
    })
    .select()
    .single();

  if (error) throw new Error(`Не удалось создать pending_action: ${error.message}`);

  if (requiresConfirmation) {
    // Fire-and-forget: владелец не должен ждать доставку уведомления, а сбой Telegram
    // (не настроен токен, сеть недоступна) не должен блокировать сам guardrail-флоу.
    notifyPendingActionCreated(pending).catch((err) => console.error('[TELEGRAM] notifyPendingActionCreated:', err.message));
    throw new ActionRequiresConfirmation(pending.id);
  }

  return { autoApproved: true, pendingActionId: pending.id };
}

/** Владелец подтверждает/отклоняет действие из дашборда. */
async function decideAction(pendingActionId, decision) {
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('decision должен быть approved или rejected');
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pending_actions')
    .update({ status: decision, decided_at: new Date().toISOString(), decided_by: 'owner' })
    .eq('id', pendingActionId)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) throw new Error(`Не удалось обновить pending_action: ${error.message}`);
  return data;
}

/** Записывает факт выполнения (или отказа) действия в неизменяемый лог. */
async function recordExecution({ projectId, pendingActionId, actionKey, provider, payload, previousState, result, status }) {
  const supabase = getSupabase();

  const { error: logError } = await supabase.from('action_log').insert({
    project_id: projectId,
    pending_action_id: pendingActionId ?? null,
    action_key: actionKey,
    provider,
    payload,
    previous_state: previousState ?? null,
    result: result ?? null,
    status,
  });
  if (logError) throw new Error(`Не удалось записать action_log: ${logError.message}`);

  if (pendingActionId) {
    await supabase
      .from('pending_actions')
      .update({ status: status === 'success' ? 'executed' : 'failed', executed_at: new Date().toISOString() })
      .eq('id', pendingActionId);
  }
}

module.exports = { requestAction, decideAction, recordExecution, ActionRequiresConfirmation };
