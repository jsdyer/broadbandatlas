import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinates, csvField, distance, filterRows, funds, technologies } from '../web/model.mjs';

const services = [['Example A', 'DSL'], ['Example B', 'Fibre']];
const rows = [
  ['NS44006100', 44.6, -63.6, 2, '51-100', [0, 1], 1],
  ['NS44006101', 44.62, -63.64, null, '-', [], 2],
  ['NS45006101', 45.6, -63.64, 4, '501+', [1], 0],
];

test('distance, coverage, provider and funding filters compose', () => {
  const config = { centre: [44.6, -63.6], radius: 5, band: '', tech: 'Fibre', fund: '0' };
  assert.equal(filterRows(rows, config, services)[0].row, rows[0]);
  assert.deepEqual(filterRows(rows, { ...config, band: '5' }, services), []);
  assert.deepEqual(technologies(rows[0], services), ['DSL', 'Fibre']);
  assert.deepEqual(funds(rows[1], ['UBF', 'CRTC']), ['CRTC']);
});

test('project-only cells stay distinct from published zero coverage', () => {
  const config = { band: '5', fund: 'any', tech: '' };
  assert.deepEqual(filterRows(rows, config, services).map(hit => hit.row), [rows[1]]);
  assert.deepEqual(filterRows(rows, { ...config, band: '0' }, services), []);
});

test('coordinates and CSV protect visible meanings', () => {
  assert.deepEqual(coordinates('44.65, -63.57'), [44.65, -63.57]);
  assert.equal(coordinates('−44.65, 63.57'), null);
  assert.ok(distance([44, -63], 45, -63) > 111);
  assert.equal(csvField('=1+1'), '"\'=1+1"');
  assert.equal(csvField(-63), '-63');
  assert.equal(csvField('A,"B"'), '"A,""B"""');
});
