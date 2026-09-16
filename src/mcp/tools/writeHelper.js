const { requestAction, recordExecution, ActionRequiresConfirmation } = require('../../guardrails/preflight');

/**
 * Оборачивает любое write-действие в preflight. execute() вызывается только если действие
 * либо помечено автономным для проекта, либо это повторный вызов после того, как владелец
 * уже одобрил pending_action (см. dashboard route POST /api/pending-actions/:id/approve,
 * который сам выполняет execute и recordExecution — этот helper используется агентом
 * при первой попытке).
 */
async function guardedWrite({ projectId, actionKey, provider, payload, reasoning, execute }) {
  try {
    const { pendingActionId } = await requestAction({ projectId, actionKey, provider, payload, reasoning });

    let result;
    let status = 'success';
    try {
      result = await execute();
    } catch (err) {
      status = 'failed';
      await recordExecution({ projectId, pendingActionId, actionKey, provider, payload, status, result: { error: err.message } });
      throw err;
    }

    await recordExecution({ projectId, pendingActionId, actionKey, provider, payload, status, result });

    return {
      content: [
        {
          type: 'text',
          text: `Действие "${actionKey}" выполнено автономно (разрешено настройками проекта). Результат: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (err) {
    if (err instanceof ActionRequiresConfirmation) {
      return {
        content: [
          {
            type: 'text',
            text:
              `Действие "${actionKey}" требует подтверждения владельца и поставлено в очередь ` +
              `(pending_action_id: ${err.pendingActionId}). Сообщи пользователю, что нужно подтвердить его в дашборде. ` +
              `Не пытайся выполнить это действие иначе.`,
          },
        ],
      };
    }
    throw err;
  }
}

module.exports = { guardedWrite };
