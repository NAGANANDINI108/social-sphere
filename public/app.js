const $ = s => document.querySelector(s);
const el = (t, a = {}, ...k) => {
  const n = document.createElement(t);
  for (const [x, v] of Object.entries(a)) x.startsWith('on') ? n.addEventListener(x.slice(2), v) : n.setAttribute(x, v);
  n.append(...k.flat().filter(c => c != null));
  return n;
};
const api = async (p, o = {}) => {
  const r = await fetch('/api' + p, { ...o, headers: { 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed.'), { data: j });
  return j;
};
const toast = m => { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 3200); };
const fmt = n => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const er = m => (m.views ? (m.likes + m.comments + m.shares) / m.views : null);
const pct = x => (x * 100).toFixed(1) + '%';
const OAUTH_ENV = {
  youtube: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
  instagram: 'INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET',
  facebook: 'META_CLIENT_ID and META_CLIENT_SECRET',
  x: 'X_CLIENT_ID and X_CLIENT_SECRET',
  linkedin: 'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET'
};
let LIM, chart;
const STATUS = { ready: 'Due: post manually' };

async function overview(v) {
  const [all, AC, INT] = await Promise.all([api('/posts'), api('/accounts'), api('/integrations')]), P = all.filter(p => p.status === 'posted'), demo = all.some(p => p.demo);
  const sum = (a, k) => a.reduce((s, p) => s + p.metrics[k], 0);
  const rate = a => { const w = sum(a, 'views'); return w ? pct((sum(a, 'likes') + sum(a, 'comments') + sum(a, 'shares')) / w) : 'n/a'; };
  const go = fn => async () => { try { await fn(); route(); } catch (e) { toast(e.message); } };
  const kpi = (l, x) => el('div', { class: 'card kpi' }, el('span', { class: 'muted' }, l), el('b', {}, x));
  v.append(demo
    ? el('div', { class: 'banner' }, 'Sample data is loaded. These numbers are not from real accounts. ', el('button', { class: 'btn ghost', onclick: go(() => api('/demo', { method: 'DELETE' })) }, 'Clear sample data'))
    : el('div', { class: 'banner' }, 'This dashboard is built from numbers you log yourself; it does not connect to the platforms. ', P.length ? null : el('button', { class: 'btn ghost', onclick: go(() => api('/demo', { method: 'POST' })) }, 'Load sample data to preview')));
  if (P.length) v.append(el('div', { class: 'grid' }, kpi('Posted', P.length), kpi('Views', fmt(sum(P, 'views'))), kpi('Likes', fmt(sum(P, 'likes'))), kpi('Comments', fmt(sum(P, 'comments'))), kpi('Shares', fmt(sum(P, 'shares'))), kpi('Engagement rate', rate(P))));
  if (Object.keys(AC).length) v.append(el('div', { class: 'grid' }, kpi('Followers across added accounts', fmt(Object.values(AC).reduce((s, x) => s + x.followers, 0)))));
  v.append(el('div', { class: 'grid' }, Object.entries(LIM).map(([k, l]) => {
    const X = P.filter(p => p.platform === k);
    return el('div', { class: 'card kpi' }, el('b', {}, l.n),
      X.length ? el('div', {}, `${X.length} posted · ${fmt(sum(X, 'views'))} views`, el('br'), `Engagement ${rate(X)}`) : el('span', { class: 'muted' }, 'No data yet. Mark a post as posted and enter its numbers.'), acctBox(k, AC[k], INT[k]));
  })));
  if (!P.length) return;
  const cv = el('canvas');
  v.append(el('p', { class: 'muted' }, 'Engagement rate = (likes + comments + shares) ÷ views. Views differ in meaning across platforms, so they are never added into one total chart.'),
    el('div', { class: 'card' }, el('b', {}, 'Views by platform'), cv));
  chart = new Chart(cv, { type: 'bar', data: { labels: Object.values(LIM).map(l => l.n), datasets: [{ data: Object.keys(LIM).map(k => sum(P.filter(p => p.platform === k), 'views')), backgroundColor: '#6366f1' }] }, options: { plugins: { legend: { display: false } } } });
}

function acctBox(k, a, int) {
  const box = el('div', { style: 'margin-top:10px' });
  const run = fn => async () => { try { await fn(); route(); } catch (e) { toast(e.message); } };
  const connect = el('button', { class: 'btn', onclick: () => (int?.configured ? (location.href = '/api/auth/' + k)
    : toast(`Add ${OAUTH_ENV[k]} and TOKEN_ENCRYPTION_KEY to .env, then restart the server.`)) }, 'Connect ' + LIM[k].n);
  const form = () => {
    const h = el('input', { placeholder: '@handle or channel name', value: a?.handle || '' });
    const u = el('input', { placeholder: 'Profile link (https://...)', value: a?.url || '' });
    const f = el('input', { type: 'number', min: 0, placeholder: 'Followers', value: a?.followers ?? '' });
    box.replaceChildren(h, u, f, el('div', { class: 'acts' },
      el('button', { class: 'btn', onclick: run(() => api('/accounts/' + k, { method: 'PUT', body: { handle: h.value, url: u.value, followers: f.value } })) }, 'Save'),
      el('button', { class: 'btn ghost', onclick: () => show() }, 'Cancel')));
  };
  const show = () => {
    if (a?.live) {
      const stats = [];
      if (a.hidden) stats.push('Subscriber count hidden');
      else if (a.followers != null) stats.push(`${fmt(a.followers)} followers`);
      if (a.views != null) stats.push(`${fmt(a.views)} views`);
      if (a.videos != null) stats.push(`${fmt(a.videos)} videos/posts`);
      stats.push(`updated ${new Date(a.updated).toLocaleString()}`);
      return box.replaceChildren(el('div', {}, el('strong', {}, a.handle), ' ', el('span', { class: 'badge pos' }, 'Connected via ' + LIM[k].n), ' ',
        a.url ? el('a', { href: a.url, target: '_blank', rel: 'noopener' }, 'Open profile') : null,
        el('div', { class: 'muted' }, stats.join(' · ')),
        el('div', { class: 'acts' }, el('button', { class: 'btn ghost', onclick: run(() => api('/accounts/' + k + '/refresh', { method: 'POST' }).then(() => toast('Refreshed'))) }, 'Refresh'),
          el('button', { class: 'btn ghost', onclick: run(async () => { if (confirm(`Disconnect ${LIM[k].n} and remove its saved token?`)) await api('/accounts/' + k, { method: 'DELETE' }); }) }, 'Disconnect'))));
    }
    box.replaceChildren(a
      ? el('div', {}, el('strong', {}, a.handle), ' ', a.url ? el('a', { href: a.url, target: '_blank', rel: 'noopener' }, 'Open profile') : null,
        el('div', { class: 'muted' }, `${fmt(a.followers)} followers (you entered this on ${new Date(a.updated).toLocaleDateString()})`),
        el('div', { class: 'acts' }, el('button', { class: 'btn ghost', onclick: form }, 'Edit'),
          el('button', { class: 'btn ghost', onclick: run(async () => { if (confirm('Remove this account?')) await api('/accounts/' + k, { method: 'DELETE' }); }) }, 'Remove'), connect))
      : el('div', { class: 'acts' }, el('button', { class: 'btn ghost', onclick: form }, 'Add manually'), connect));
  };
  show(); return box;
}

async function create(v) {
  const type = el('select', {}, ['text', 'image', 'video'].map(t => el('option', { value: t }, t)));
  const title = el('input'), dur = el('input', { type: 'number', min: 0 }), caption = el('textarea', { rows: 4 }), when = el('input', { type: 'datetime-local' });
  const per = el('div'), out = el('div'), eds = {};
  const toggle = (k, on) => {
    if (!on) { eds[k].box.remove(); delete eds[k]; return; }
    const ta = el('textarea', { rows: 3 }), c = el('span', { class: 'muted' }), u = () => (c.textContent = `${ta.value.length} / ${LIM[k].cap} characters`);
    ta.value = caption.value; ta.addEventListener('input', u); u();
    const ad = el('button', { class: 'btn ghost', onclick: async () => { ta.value = (await api('/adapt', { method: 'POST', body: { text: ta.value, platform: k } })).text; u(); } }, 'Fit to ' + LIM[k].n);
    eds[k] = { ta, box: el('div', { class: 'card', id: 'ed-' + k }, el('b', {}, LIM[k].n), ta, c, ' ', ad) };
    per.append(eds[k].box);
  };
  const send = async mode => {
    out.replaceChildren();
    try {
      await api('/posts', { method: 'POST', body: { type: type.value, title: title.value, durationSec: +dur.value || 0, mode, scheduledAt: when.value ? new Date(when.value).toISOString() : null,
        items: Object.entries(eds).map(([platform, e]) => ({ platform, caption: e.ta.value })) } });
      toast('Saved to Content Library'); location.hash = 'Content Library';
    } catch (e) {
      toast(e.message);
      Object.entries(e.data?.errors || {}).forEach(([k, list]) => out.append(el('div', { class: 'card' }, el('b', {}, LIM[k].n), list.map(m => el('div', { class: 'err' }, m)))));
    }
  };
  v.append(el('div', { class: 'card' },
    el('label', {}, 'Content type', type), el('label', {}, 'Title (YouTube needs one)', title), el('label', {}, 'Video length in seconds (video only)', dur),
    el('label', {}, 'Caption', caption), el('b', {}, 'Platforms'), el('p', { class: 'muted' }, 'Each platform gets its own editable caption below.'),
    Object.entries(LIM).map(([k, l]) => el('label', { class: 'plat' }, el('input', { type: 'checkbox', onchange: e => toggle(k, e.target.checked) }), `${l.n} (${l.t.join(', ')})`))),
    per, el('div', { class: 'card' }, el('label', {}, 'Schedule for (optional)', when),
      el('div', { class: 'acts' }, el('button', { class: 'btn ghost', onclick: () => send('draft') }, 'Save draft'), el('button', { class: 'btn ghost', onclick: () => send('schedule') }, 'Schedule'), el('button', { class: 'btn', onclick: () => send('ready') }, 'Prepare to post')),
      el('p', { class: 'muted' }, 'Nothing is sent to any platform. Prepared posts appear in the Content Library with a copy button, and you post them yourself.')), out);
}

async function library(v) {
  const q = el('input', { placeholder: 'Search title or caption' });
  const st = el('select', {}, [['all', 'All statuses'], ['draft', 'Draft'], ['scheduled', 'Scheduled'], ['ready', 'Due: post manually'], ['posted', 'Posted']].map(([k, n]) => el('option', { value: k }, n)));
  const pl = el('select', {}, [['all', 'All platforms'], ...Object.entries(LIM).map(([k, l]) => [k, l.n])].map(([k, n]) => el('option', { value: k }, n)));
  const box = el('div');
  const draw = async () => {
    const t = q.value.toLowerCase();
    const rows = (await api('/posts')).filter(p => (st.value === 'all' || p.status === st.value) && (pl.value === 'all' || p.platform === pl.value) && (p.title + ' ' + p.caption).toLowerCase().includes(t)).reverse();
    box.replaceChildren(...(rows.length ? rows.map(p => row(p, draw)) : [el('div', { class: 'card' }, 'Nothing here yet. Create a post or change the filters.')]));
  };
  [q, st, pl].forEach(x => x.addEventListener('input', draw));
  v.append(el('div', { class: 'grid' }, q, st, pl), box); await draw();
}

function row(p, draw) {
  const act = (label, fn, cls = 'btn ghost') => el('button', { class: cls, onclick: async () => { try { await fn(); draw(); } catch (e) { toast(e.message); } } }, label);
  const inp = {};
  return el('div', { class: 'card' },
    el('b', {}, `${LIM[p.platform].n}: ${p.title || p.type}`), ' ', el('span', { class: 'badge' + (p.status === 'ready' ? ' warn' : '') }, STATUS[p.status] || p.status),
    p.scheduledAt && p.status !== 'posted' ? el('div', { class: 'muted' }, 'Scheduled for ' + new Date(p.scheduledAt).toLocaleString()) : null,
    el('p', {}, p.caption.slice(0, 200)),
    p.status === 'posted' ? el('div', { class: 'mrow' },
      ['views', 'likes', 'comments', 'shares'].map(k => el('label', {}, k, (inp[k] = el('input', { type: 'number', min: 0, value: p.metrics[k] })))),
      act('Save numbers', () => api('/posts/' + p.id, { method: 'PATCH', body: { metrics: Object.fromEntries(Object.entries(inp).map(([k, i]) => [k, i.value])) } }).then(() => toast('Saved')), 'btn'),
      p.url ? el('a', { href: p.url, target: '_blank', rel: 'noopener' }, 'Open post') : null) : null,
    el('div', { class: 'acts' },
      p.status !== 'posted' ? [
        act('Copy caption', () => navigator.clipboard.writeText(p.caption).then(() => toast('Copied'))),
        act('Mark as posted', () => { const u = prompt('Paste the link to your post (optional)'); return u === null ? 0 : api('/posts/' + p.id, { method: 'PATCH', body: { status: 'posted', url: u.trim() } }); })] : null,
      act('Delete', () => (confirm('Delete this entry?') ? api('/posts/' + p.id, { method: 'DELETE' }) : 0))));
}

async function sentiment(v) {
  const ta = el('textarea', { rows: 8, placeholder: 'Paste comments here, one per line' }), out = el('div');
  const run = async () => {
    try {
      const d = await api('/sentiment', { method: 'POST', body: { text: ta.value } }), n = d.items.length, cls = { positive: 'pos', negative: 'neg', neutral: '' };
      out.replaceChildren(
        el('div', { class: 'card' }, ['positive', 'neutral', 'negative'].map(k => el('div', {}, `${k}: ${d.counts[k]} (${pct(d.counts[k] / n)})`, el('div', { class: 'bar' }, el('i', { style: `width:${d.counts[k] / n * 100}%` }))))),
        el('div', { class: 'card' }, el('b', {}, 'Frequent words: '), d.keywords.map(([w, c]) => `${w} (${c})`).join(', ') || 'none'),
        d.items.map(i => el('div', { class: 'card' }, el('span', { class: 'badge ' + cls[i.label] }, i.label), ' ', i.text)));
    } catch (e) { toast(e.message); }
  };
  v.append(el('div', { class: 'banner' }, 'Simple English word-list scoring on comments you paste. It misses sarcasm and negation, so treat it as a rough guide.'),
    el('div', { class: 'card' }, ta, el('button', { class: 'btn', onclick: run }, 'Analyze comments')), out);
}

async function insights(v) {
  const P = (await api('/posts')).filter(p => p.status === 'posted' && p.metrics.views > 0);
  if (P.length < 3) return v.append(el('div', { class: 'card' }, `Insights need at least 3 posted entries with views entered. You have ${P.length}.`));
  const D = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const grp = f => { const g = {}; P.forEach(p => (g[f(p)] = g[f(p)] || []).push(er(p.metrics)));
    return Object.entries(g).map(([k, a]) => ({ k, n: a.length, e: a.reduce((s, x) => s + x, 0) / a.length })).sort((a, b) => b.e - a.e); };
  const sec = (t, rows) => el('div', { class: 'card' }, el('b', {}, t), rows.map(r => el('div', {}, `${r.k}: ${pct(r.e)} (${r.n} post${r.n > 1 ? 's' : ''})`)));
  const best = grp(p => p.type)[0];
  v.append(el('div', { class: 'banner' }, 'Measured from your own numbers: average engagement rate per group. These are comparisons, not predictions.'),
    el('div', { class: 'grid' }, sec('By platform', grp(p => LIM[p.platform].n)), sec('By content type', grp(p => p.type)), sec('By weekday posted', grp(p => D[new Date(p.postedAt).getDay()]))),
    el('div', { class: 'card' }, el('b', {}, 'Suggestion'), el('p', {}, `Your ${best.k} posts have the highest average engagement so far (${best.n} post${best.n > 1 ? 's' : ''}).` + (P.length < 10 ? ' With under 10 posts this is an early signal, so keep logging results.' : ''))));
}

const NAV = { 'Overview': overview, 'Create & Publish': create, 'Content Library': library, 'Sentiment Analysis': sentiment, 'Insights': insights };
function route() {
  if (!LIM) return;
  const name = decodeURIComponent(location.hash.slice(1));
  const page = NAV[name] ? name : 'Overview', v = $('#view');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.textContent === page));
  chart?.destroy(); chart = null;
  v.replaceChildren(el('h2', {}, page));
  NAV[page](v).catch(e => v.append(el('div', { class: 'card' }, e.message)));
}
$('#nav').append(...Object.keys(NAV).map(n => el('button', { onclick: () => (location.hash = encodeURIComponent(n)) }, n)));
addEventListener('hashchange', route);
const yt = new URLSearchParams(location.search).get('yt');
const oauth = new URLSearchParams(location.search).get('oauth'), oauthStatus = new URLSearchParams(location.search).get('status');
if (oauth) {
  const messages = {
    ok: `${oauth[0].toUpperCase() + oauth.slice(1)} connected.`,
    denied: `${oauth[0].toUpperCase() + oauth.slice(1)} connection was cancelled.`,
    notconfigured: `Add the ${OAUTH_ENV[oauth] || 'platform OAuth credentials'} to .env, then restart the server.`,
    error: `${oauth[0].toUpperCase() + oauth.slice(1)} connection failed. Check server logs and the platform app settings.`
  };
  toast(messages[oauthStatus] || ''); history.replaceState(null, '', '/#Overview');
} else if (yt) { toast({ ok: 'YouTube connected.', denied: 'YouTube connection was cancelled.', notconfigured: 'Add your Google keys to .env first.', error: 'YouTube connection failed. Check the server console and your Google Cloud settings.' }[yt] || ''); history.replaceState(null, '', '/#Overview'); }
const showAuth = () => {
  const em = el('input', { type: 'email', placeholder: 'Email', autocomplete: 'username' }), pw = el('input', { type: 'password', placeholder: 'Password (8+ characters)', autocomplete: 'current-password' });
  const go = path => async () => { try { await api(path, { method: 'POST', body: { email: em.value, password: pw.value } }); location.reload(); } catch (e) { toast(e.message); } };
  $('#view').replaceChildren(el('h2', {}, 'Welcome to SocialSphere'), el('div', { class: 'card' }, em, pw,
    el('div', { class: 'acts' }, el('button', { class: 'btn', onclick: go('/login') }, 'Log in'), el('button', { class: 'btn ghost', onclick: go('/register') }, 'Create account'))));
};
api('/me').then(async m => {
  $('#nav').after(el('button', { class: 'btn ghost', style: 'margin:16px 8px', onclick: async () => { await api('/logout', { method: 'POST' }); location.reload(); } }, 'Log out (' + m.email + ')'));
  LIM = await api('/limits'); route();
}).catch(showAuth);
