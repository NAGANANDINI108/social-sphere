// Run with: npm test
process.env.DB_FILE = ':memory:';
const test = require('node:test'), assert = require('node:assert'), app = require('./server');
let server, base, cookie = '';
const call = async (p, method = 'GET', body) => {
  const r = await fetch(base + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc && sc.startsWith('ss=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
test.before(() => new Promise(ok => { server = app.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; ok(); }); }));
test.after(() => server.close());

test('requires login', async () => assert.equal((await call('/posts')).status, 401));
test('registration is validated', async () => {
  assert.equal((await call('/register', 'POST', { email: 'bad', password: 'longenough' })).status, 400);
  assert.equal((await call('/register', 'POST', { email: 'a@b.co', password: 'short' })).status, 400);
  assert.equal((await call('/register', 'POST', { email: 'a@b.co', password: 'longenough' })).status, 200);
  assert.equal((await call('/register', 'POST', { email: 'a@b.co', password: 'longenough' })).status, 409);
});
test('integration status lists configured and connected state for each platform', async () => {
  const r = await call('/integrations');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data).sort(), ['facebook', 'instagram', 'linkedin', 'x', 'youtube']);
  Object.values(r.data).forEach(s => {
    assert.equal(typeof s.configured, 'boolean');
    assert.equal(typeof s.connected, 'boolean');
  });
});
test('rejects a caption over the X limit', async () => {
  const r = await call('/posts', 'POST', { type: 'text', mode: 'ready', items: [{ platform: 'x', caption: 'a'.repeat(281) }] });
  assert.equal(r.status, 400); assert.ok(r.data.errors.x.length);
});
test('post flow: prepare, mark posted, validate numbers', async () => {
  assert.equal((await call('/posts', 'POST', { type: 'text', mode: 'ready', items: [{ platform: 'x', caption: 'hello world' }] })).status, 200);
  const [p] = (await call('/posts')).data;
  assert.equal(p.status, 'ready');
  assert.equal((await call('/posts/' + p.id, 'PATCH', { status: 'posted' })).data.metrics.views, 0);
  assert.equal((await call('/posts/' + p.id, 'PATCH', { metrics: { views: -5, likes: 0, comments: 0, shares: 0 } })).status, 400);
  assert.equal((await call('/posts/' + p.id, 'PATCH', { metrics: { views: 100, likes: 5, comments: 1, shares: 1 } })).data.metrics.views, 100);
});
test('users cannot see each other\'s data', async () => {
  const first = cookie; cookie = '';
  await call('/register', 'POST', { email: 'c@d.co', password: 'longenough' });
  assert.equal((await call('/posts')).data.length, 0);
  cookie = first; assert.equal((await call('/posts')).data.length, 1);
});
test('sentiment labels comments', async () => {
  const d = (await call('/sentiment', 'POST', { text: 'I love this great video\nterrible and boring\nok' })).data;
  assert.deepEqual(d.counts, { positive: 1, neutral: 1, negative: 1 });
});
