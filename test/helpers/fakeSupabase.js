// Лёгкий мок Supabase-клиента для тестов, без сети и без реального проекта.
// Каждая таблица получает свой handler(state) => { data, error }, где state описывает,
// что именно вызвал код (op: 'select'|'insert'|'update', filters, payload).
// Поддерживает и терминальные вызовы (.single()/.maybeSingle()), и await без них (update-цепочки
// без .select() в реальном коде), благодаря реализации .then() (thenable).

class FakeQueryBuilder {
  constructor(handler) {
    this.handler = handler;
    this.state = { op: 'select', filters: {} };
  }

  select() {
    return this;
  }

  eq(field, value) {
    this.state.filters[field] = value;
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  insert(payload) {
    this.state.op = 'insert';
    this.state.payload = payload;
    return this;
  }

  update(payload) {
    this.state.op = 'update';
    this.state.payload = payload;
    return this;
  }

  upsert(payload) {
    this.state.op = 'upsert';
    this.state.payload = payload;
    return this;
  }

  single() {
    return Promise.resolve(this.handler(this.state));
  }

  maybeSingle() {
    return Promise.resolve(this.handler(this.state));
  }

  then(resolve, reject) {
    Promise.resolve(this.handler(this.state)).then(resolve, reject);
  }
}

/**
 * tableHandlers: { [tableName]: (state) => ({ data, error }) }
 * Обращение к таблице без настроенного handler бросает понятную ошибку, а не тихо возвращает undefined.
 */
function createFakeSupabase(tableHandlers) {
  return {
    from(table) {
      const handler = tableHandlers[table];
      if (!handler) {
        throw new Error(`fakeSupabase: нет handler для таблицы "${table}" — добавьте его в тест`);
      }
      return new FakeQueryBuilder(handler);
    },
  };
}

module.exports = { createFakeSupabase, FakeQueryBuilder };
