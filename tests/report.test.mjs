import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearbyCoverage, pricingContext, radioSample } from '../web/report.mjs';

test('radius groups funding-only cells without treating missing coverage as zero', () => {
  const full = ['NS1', 44.6, -63.6, 0, '51–100', [], 1];
  const fundingOnly = ['NS2', 44.62, -63.64, null, '-', [], 2];
  const outside = ['NS3', 45.6, -63.64, 4, '501+', [], 0];
  const rows = [full, fundingOnly, outside];
  const manifest = { funds: ['UBF', 'CRTC'] };
  const report = nearbyCoverage(rows, [44.6, -63.6], 5, manifest);
  assert.equal(report.nearest.row, full);
  assert.equal(report.count, 2);
  assert.deepEqual([...report.layers], [['UBF', 1], ['CRTC', 1]]);
  assert.equal(nearbyCoverage(rows, [44.6, -63.6], 5, manifest, 'NS2').nearest.row, fundingOnly);
  assert.equal(nearbyCoverage(rows, [44, -64], 1, manifest).nearest, null);
});

test('provincial price comparisons avoid mixing reference years and markets', () => {
  const rows = [
    ['Internet', 'Canada', 'Urban', '50/10 Mbps', '', 2026, 63],
    ['Internet', 'NS', 'Rural', '50/10 Mbps', '', 2026, 78],
    ['Internet', 'NS', 'Urban', '50/10 Mbps', '', 2025, 60],
    ['Internet', 'Canada', 'Urban', '50/10 Mbps', '', 2025, 65],
    ['Internet', 'NS', 'Rural', '50/10 Mbps', '', 2024, 75],
    ['Internet', 'BC', 'Rural', '50/10 Mbps', '', 2024, 76],
  ];
  const comparable = pricingContext(rows, 'NS');
  assert.equal(comparable.year, 2025);
  assert.equal(comparable.matrix.get('NS:Rural'), undefined);
  assert.equal(pricingContext(rows, 'BC').year, 2024);
  assert.equal(pricingContext(rows, 'NT').year, 2026);
  assert.equal(pricingContext([], 'NS'), null);
});

test('radio counts raw records and shows nearer distinct site and licence combinations', () => {
  const far = [44.61, -63.6, 100, 110, 1, 2, 3, 5];
  const near = [44.6, -63.6, 210, 220, 1, 2, 3, 6];
  const same = [44.6, -63.6, 230, 240, 1, 2, 3, 7];
  const anotherLicence = [44.6, -63.6, 240, 260, 1, 2, 4, 8];
  const irrelevant = [48, -65, 90, 100, 1, 2, 3, 9];
  const { count, nearest } = radioSample([far, near, same, anotherLicence, irrelevant], [44.6, -63.6], 5, 2);
  assert.equal(count, 4);
  assert.deepEqual(nearest.map(item => item.row), [near, anotherLicence]);
});
