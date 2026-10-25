// SocialSphere: SQLite storage, per-user login, read-only platform OAuth, manual account entry.
require('dotenv').config();
const express = require('express'), path = require('path'), crypto = require('crypto'), Database = require('better-sqlite3');
const DB = new Database(process.env.DB_FILE || path.join(__dirname, 'socialsphere.db'));
DB.pragma('journal_mode = WAL');
DB.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, platform TEXT, type TEXT, title TEXT, caption TEXT, scheduled_at TEXT, status TEXT, url TEXT DEFAULT '', created TEXT, posted_at TEXT, demo INTEGER DEFAULT 0, views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER);
CREATE TABLE IF NOT EXISTS accounts(user_id INTEGER, platform TEXT, handle TEXT, url TEXT, followers INTEGER, hidden INTEGER DEFAULT 0, views INTEGER, videos INTEGER, live INTEGER DEFAULT 0, updated TEXT, PRIMARY KEY(user_id, platform));
CREATE TABLE IF NOT EXISTS tokens(user_id INTEGER, platform TEXT, data TEXT, PRIMARY KEY(user_id, platform));
`);
const all = (s, ...a) => DB.prepare(s).all(...a), get = (s, ...a) => DB.prepare(s).get(...a), run = (s, ...a) => DB.prepare(s).run(...a);

const L = {
  youtube:   { n: 'YouTube',   t: ['video'], cap: 5000, tmax: 100, sec: 43200 },
  instagram: { n: 'Instagram', t: ['image', 'video'], cap: 2200, sec: 900 },
  facebook:  { n: 'Facebook',  t: ['text', 'image', 'video'], cap: 63206 },
  x:         { n: 'X',         t: ['text', 'image', 'video'], cap: 280, sec: 140 },
  linkedin:  { n: 'LinkedIn',  t: ['text', 'image', 'video'], cap: 3000, sec: 600 }
};
const POS = new Set('love great awesome amazing good best helpful thanks thank nice excellent perfect beautiful happy cool fantastic wow brilliant'.split(' '));
const NEG = new Set('bad worst hate terrible awful boring poor slow broken useless disappointed waste scam annoying wrong ugly sad'.split(' '));
const STOP = new Set('this that with have from your they what when will just about like very been were them then than also into some more would could there their which'.split(' '));
const words = s => s.toLowerCase().match(/[a-z']+/g) || [];
const top = (f, n) => Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, n);
const toPost = r => ({ id: r.id, platform: r.platform, type: r.type, title: r.title, caption: r.caption, scheduledAt: r.scheduled_at, status: r.status, url: r.url,
  created: r.created, postedAt: r.posted_at, demo: !!r.demo, metrics: r.views == null ? null : { views: r.views, likes: r.likes, comments: r.comments, shares: r.shares } });
const toAcct = r => ({ handle: r.handle, url: r.url, followers: r.followers, hidden: !!r.hidden, views: r.views, videos: r.videos, live: !!r.live, updated: r.updated });
const saveAcct = (uid, k, a) => run('INSERT OR REPLACE INTO accounts VALUES(?,?,?,?,?,?,?,?,?,?)', uid, k, a.handle, a.url, a.followers, a.hidden ? 1 : 0, a.views ?? null, a.videos ?? null, a.live ? 1 : 0, a.updated);

const app = express();
app.use((_q, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }); next(); });
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Login: scrypt password hashes, random session tokens in an HttpOnly cookie ----
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const tries = new Map();
const tooMany = ip => { const t = tries.get(ip) || { n: 0, at: Date.now() }; if (Date.now() - t.at > 9e5) { t.n = 0; t.at = Date.now(); } t.n++; tries.set(ip, t); return t.n > 10; };
const startSession = (res, uid) => {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions VALUES(?,?,?)', token, uid, Date.now() + 6048e5);
  res.set('Set-Cookie', `ss=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
};
app.post('/api/register', (req, res) => {
  const { email = '', password = '' } = req.body || {}, e = String(email).trim().toLowerCase();
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (get('SELECT id FROM users WHERE email=?', e)) return res.status(409).json({ error: 'That email is already registered.' });
  const salt = crypto.randomBytes(16).toString('hex'), id = run('INSERT INTO users(email,salt,hash) VALUES(?,?,?)', e, salt, hash(String(password), salt)).lastInsertRowid;
  startSession(res, id); res.json({ email: e });
});
app.post('/api/login', (req, res) => {
  const { email = '', password = '' } = req.body || {}, u = get('SELECT * FROM users WHERE email=?', String(email).trim().toLowerCase());
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const ok = u && crypto.timingSafeEqual(Buffer.from(hash(String(password), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) return res.status(401).json({ error: 'Wrong email or password.' });
  startSession(res, u.id); res.json({ email: u.email });
});
app.get('/api/limits', (_q, res) => res.json(L));
app.use('/api', (req, res, next) => {
  const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('ss=')), s = c && get('SELECT * FROM sessions WHERE token=? AND expires>?', c.slice(3), Date.now());
  if (!s) return res.status(401).json({ error: 'Please log in.' });
  req.uid = s.user_id; req.token = s.token; next();
});
app.get('/api/me', (req, res) => res.json({ email: get('SELECT email FROM users WHERE id=?', req.uid).email }));
app.post('/api/logout', (req, res) => { run('DELETE FROM sessions WHERE token=?', req.token); res.set('Set-Cookie', 'ss=; Max-Age=0; Path=/'); res.json({ ok: true }); });

// ---- Posts ----
const check = (k, p) => {
  const l = L[k], e = [];
  if (!l) return ['Unknown platform.'];
  if (!l.t.includes(p.type)) e.push(`${l.n} does not accept ${p.type} posts.`);
  if (p.caption.length > l.cap) e.push(`Caption is ${p.caption.length} characters; the limit is ${l.cap}.`);
  if (l.tmax && !p.title.trim()) e.push('Add a title.');
  if (l.tmax && p.title.length > l.tmax) e.push(`Title is ${p.title.length} characters; the limit is ${l.tmax}.`);
  if (p.type === 'video' && l.sec && p.durationSec > l.sec) e.push(`Video is ${p.durationSec}s; the limit is ${l.sec}s.`);
  return e;
};
app.get('/api/posts', (req, res) => res.json(all('SELECT * FROM posts WHERE user_id=? ORDER BY created, id', req.uid).map(toPost)));
app.post('/api/posts', (req, res) => {
  const { type, title = '', durationSec = 0, items = [], mode = 'draft', scheduledAt = null } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Select at least one platform.' });
  if (mode === 'schedule' && !(scheduledAt && new Date(scheduledAt) > new Date())) return res.status(400).json({ error: 'Pick a date and time in the future.' });
  const errors = {};
  items.forEach(i => { const e = check(i.platform, { type, title: String(title), caption: String(i.caption || ''), durationSec: +durationSec || 0 }); if (e.length) errors[i.platform] = e; });
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Fix the issues below.', errors });
  const ins = DB.prepare('INSERT INTO posts(id,user_id,platform,type,title,caption,scheduled_at,status,created) VALUES(?,?,?,?,?,?,?,?,?)');
  DB.transaction(() => items.forEach(i => ins.run(crypto.randomUUID(), req.uid, i.platform, type, String(title), String(i.caption || ''),
    mode === 'schedule' ? scheduledAt : null, { draft: 'draft', schedule: 'scheduled', ready: 'ready' }[mode] || 'draft', new Date().toISOString())))();
  res.json({ ok: true });
});
app.patch('/api/posts/:id', (req, res) => {
  const row = get('SELECT * FROM posts WHERE id=? AND user_id=?', req.params.id, req.uid), b = req.body || {};
  if (!row) return res.status(404).json({ error: 'Entry not found.' });
  const p = toPost(row);
  if (b.status) {
    if (!['draft', 'scheduled', 'ready', 'posted'].includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
    p.status = b.status;
    if (b.status === 'posted') { p.postedAt = new Date().toISOString(); p.metrics = p.metrics || { views: 0, likes: 0, comments: 0, shares: 0 }; }
  }
  if (typeof b.url === 'string') {
    if (b.url && !/^https?:\/\//i.test(b.url)) return res.status(400).json({ error: 'The URL must start with http:// or https://' });
    p.url = b.url;
  }
  if (b.metrics) {
    const m = {};
    for (const k of ['views', 'likes', 'comments', 'shares']) { const n = Number(b.metrics[k]); if (!(n >= 0)) return res.status(400).json({ error: 'Numbers must be 0 or more.' }); m[k] = Math.round(n); }
    p.metrics = m;
  }
  const m = p.metrics || {};
  run('UPDATE posts SET status=?,url=?,posted_at=?,views=?,likes=?,comments=?,shares=? WHERE id=?', p.status, p.url, p.postedAt || null, m.views ?? null, m.likes ?? null, m.comments ?? null, m.shares ?? null, p.id);
  res.json(p);
});
app.delete('/api/posts/:id', (req, res) => { run('DELETE FROM posts WHERE id=? AND user_id=?', req.params.id, req.uid); res.json({ ok: true }); });

// Clearly flagged sample entries so the dashboard can be previewed. Removable at any time.
app.post('/api/demo', (req, res) => {
  if (get('SELECT 1 FROM posts WHERE user_id=? AND demo=1', req.uid)) return res.status(400).json({ error: 'Sample data is already loaded.' });
  const ins = DB.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)');
  DB.transaction(() => Object.keys(L).forEach((k, a) => { for (let i = 0; i < 4; i++) {
    const v = 800 + a * 450 + i * 300 + (i % 2) * 150, at = new Date(Date.now() - (i * 6 + a) * 864e5).toISOString();
    ins.run(`demo-${req.uid}-${k}-${i}`, req.uid, k, k === 'youtube' || i === 3 ? 'video' : i % 2 ? 'image' : 'text', `Sample post ${i + 1}`, 'Sample caption (demo data)', null, 'posted', '', at, at,
      v, Math.round(v * (0.04 + i * 0.005)), Math.round(v * 0.006), Math.round(v * 0.004));
  } }))();
  res.json({ ok: true });
});
app.delete('/api/demo', (req, res) => { run('DELETE FROM posts WHERE user_id=? AND demo=1', req.uid); res.json({ ok: true }); });

// Rule-based caption fitting (not AI): trims to the platform limit and adds keyword hashtags.
app.post('/api/adapt', (req, res) => {
  const { text = '', platform } = req.body || {}, l = L[platform];
  if (!l) return res.status(400).json({ error: 'Unknown platform.' });
  const base = String(text).replace(/#\w+/g, '').trim(), f = {};
  words(base).filter(w => w.length > 4 && !STOP.has(w)).forEach(w => (f[w] = (f[w] || 0) + 1));
  const tags = top(f, platform === 'x' ? 2 : 3).map(([w]) => '#' + w), tail = tags.length ? '\n\n' + tags.join(' ') : '', room = l.cap - tail.length;
  res.json({ text: (base.length > room ? base.slice(0, Math.max(0, room - 1)).trimEnd() + '…' : base) + tail });
});
// Word-list sentiment on pasted comments. English only; ignores sarcasm and negation.
app.post('/api/sentiment', (req, res) => {
  const lines = String((req.body || {}).text || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 500);
  if (!lines.length) return res.status(400).json({ error: 'Paste at least one comment.' });
  const counts = { positive: 0, neutral: 0, negative: 0 }, f = {};
  const items = lines.map(t => {
    const w = words(t), s = w.filter(x => POS.has(x)).length - w.filter(x => NEG.has(x)).length, label = s > 0 ? 'positive' : s < 0 ? 'negative' : 'neutral';
    counts[label]++; w.filter(x => x.length > 4 && !STOP.has(x)).forEach(x => (f[x] = (f[x] || 0) + 1));
    return { text: t, label };
  });
  res.json({ items, counts, keywords: top(f, 8) });
});

// ---- Read-only platform OAuth. Tokens are stored AES-256-GCM encrypted. ----
const OAUTH_ENV = {
  youtube: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  instagram: ['INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'],
  facebook: ['META_CLIENT_ID', 'META_CLIENT_SECRET'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']
};
const KEY = () => { const k = process.env.TOKEN_ENCRYPTION_KEY || ''; return /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, 'hex') : null; };
const oauthReady = k => !!(OAUTH_ENV[k] && OAUTH_ENV[k].every(n => process.env[n]) && KEY());
const redirectUri = k => `${process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)}/api/auth/${k}/callback`;
const metaVersion = () => process.env.META_GRAPH_API_VERSION || 'v23.0';
const enc = o => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY(), iv), d = Buffer.concat([c.update(JSON.stringify(o), 'utf8'), c.final()]); return [iv, c.getAuthTag(), d].map(b => b.toString('base64')).join('.'); };
const dec = s => { const [iv, t, d] = s.split('.').map(x => Buffer.from(x, 'base64')), c = crypto.createDecipheriv('aes-256-gcm', KEY(), iv); c.setAuthTag(t); return JSON.parse(Buffer.concat([c.update(d), c.final()]).toString('utf8')); };
const getTok = (uid, k) => { const r = get('SELECT data FROM tokens WHERE user_id=? AND platform=?', uid, k); return r && dec(r.data); };
const setTok = (uid, k, o) => run('INSERT OR REPLACE INTO tokens VALUES(?,?,?)', uid, k, enc(o));
const clientId = k => process.env[OAUTH_ENV[k][0]], clientSecret = k => process.env[OAUTH_ENV[k][1]];
const requestJson = async (url, options = {}) => {
  const r = await fetch(url, options), j = await r.json().catch(() => ({}));
  const detail = j.error_description || (typeof j.error === 'string' ? j.error : j.error?.message);
  if (!r.ok) throw new Error(detail || `The ${url.includes('instagram') ? 'Instagram' : 'platform'} API rejected the request.`);
  return j;
};
const gtoken = async params => {
  return requestJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId('youtube'), client_secret: clientSecret('youtube'), ...params }) });
};
const channel = async access => {
  const j = await requestJson('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', { headers: { Authorization: 'Bearer ' + access } });
  const c = j.items && j.items[0];
  if (!c) throw new Error('This Google account has no YouTube channel.');
  const s = c.statistics;
  return { handle: c.snippet.title, url: 'https://www.youtube.com/channel/' + c.id, followers: s.hiddenSubscriberCount ? 0 : +s.subscriberCount, hidden: !!s.hiddenSubscriberCount, views: +s.viewCount, videos: +s.videoCount, live: true, updated: new Date().toISOString() };
};
const states = new Map();
const providerUrl = (k, state, verifier) => {
  const common = { client_id: clientId(k), redirect_uri: redirectUri(k), response_type: 'code', state };
  if (k === 'youtube') return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ ...common, scope: 'https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent' });
  if (k === 'instagram') return 'https://www.instagram.com/oauth/authorize?' + new URLSearchParams({ ...common, scope: 'instagram_business_basic' });
  if (k === 'facebook') return `https://www.facebook.com/${metaVersion()}/dialog/oauth?` + new URLSearchParams({ ...common, scope: 'public_profile' });
  if (k === 'x') return 'https://x.com/i/oauth2/authorize?' + new URLSearchParams({ ...common, scope: 'users.read tweet.read offline.access', code_challenge: verifier, code_challenge_method: 'S256' });
  return 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({ ...common, scope: 'openid profile' });
};
const startOAuth = (req, res) => {
  const k = req.params.platform;
  if (!OAUTH_ENV[k]) return res.status(404).json({ error: 'Unknown platform.' });
  if (!oauthReady(k)) return res.redirect(`/?oauth=${k}&status=notconfigured`);
  const state = crypto.randomBytes(24).toString('hex');
  const verifier = k === 'x' ? crypto.randomBytes(32).toString('base64url') : '';
  states.set(state, { t: Date.now(), uid: req.uid, platform: k, verifier });
  res.redirect(providerUrl(k, state, verifier));
};
app.get('/api/integrations', (req, res) => res.json(Object.fromEntries(Object.keys(OAUTH_ENV).map(k => [k, { configured: oauthReady(k), connected: !!getTok(req.uid, k) }]))));
app.get('/api/auth/:platform', startOAuth);
const exchangeCode = async (k, code, state) => {
  const form = { client_id: clientId(k), client_secret: clientSecret(k), code, redirect_uri: redirectUri(k) };
  if (k === 'youtube') return gtoken({ ...form, grant_type: 'authorization_code' });
  if (k === 'instagram') {
    const short = await requestJson('https://api.instagram.com/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, grant_type: 'authorization_code' }) });
    const long = await requestJson('https://graph.instagram.com/access_token?' + new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: clientSecret(k), access_token: short.access_token }));
    return { access_token: long.access_token, expires_in: long.expires_in };
  }
  if (k === 'facebook') {
    const graph = `https://graph.facebook.com/${metaVersion()}/oauth/access_token?`;
    const short = await requestJson(graph + new URLSearchParams({ ...form }), {});
    return requestJson(graph + new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: clientId(k), client_secret: clientSecret(k), fb_exchange_token: short.access_token }), {});
  }
  if (k === 'x') return requestJson('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${clientId(k)}:${clientSecret(k)}`).toString('base64') }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(k), code_verifier: state.verifier }) });
  return requestJson('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, grant_type: 'authorization_code' }) });
};
const fetchProfile = async (k, access) => {
  if (k === 'youtube') return channel(access);
  if (k === 'instagram') {
    const j = await requestJson('https://graph.instagram.com/me?' + new URLSearchParams({ fields: 'user_id,username,account_type,media_count,followers_count', access_token: access }));
    return { handle: j.username, url: `https://www.instagram.com/${encodeURIComponent(j.username)}/`, followers: j.followers_count == null ? null : +j.followers_count, views: null, videos: j.media_count == null ? null : +j.media_count, live: true, updated: new Date().toISOString() };
  }
  if (k === 'facebook') {
    const j = await requestJson(`https://graph.facebook.com/${metaVersion()}/me?` + new URLSearchParams({ fields: 'id,name,picture', access_token: access }));
    return { handle: j.name, url: '', followers: null, views: null, videos: null, live: true, updated: new Date().toISOString() };
  }
  if (k === 'x') {
    const j = await requestJson('https://api.x.com/2/users/me?' + new URLSearchParams({ 'user.fields': 'public_metrics,profile_image_url' }), { headers: { Authorization: 'Bearer ' + access } });
    const u = j.data;
    return { handle: '@' + u.username, url: `https://x.com/${encodeURIComponent(u.username)}`, followers: u.public_metrics?.followers_count ?? null, views: null, videos: u.public_metrics?.tweet_count ?? null, live: true, updated: new Date().toISOString() };
  }
  const j = await requestJson('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: 'Bearer ' + access } });
  return { handle: j.name || j.given_name || 'LinkedIn member', url: '', followers: null, views: null, videos: null, live: true, updated: new Date().toISOString() };
};
const accessToken = async (uid, k) => {
  const t = getTok(uid, k);
  if (!t) throw new Error(`${L[k].n} is not connected.`);
  if (t.exp > Date.now() + 60000) return t.access;
  let j;
  if (k === 'youtube' && t.refresh) j = await gtoken({ grant_type: 'refresh_token', refresh_token: t.refresh });
  else if (k === 'x' && t.refresh) j = await requestJson('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${clientId(k)}:${clientSecret(k)}`).toString('base64') }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh }) });
  else if (k === 'instagram') j = await requestJson('https://graph.instagram.com/refresh_access_token?' + new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: t.access }));
  else if (k === 'linkedin' && t.refresh) j = await requestJson('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId(k), client_secret: clientSecret(k) }) });
  else throw new Error(`${L[k].n} access expired. Disconnect it and connect again.`);
  const updated = { access: j.access_token, refresh: j.refresh_token || t.refresh, exp: Date.now() + Number(j.expires_in || 3600) * 1000 };
  setTok(uid, k, updated);
  return updated.access;
};
app.get('/api/auth/:platform/callback', async (req, res) => {
  const k = req.params.platform, state = typeof req.query.state === 'string' ? req.query.state : '';
  const st = states.get(state); states.delete(state);
  if (!OAUTH_ENV[k]) return res.status(404).send('Unknown platform.');
  if (!st || st.platform !== k || st.uid !== req.uid || Date.now() - st.t > 600000) return res.redirect(`/?oauth=${k}&status=error`);
  if (req.query.error || !req.query.code) return res.redirect(`/?oauth=${k}&status=denied`);
  try {
    const j = await exchangeCode(k, String(req.query.code), st);
    const account = await fetchProfile(k, j.access_token);
    saveAcct(req.uid, k, account);
    setTok(req.uid, k, { access: j.access_token, refresh: j.refresh_token || null, exp: Date.now() + Number(j.expires_in || 3600) * 1000 });
    res.redirect(`/?oauth=${k}&status=ok`);
  } catch (e) {
    console.error(`${k} OAuth failed: ${e.message}`);
    res.redirect(`/?oauth=${k}&status=error`);
  }
});
app.post('/api/accounts/:k/refresh', async (req, res) => {
  const k = req.params.k;
  if (!OAUTH_ENV[k]) return res.status(404).json({ error: 'Unknown platform.' });
  try { const a = await fetchProfile(k, await accessToken(req.uid, k)); saveAcct(req.uid, k, a); res.json(a); } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Accounts (OAuth when available; manual entry remains available) ----
app.get('/api/accounts', (req, res) => res.json(Object.fromEntries(all('SELECT * FROM accounts WHERE user_id=?', req.uid).map(r => [r.platform, toAcct(r)]))));
app.put('/api/accounts/:k', (req, res) => {
  const k = req.params.k, b = req.body || {}, cur = get('SELECT live FROM accounts WHERE user_id=? AND platform=?', req.uid, k);
  if (!L[k]) return res.status(404).json({ error: 'Unknown platform.' });
  if (cur && cur.live) return res.status(400).json({ error: 'This account is connected live. Disconnect it to enter numbers by hand.' });
  const handle = String(b.handle || '').trim(), url = String(b.url || '').trim(), followers = Number(b.followers);
  if (!handle || handle.length > 100) return res.status(400).json({ error: 'Enter your handle or channel name (up to 100 characters).' });
  if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'The profile link must start with http:// or https://' });
  if (!(followers >= 0)) return res.status(400).json({ error: 'Followers must be a number, 0 or more.' });
  const a = { handle, url, followers: Math.round(followers), updated: new Date().toISOString() };
  saveAcct(req.uid, k, a); res.json(a);
});
app.delete('/api/accounts/:k', async (req, res) => {
  const k = req.params.k;
  if (k === 'youtube') {
    try { const t = getTok(req.uid, k); if (t) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.refresh || t.access), { method: 'POST' }); }
    catch (e) { console.error('Token revoke failed; remove access at myaccount.google.com/permissions'); }
  }
  run('DELETE FROM tokens WHERE user_id=? AND platform=?', req.uid, k);
  run('DELETE FROM accounts WHERE user_id=? AND platform=?', req.uid, k); res.json({ ok: true });
});

app.use((e, _q, res, _n) => { console.error(e.message); res.status(500).json({ error: 'Something went wrong.' }); });
module.exports = app;
if (require.main === module) {
  const tick = () => run("UPDATE posts SET status='ready' WHERE status='scheduled' AND scheduled_at<=?", new Date().toISOString()); // scheduled -> due; you post manually
  tick(); setInterval(tick, 30000); setInterval(() => run('DELETE FROM sessions WHERE expires<?', Date.now()), 36e5);
  const port = process.env.PORT || 3000;
  app.listen(port, '127.0.0.1', () => console.log(`SocialSphere running at http://localhost:${port}`));
}
