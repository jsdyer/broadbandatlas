import { BANDS, COLORS, coordinates, csvField, filterRows, funds, technologies } from './model.mjs';
import { locationReport } from './report.mjs';

const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat('en-CA');
const regionView = {
  AB: [[54.6, -114.4], 5], BC: [[54.5, -125.3], 5], MB: [[54.3, -98.6], 5],
  NB: [[46.6, -66.4], 7], NL: [[52.7, -59.4], 5], NS: [[45.1, -62.5], 7],
  NT: [[65.8, -114.5], 4], NU: [[68.6, -92.0], 4], ON: [[49.8, -84.8], 5],
  PE: [[46.4, -63.2], 8], QC: [[51.9, -71.0], 5], SK: [[54.2, -106.1], 5],
  YT: [[64.0, -136.2], 5],
};
const perPage = 20;
const maxPoints = 1800;
const datasets = new Map();
const report = locationReport(byId('location-report'), byId('print-report'));
let manifest, places = [], selected, activeRegion, matches = [], page = 0, requestId = 0;
let reportPoint, reportRows;
let map, tiles, markers, focusLayer, area, redrawToken;

const fold = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-CA').trim();
const option = (value, label) => new Option(label, value);
const el = (tag, value) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  return node;
};
const link = (url, label) => {
  const node = el('a', label);
  node.href = url;
  node.rel = 'noopener noreferrer';
  node.target = '_blank';
  return node;
};

