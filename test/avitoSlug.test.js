const test = require('node:test');
const assert = require('node:assert/strict');
const { cityToAvitoSlug } = require('../src/leadgen/parsers/avito');

test('крупные города берутся из таблицы слагов, регистр и пробелы не важны', () => {
  assert.equal(cityToAvitoSlug('Москва'), 'moskva');
  assert.equal(cityToAvitoSlug('  санкт-петербург '), 'sankt-peterburg');
  assert.equal(cityToAvitoSlug('Нижний Новгород'), 'nizhniy_novgorod');
  assert.equal(cityToAvitoSlug('Ростов-на-Дону'), 'rostov-na-donu');
});

test('неизвестный город транслитерируется, пробелы становятся подчёркиванием', () => {
  assert.equal(cityToAvitoSlug('Тула'), 'tula');
  assert.equal(cityToAvitoSlug('Великий Новгород'), 'velikiy_novgorod');
  assert.equal(cityToAvitoSlug('Чебоксары'), 'cheboksary');
});
