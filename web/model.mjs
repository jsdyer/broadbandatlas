export const BANDS = ['0%', '>0–25%', '>25–50%', '>50–75%', '>75–100%', 'Coverage unavailable'];
export const COLORS = ['#f57967', '#efa955', '#dfce69', '#60c7c3', '#87d69a', '#8b96a6'];

export function coordinates(value) {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return lat >= 41 && lat <= 84 && lon >= -142 && lon <= -50 ? [lat, lon] : null;
}

export function distance([lat1, lon1], lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function technologies(row, services) {
  return [...new Set(row[5].map(id => services[id][1]))].sort();
}

export function funds(row, names) {
  return names.filter((_, i) => row[6] & (1 << i));
}

export function filterRows(records, options, services) {
  const hits = [];
  for (const row of records) {
    if (options.id && row[0] !== options.id) continue;
    if (options.band !== '' && String(row[3] ?? 5) !== options.band) continue;
    if (options.tech && !row[5].some(index => services[index][1] === options.tech)) continue;
    if (options.fund === 'any' && row[6] === 0) continue;
    if (options.fund === 'none' && row[6] !== 0) continue;
    if (/^\d+$/.test(options.fund) && !(row[6] & (1 << Number(options.fund)))) continue;
    const km = options.centre ? distance(options.centre, row[1], row[2]) : null;
    if (km !== null && km > options.radius) continue;
    hits.push({ row, km });
  }
  if (options.centre) hits.sort((a, b) => a.km - b.km);
  return hits;
}

export function csvField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '"' + text.replaceAll('"', '""') + '"';
}