async function read(file) {
  const response = await fetch(new URL(`./data/${file}.json`, import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function records(region) {
  if (!datasets.has(region)) datasets.set(region, await read(region));
  return datasets.get(region);
}

function startMap() {
  if (!window.L) {
    byId('map').textContent = 'The map library is unavailable. Continue using grid results.';
    byId('tiles').disabled = true;
    return;
  }
  const L = window.L;
  map = L.map('map', { preferCanvas: true, scrollWheelZoom: false, minZoom: 3, maxZoom: 16 });
  tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
  }).addTo(map);
  markers = L.layerGroup().addTo(map);
  focusLayer = L.layerGroup().addTo(map);
  area = L.layerGroup().addTo(map);
  map.on('moveend', queueMap);
  byId('tiles').addEventListener('change', event => {
    if (event.target.checked) tiles.addTo(map);
    else tiles.removeFrom(map);
  });
}

function queueMap() {
  if (!map) return;
  cancelAnimationFrame(redrawToken);
  redrawToken = requestAnimationFrame(drawMap);
}

function drawMap() {
  if (!map || !map.getCenter) return;
  markers.clearLayers();
  const bounds = map.getBounds();
  const visible = matches.filter(({ row }) => bounds.contains([row[1], row[2]]));
  const step = Math.max(1, Math.ceil(visible.length / maxPoints));
  for (let i = 0; i < visible.length; i += step) {
    const hit = visible[i];
    const row = hit.row;
    window.L.circleMarker([row[1], row[2]], {
      radius: map.getZoom() >= 9 ? 5 : 3.2,
      color: '#141f2d', weight: .6, fillColor: COLORS[row[3] ?? 5], fillOpacity: .94,
    }).on('click', () => showDetail(hit)).addTo(markers);
  }
  byId('map-info').textContent = step > 1
    ? `Showing ${number.format(Math.ceil(visible.length / step))} of ${number.format(visible.length)} cells in view. Zoom in for more.`
    : `${number.format(visible.length)} matching cells in view. Dots mark cell centres.`;
}

function readPlace(value) {
  if (!value) return null;
  if (/^[a-z]{2}\d{8}$/i.test(value)) {
    const id = value.toUpperCase();
    if (regionView[id.slice(0, 2)]) return { id, region: id.slice(0, 2), label: id };
  }
  const point = coordinates(value);
  if (point) return { centre: point, label: point.join(', ') };
  const label = fold(value);
  const candidates = places.filter(place => place.key === label || place.hint === label);
  const place = candidates.find(place => place.region === byId('region').value) || candidates[0];
  if (!place) {
    throw new Error('Choose a community from the suggestions or enter Canadian coordinates separated by a comma.');
  }
  return { centre: place.centre, region: place.region, label: place.text };
}

function suggest() {
  const term = fold(byId('location').value);
  const shortlist = term.length < 2 ? [] : places.filter(place => place.key.startsWith(term)).slice(0, 16);
  byId('places').replaceChildren(...shortlist.map(place => option(place.text, place.text)));
}

function selection() {
  return {
    id: selected?.id,
    centre: selected?.centre,
    radius: Number(byId('radius').value),
    band: byId('coverage').value,
    fund: byId('fund').value,
    tech: byId('tech').value,
  };
}

function remember(open = false, grid = '') {
  const params = new URLSearchParams({ region: activeRegion });
  if (selected) {
    params.set('q', selected.label);
    params.set('radius', byId('radius').value);
    if (selected.centre) {
      params.set('lat', selected.centre[0]);
      params.set('lon', selected.centre[1]);
    }
  }
  for (const id of ['coverage', 'tech', 'fund']) if (byId(id).value) params.set(id, byId(id).value);
  if (open) {
    params.set('report', '1');
    if (grid) params.set('reportGrid', grid);
    if (!selected) params.set('radius', byId('radius').value);
  }
  history.replaceState(null, '', '#' + params);
}

function openReport(row, focus = true) {
  const point = row ? { centre: row.slice(1, 3), label: row[0], gridId: row[0] } : reportPoint;
  if (!point || !reportRows) return;
  remember(true, point.gridId);
  report.show({
    ...point,
    province: activeRegion,
    provinceName: byId('region').selectedOptions[0].textContent,
    radius: Number(byId('radius').value),
    rows: reportRows,
    manifest,
  });
  if (focus) byId('report-title').focus();
}

async function search(target, view = true, focusMap = false) {
  if (!manifest) return;
  const id = ++requestId;
  const region = target?.region || byId('region').value;
  report.clear();
  byId('build-report').disabled = true;
  reportPoint = undefined;
  reportRows = undefined;
  byId('status').textContent = 'Loading region…';
  try {
    const rows = await records(region);
    if (id !== requestId) return;
    selected = target;
    activeRegion = region;
    byId('region').value = region;
    if (selected) byId('location').value = target.label;
    reportRows = rows;
    if (selected?.centre) reportPoint = selected;
    if (selected?.id) {
      const row = rows.find(item => item[0] === selected.id);
      if (row) reportPoint = { centre: row.slice(1, 3), label: row[0], gridId: row[0] };
    }
    byId('build-report').disabled = !reportPoint;
    updateMatches(rows);
    if (map && view) {
      area.clearLayers();
      if (selected?.centre) {
        const circle = window.L.circle(selected.centre, {
          radius: Number(byId('radius').value) * 1000, color: '#8edcff', weight: 2,
          fillOpacity: .04, interactive: false,
        }).addTo(area);
        map.fitBounds(circle.getBounds(), { padding: [18, 18], maxZoom: 11 });
      } else if (selected?.id && matches.length) {
        map.setView(matches[0].row.slice(1, 3), 11);
        showDetail(matches[0]);
      } else {
        map.setView(...regionView[region]);
      }
    }
    remember();
    queueMap();
    if (focusMap) {
      const heading = byId('map-title');
      heading.focus({preventScroll: true});
      heading.scrollIntoView({block: 'start'});
    }
  } catch (error) {
    if (id !== requestId) return;
    byId('status').textContent = `The region could not load. Try Find coverage again (${error.message}).`;
  }
}

function updateMatches(rows) {
  const current = selection();
  matches = filterRows(rows, current, manifest.services);
  page = 0;
  byId('count').textContent = `${number.format(matches.length)} cells`;
  byId('export').disabled = matches.length === 0;
  const scope = selected?.centre
    ? `Within ${current.radius} km of ${selected.label} in ${byId('region').selectedOptions[0].textContent}`
    : selected?.id || byId('region').selectedOptions[0].textContent;
  const regionName = byId('region').selectedOptions[0].textContent;
  byId('map-title').textContent = selected?.centre
    ? `Coverage within ${current.radius} km of ${selected.label}`
    : `Coverage map · ${selected?.id || regionName}`;
  byId('status').textContent = `${scope} · ${number.format(matches.length)} of ${number.format(rows.length)} regional cells`;
  byId('detail').replaceChildren(el('p', 'Select a map point or a grid result to inspect reported coverage, providers, and funding.'));
  focusLayer?.clearLayers();
  renderProfile();
  renderPage();
}

function renderProfile() {
  const counts = Array(BANDS.length).fill(0);
  for (const { row } of matches) counts[row[3] ?? 5]++;
  const max = Math.max(1, ...counts);
  byId('profile').replaceChildren(...BANDS.map((label, i) => {
    const group = el('div');
    const bar = el('div');
    bar.className = 'bar';
    bar.style.setProperty('--fill', `${counts[i] / max * 100}%`);
    bar.style.setProperty('--band', COLORS[i]);
    group.append(el('span', label), bar, el('strong', number.format(counts[i])));
    return group;
  }));
}

function renderPage() {
  const start = page * perPage;
  const items = matches.slice(start, start + perPage);
  byId('prev').disabled = page === 0;
  byId('next').disabled = start + perPage >= matches.length;
  byId('page').textContent = items.length ? `${number.format(start + 1)}–${number.format(start + items.length)} of ${number.format(matches.length)}` : '';
  const table = byId('results');
  if (!items.length) {
    const row = el('tr');
    const cell = el('td', 'No cells match. Try a broader radius, another region, or fewer filters.');
    cell.colSpan = 5;
    row.append(cell);
    table.replaceChildren(row);
    return;
  }
  table.replaceChildren(...items.map(hit => {
    const { row, km } = hit;
    const tr = el('tr');
    const id = el('td');
    const button = el('button', row[0]);
    button.type = 'button';
    button.className = 'grid-button';
    button.addEventListener('click', () => {
      if (map) map.setView(row.slice(1, 3), Math.max(9, map.getZoom()));
      showDetail(hit);
      if (window.matchMedia('(max-width: 900px)').matches) byId('inspect-title').scrollIntoView({ block: 'start' });
    });
    id.append(button);
    const coverage = el('td');
    coverage.append(badge(row));
    tr.append(id, coverage, el('td', technologies(row, manifest.services).join(', ') || '—'),
      el('td', number.format(funds(row, manifest.funds).length)),
      el('td', km === null ? '—' : `${km.toFixed(1)} km`));
    return tr;
  }));
}

function badge(row) {
  const i = row[3] ?? 5;
  const span = el('span', BANDS[i]);
  span.className = 'badge';
  span.style.setProperty('--band', COLORS[i]);
  return span;
}

function detailsList(list, label, content) {
  list.append(el('dt', label));
  const body = el('dd');
  if (typeof content === 'string') body.textContent = content;
  else body.append(content);
  list.append(body);
}

function showDetail(hit) {
  const { row, km } = hit;
  const coords = row.slice(1, 3).join(', ');
  focusLayer?.clearLayers();
  if (map) window.L.circleMarker(row.slice(1, 3), {
    radius: 9, color: '#fff', weight: 2, fill: false, interactive: false,
  }).addTo(focusLayer);
  const heading = el('h3', row[0]);
  const facts = el('dl');
  detailsList(facts, '50/10 Mbps households', badge(row));
  detailsList(facts, '2021 occupied dwellings', ['NA', '-'].includes(row[4]) ? 'Unavailable in source' : row[4]);
  detailsList(facts, 'Grid centre', coords + (km === null ? '' : ` · ${km.toFixed(1)} km away`));
  const listed = el('ul');
  const grouped = new Map();
  for (const serviceId of row[5]) {
    const [provider, technology] = manifest.services[serviceId];
    if (!grouped.has(technology)) grouped.set(technology, []);
    grouped.get(technology).push(provider);
  }
  for (const [technology, providers] of [...grouped].sort()) {
    listed.append(el('li', `${technology} · ${providers.sort().join(', ')}`));
  }
  const projects = el('ul');
  for (const fund of funds(row, manifest.funds)) projects.append(el('li', fund));
  const references = el('p');
  references.className = 'detail-links';
  references.append(link('https://ised-isde.canada.ca/app/scr/sittibc/web/bbmap', 'National Broadband Map ↗'),
    link('https://ised-isde.canada.ca/site/high-speed-internet-canada/en/high-speed-internet-all-canadians/universal-broadband-fund/selected-universal-broadband-fund-projects', 'UBF projects ↗'),
    link('https://crtc.gc.ca/eng/internet/fnd/result/proj.htm', 'CRTC projects ↗'));
  if (['BC', 'NS'].includes(activeRegion)) references.append(link('https://coolcode.ca/spectrumatlas/', 'Spectrum Atlas ↗'));
  const reportButton = el('button', 'Report from this grid centre');
  reportButton.type = 'button';
  reportButton.addEventListener('click', () => openReport(row));
  byId('detail').replaceChildren(heading, facts, el('h4', 'Provider technologies'),
    listed.children.length ? listed : el('p', 'No provider technologies listed for this cell.'),
    el('h4', 'Mapped project layers'),
    projects.children.length ? projects : el('p', 'No project layers listed for this cell.'), reportButton, references);
}

function exportRows() {
  const columns = ['hex_id', 'latitude', 'longitude', 'coverage_band_50_10', 'occupied_dwellings_2021',
    'provider_technologies', 'project_layers', 'distance_km', 'coverage_archive_date'];
  const lines = [columns.join(',')];
  for (const { row, km } of matches) {
    lines.push([...row.slice(0, 3), BANDS[row[3] ?? 5], row[4],
      row[5].map(id => manifest.services[id].join(' — ')).join('; '),
      funds(row, manifest.funds).join('; '), km === null ? null : Number(km.toFixed(3)), manifest.coverageDate,
    ].map(csvField).join(','));
  }
  const url = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
  const anchor = el('a');
  anchor.href = url;
  anchor.download = `broadband-${activeRegion.toLowerCase()}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

byId('search').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const value = byId('location').value.trim();
    search(value === selected?.label ? selected : readPlace(value), true, true);
  } catch (error) {
    byId('status').textContent = error.message;
  }
});
for (const id of ['coverage', 'tech', 'fund']) {
  byId(id).addEventListener('change', () => search(selected, false));
}
byId('radius').addEventListener('change', () => { if (selected) search(selected); else report.clear(); });
byId('region').addEventListener('change', () => {
  byId('location').value = '';
  search(null);
});
byId('location').addEventListener('input', suggest);
byId('clear').addEventListener('click', () => {
  byId('location').value = '';
  search(null);
});
byId('langley').addEventListener('click', () => search({ centre: [49.10378, -122.65883], region: 'BC', label: 'Langley' }, true, true));
byId('halifax').addEventListener('click', () => search({ centre: [44.64876, -63.60188], region: 'NS', label: 'Halifax' }, true, true));
byId('prev').addEventListener('click', () => { page--; renderPage(); });
byId('next').addEventListener('click', () => { page++; renderPage(); });
byId('export').addEventListener('click', exportRows);
byId('build-report').addEventListener('click', () => openReport());

try {
  manifest = await read('index');
  await read('places').then(rows => {
    places = rows.map(([name, region, lat, lon]) => {
      const text = `${name} · ${region} (${lat}, ${lon})`;
      return { key: fold(name), hint: fold(text), text, region, centre: [lat, lon] };
    });
  }).catch(() => {
    byId('location').placeholder = '44.65, -63.58 or grid ID';
  });
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [key, name] of manifest.regions) byId('region').append(option(key, name));
  BANDS.forEach((label, i) => byId('coverage').append(option(i, label)));
  manifest.technologies.forEach(tech => byId('tech').append(option(tech, tech)));
  manifest.funds.forEach((fund, i) => byId('fund').append(option(i, fund)));
  for (const [i, label] of BANDS.entries()) {
    const item = el('li');
    const dot = el('span');
    dot.style.setProperty('--band', COLORS[i]);
    item.append(dot, document.createTextNode(label));
    byId('legend').append(item);
  }
  byId('region').value = Object.hasOwn(regionView, params.get('region')) ? params.get('region') : 'BC';
  for (const key of ['radius', 'coverage', 'tech', 'fund']) {
    const field = byId(key);
    if ([...field.options].some(item => item.value === params.get(key))) field.value = params.get(key);
  }
  byId('filter-options').open = ['coverage', 'tech', 'fund'].some(key => byId(key).value !== '');
  byId('vintage').textContent = `Coverage archive ${manifest.coverageDate} · Grid archive ${manifest.gridDate} · Snapshot built ${manifest.built}`;
  byId('controls').disabled = false;
  startMap();
  let target = null;
  try {
    const lat = params.get('lat');
    const lon = params.get('lon');
    const centre = lat && lon ? coordinates(`${lat}, ${lon}`) : null;
    target = centre ? { centre, label: params.get('q') || centre.join(', ') } : readPlace(params.get('q'));
  } catch {
    byId('location').value = params.get('q') || '';
  }
  await search(target);
  if (params.get('report') === '1') {
    const row = params.has('reportGrid') ? reportRows?.find(item => item[0] === params.get('reportGrid')) : undefined;
    openReport(row, false);
  }
} catch (error) {
  byId('status').textContent = `Broadband data could not load (${error.message}). Open the official dataset from the source links below.`;
}
