import { BANDS, distance, funds } from './model.mjs';

const nationalData = 'https://open.canada.ca/data/en/dataset/00a331db-121b-445d-b119-35dbbe3eedd9';
const fundingSource = 'https://ised-isde.canada.ca/site/high-speed-internet-canada/en/high-speed-internet-all-canadians/universal-broadband-fund/selected-universal-broadband-fund-projects';
const crtcPricing = 'https://crtc.gc.ca/eng/publications/reports/PolicyMonitoring/cmrd.htm';
const isedRadio = 'https://ised-isde.canada.ca/site/spectrum-management-system/en/spectrum-management-system-data/download-sms-data';
const spectrum = new URL('../spectrumatlas/', import.meta.url);
const telecom = new URL('../telecompulse/', import.meta.url);
const radioKinds = [['fixed', 'Fixed service'], ['terrestrial', 'Terrestrial spectrum']];
const number = new Intl.NumberFormat('en-CA');
const dollars = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const mhz = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 6 });
const cache = new Map();

function el(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function refs(...pairs) {
  const item = el('p', undefined, 'report-links');
  for (const [url, label] of pairs) {
    const anchor = el('a', label);
    anchor.href = url;
    item.append(anchor);
  }
  return item;
}

function table(headers, rows) {
  const wrapper = el('div', undefined, 'table-wrap');
  const result = el('table');
  const head = el('thead');
  const labels = el('tr');
  for (const label of headers) {
    const cell = el('th', label);
    cell.scope = 'col';
    labels.append(cell);
  }
  head.append(labels);
  const body = el('tbody');
  for (const values of rows) {
    const row = el('tr');
    row.append(...values.map(value => el('td', value)));
    body.append(row);
  }
  result.append(head, body);
  wrapper.append(result);
  return wrapper;
}

function read(base, path) {
  const url = new URL(path, base).href;
  if (!cache.has(url)) {
    const promise = fetch(url).then(response => {
      if (!response.ok) throw new Error(`Data request failed (${response.status}).`);
      return response.json();
    }).catch(error => {
      cache.delete(url);
      throw error;
    });
    cache.set(url, promise);
  }
  return cache.get(url);
}

export function nearbyCoverage(rows, centre, radius, manifest, gridId) {
  const layers = new Map();
  let count = 0;
  let nearest = null;
  for (const row of rows) {
    const km = distance(centre, row[1], row[2]);
    if (km > radius) continue;
    count++;
    if (nearest === null || row[0] === gridId || (nearest.row[0] !== gridId && km < nearest.km)) nearest = { row, km };
    for (const layer of funds(row, manifest.funds)) {
      layers.set(layer, (layers.get(layer) ?? 0) + 1);
    }
  }
  return { count, nearest, layers };
}

export function pricingContext(rows, province) {
  const service = rows.filter(row => row[0] === 'Internet' && [province, 'Canada'].includes(row[1])
    && ['Urban', 'Rural'].includes(row[2]) && row[3] === '50/10 Mbps' && row[4] === ''
    && Number.isInteger(row[5]) && Number.isFinite(row[6]));
  if (!service.length) return null;
  const years = new Map();
  for (const [, area, market, , , year, amount] of service) {
    if (!years.has(year)) years.set(year, new Map());
    years.get(year).set(`${area}:${market}`, amount);
  }
  const descending = [...years.keys()].sort((a, b) => b - a);
  const markets = ['Urban', 'Rural'];
  const sameMarket = matrix => markets.some(market => matrix.has(`${province}:${market}`) && matrix.has(`Canada:${market}`));
  const local = matrix => markets.some(market => matrix.has(`${province}:${market}`));
  const year = descending.find(value => sameMarket(years.get(value)))
    ?? descending.find(value => local(years.get(value))) ?? descending[0];
  const matrix = years.get(year);
  return { year, matrix };
}

export function radioSample(rows, centre, radius, limit = 6) {
  let count = 0;
  const nearest = [];
  for (const row of rows) {
    const km = distance(centre, row[0], row[1]);
    if (km > radius) continue;
    count++;
    if (nearest.length === limit && nearest.at(-1).km <= km) continue;
    const site = `${row[0]},${row[1]}:${row[5]}:${row[6]}`;
    if (nearest.some(entry => entry.site === site)) continue;
    nearest.push({ km, row, site });
    nearest.sort((a, b) => a.km - b.km);
    if (nearest.length > limit) nearest.pop();
  }
  return { count, nearest };
}

function showCoverage(section, context) {
  const { rows, centre, radius, manifest, gridId, provinceName } = context;
  const { count, nearest, layers } = nearbyCoverage(rows, centre, radius, manifest, gridId);
  section.replaceChildren(el('h3', 'Reported broadband and projects'),
    el('p', `ISED coverage and project archive ${manifest.coverageDate} · grid archive ${manifest.gridDate}.`, 'small'),
    el('p', `${number.format(count)} grid centres within ${radius} km in ${provinceName}. Each cell covers roughly 25 km². The report includes all cells in range.`));
  if (nearest) {
    const { row, km } = nearest;
    const providers = row[5].map(id => manifest.services[id].join(' · '));
    section.append(table(['Grid cell', 'Households with 50/10 Mbps', 'Listed providers and technologies', 'Mapped project layers'], [[
      `${row[0]} · ${km.toFixed(1)} km from centre`, BANDS[row[3] ?? 5],
      providers.join('; ') || 'None listed', funds(row, manifest.funds).join(', ') || 'None listed',
    ]]));
    section.append(el('p', 'The selected row is the nearest grid centre or the grid cell you chose. Provider and project records apply to the cell and can cover only part of it.', 'small'));
  } else {
    section.append(el('p', 'No grid centres were reported within the selected radius and province.'));
  }
  if (layers.size) {
    section.append(table(['Mapped project layer in the radius', 'Grid cells'], [...layers.entries()]
      .sort(([a], [b]) => a.localeCompare(b)).map(([layer, cells]) => [layer, number.format(cells)])));
    section.append(el('p', 'One project can span several cells. Check project status with the funding agency.', 'small'));
  }
  section.append(refs([nationalData, 'ISED broadband data'], [fundingSource, 'Universal Broadband Fund projects'],
    ['https://crtc.gc.ca/eng/internet/fnd/result/proj.htm', 'CRTC Broadband Fund projects']));
}

async function showPricing(section, { province, provinceName }) {
  section.replaceChildren(el('h3', 'Published price context'));
  try {
    const [manifest, rows] = await Promise.all([read(telecom, 'data/manifest.json'), read(telecom, 'data/pricing.json')]);
    const result = pricingContext(rows, province);
    if (!result) section.append(el('p', 'The current Telecom Pulse snapshot has no comparable 50/10 Mbps plans.'));
    else {
      const { year, matrix } = result;
      section.append(el('p', `CRTC Pricing Survey · year-end ${year} · Telecom Pulse snapshot built ${manifest.built.slice(0, 10)}.`, 'small'),
        table(['50/10 Mbps home Internet · CAD/month', provinceName, 'Canada'], ['Urban', 'Rural'].map(market =>
          [market, ...[province, 'Canada'].map(area => {
            const amount = matrix.get(`${area}:${market}`);
            return amount === undefined ? 'Unavailable' : dollars.format(amount);
          })])),
        el('p', 'Published averages for sampled urban and rural markets. The report uses the latest year with both provincial and national data for a market when available.'));
    }
  } catch {
    section.append(el('p', 'Telecom Pulse price data could not load. Open the source or rebuild the report to retry.'));
  }
  section.append(refs([telecom, 'Explore prices in Telecom Pulse'], [crtcPricing, 'CRTC Communications Market Reports']));
}

function frequency(value) {
  return Number.isFinite(value) ? `${mhz.format(value)} MHz` : 'Unavailable';
}

async function radioLayer(meta, centre, radius) {
  const file = { fixed: 'fixed', terrestrial: 'terrestrial' }[meta.kind] + '-' + meta.province.toLowerCase() + '.json';
  const { rows, index } = await read(spectrum, file);
  const { nearest, count } = radioSample(rows, centre, radius);
  return {
    count, entries: nearest.map(({ km, row }) => {
      const [, , tx, rx, label, owner, licence, record] = row;
      return [index[label] || 'Site name unavailable', index[owner] || 'Unavailable',
        [index[licence], index[record]].filter(Boolean).join(' · ') || 'Unavailable',
        frequency(tx), frequency(rx), `${km.toFixed(2)} km`];
    }),
  };
}

async function showRadio(section, { centre, radius, province, provinceName }) {
  section.replaceChildren(el('h3', 'Nearby radio records'));
  if (!['BC', 'NS'].includes(province)) {
    section.append(el('p', 'Spectrum Atlas currently publishes provincial extracts for British Columbia and Nova Scotia. Use the official ISED download to research this location.'));
  } else {
    try {
      const manifest = await read(spectrum, 'manifest.json');
      section.append(el('p', `Within ${radius} km in ${provinceName} · Spectrum Atlas snapshot built ${manifest.built}.`, 'small'),
        el('p', 'Records represent authorizations or reported sites. A site or authorization can have multiple records. Proximity does not establish a connection to broadband service or a funded project.'));
      const layers = await Promise.allSettled(radioKinds.map(([kind]) => {
        const meta = manifest.shards.find(shard => shard.kind === kind && shard.province === province);
        if (!meta) return Promise.reject(new Error('Missing source layer'));
        return radioLayer(meta, centre, radius).then(data => ({ ...data, meta }));
      }));
      for (const [i, result] of layers.entries()) {
        section.append(el('h4', radioKinds[i][1]));
        if (result.status === 'rejected') {
          section.append(el('p', 'This extract could not load. Rebuild the report to retry.'));
          continue;
        }
        const { meta, entries, count } = result.value;
        section.append(el('p', `ISED extract ${meta.extractDate} · ${number.format(count)} matching records${count > entries.length
          ? ` · ${entries.length} nearby site and licence combinations shown` : ''}.`, 'small'));
        if (entries.length) {
          section.append(table(['Site', 'Licensee', 'Licence · record ID', 'Transmit', 'Receive', 'Distance'], entries));
        }
      }
    } catch {
      section.append(el('p', 'Spectrum Atlas data could not load. Open the source or rebuild the report to retry.'));
    }
  }
  section.append(refs([spectrum, 'Explore licences in Spectrum Atlas'], [isedRadio, 'ISED Spectrum Management System data']));
}

export function locationReport(panel, printButton) {
  let generation = 0;
  printButton.addEventListener('click', () => window.print());

  return {
    clear() {
      generation++;
      panel.hidden = true;
      printButton.disabled = true;
    },
    async show(context) {
      const request = ++generation;
      const content = panel.querySelector('.report-content');
      const status = panel.querySelector('[role="status"]');
      const { centre, label, radius, provinceName } = context;
      panel.hidden = false;
      printButton.disabled = true;
      panel.querySelector('.report-location').textContent =
        `${label} · ${centre.map(value => value.toFixed(5)).join(', ')} · ${provinceName} · ${radius} km radius`;
      status.textContent = 'Loading licence and price snapshots…';
      const coverage = el('section');
      const radio = el('section');
      const pricing = el('section');
      showCoverage(coverage, context);
      content.replaceChildren(coverage, radio, pricing, refs([location.href, 'Reopen this report in Broadband Atlas']));
      await Promise.all([showRadio(radio, context), showPricing(pricing, context)]);
      if (request !== generation) return;
      status.textContent = '';
      printButton.disabled = false;
    },
  };
}
