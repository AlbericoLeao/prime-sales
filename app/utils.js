export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];

export function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

export function ym(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export function tsMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value.seconds) return value.seconds * 1000;
  if (value.toDate) return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDate(value) {
  const ms = tsMs(value);
  return ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

export function slug(value = '') {
  return String(value).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID();
}

export function percent(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(999, Math.round((Number(value || 0) / Number(total || 0)) * 100)));
}

export function progressCircle(pct, label, sublabel = '') {
  const safe = Math.max(0, Math.min(100, Number(pct || 0)));
  const deg = safe * 3.6;
  return `<div class="progress-circle" style="--progress:${deg}deg"><strong>${safe}%</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(sublabel)}</small></div>`;
}

export function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

export function csvRows(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const split = line => {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if ((ch === ';' || ch === ',') && !quoted) { out.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim().replace(/^"|"$/g, ''));
    return out;
  };
  const header = split(lines.shift()).map(h => slug(h).replace(/-/g, ''));
  return lines.map(line => {
    const cols = split(line);
    return Object.fromEntries(header.map((h, i) => [h, cols[i] || '']));
  });
}
