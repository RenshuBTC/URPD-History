// The site's defences against being used to hand visitors anything harmful: what the page may run and load, what it
// links to (no file to download), what it accepts from the API, and how the workflows that build and publish it are locked down.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { html, scripts, app, urpd } = require('./helpers.cjs');
const { scriptHashes, readPolicy } = require('../tools/update-csp.cjs');

const ROOT = path.join(__dirname, '..');
const PLOTLY = 'https://cdn.plot.ly/plotly-2.27.0.min.js';
const plain = v => JSON.parse(JSON.stringify(v));   // out of the page's realm, for deepEqual

test('the page may run only its own inline scripts and the pinned Plotly, and connect only to its own data', () => {
  const policy = readPolicy(html), d = policy.directives;
  assert.ok(html.indexOf(policy.tag) < html.search(/<script\b/i), 'the policy has to come before the first script');
  assert.deepEqual(d['default-src'], ["'none'"]);
  assert.deepEqual(d['script-src'], [...scriptHashes(html), PLOTLY], 'an inline script changed: run node tools/update-csp.cjs');
  assert.deepEqual(d['connect-src'], ["'self'", 'https://bitview.space']);
  assert.deepEqual(d['base-uri'], ["'none'"]);
  assert.deepEqual(d['form-action'], ["'none'"]);
  for (const [name, values] of Object.entries(d)) {
    for (const v of values) assert.ok(!["'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'", '*', 'http:', 'https:'].includes(v), `${name} ${v} is too broad`);
  }
  assert.ok(!d['script-src'].includes("'unsafe-inline'"));
  // Nothing may slip past the policy as markup: no inline event handlers and no javascript: addresses.
  assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test('Plotly is the one outside script, pinned by its integrity hash', () => {
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)];
  assert.deepEqual(tags.map(t => t[1]), [PLOTLY]);
  assert.match(tags[0][0], /\bintegrity="sha384-[A-Za-z0-9+/]{64}"/);
  assert.match(tags[0][0], /\bcrossorigin="anonymous"/);
});

test('the page links to no file to download, and its code starts none of its own', () => {
  // So that someone who broke into the site could not use it to hand visitors a file: the video is on YouTube. (The
  // chart's camera icon, Plotly's own, draws a PNG of the chart in the browser; it fetches nothing.)
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(m => m[0]);
  assert.deepEqual(links.filter(a => /\sdownload[\s>=]/.test(a)), [], 'no download links');
  assert.doesNotMatch(html, /releases\/download|\.mp4\b|id="videoBtn"/, 'and no address of a file to fetch');
  for (const a of links.filter(a => /target="_blank"/.test(a))) assert.match(a, /\brel="[^"]*\bnoopener\b/);
  // A programmatic download or redirect would get round that; any new one has to be added here on purpose.
  const code = scripts.join('\n');
  for (const pattern of [/\.click\(\s*\)/, /location\.(href|assign|replace)\b/, /createObjectURL/, /\.download\s*=/, /setAttribute\(\s*["']download/]) {
    assert.doesNotMatch(code, pattern);
  }
  // One window.open, on purpose: the credit line's links, and only to an account on x.com.
  assert.equal(code.match(/window\.open\s*\(/g).length, 1);
  assert.match(code, /if \(!\/\^https:\\\/\\\/x\\\.com\\\/\[A-Za-z0-9_\]\{1,15\}\$\/\.test\(url \|\| ""\)\) return;\s*e\.preventDefault\(\);\s*window\.open\(url, "_blank", "noopener"\);/);
});

test('every address in the page is one of the few it is meant to use', () => {
  const allowed = new Set([PLOTLY, 'https://github.com/renshuBTC/URPD-History', 'https://bitview.space',
    'https://fonts.googleapis.com', 'https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;700&display=swap',
    'https://fonts.gstatic.com', 'http://www.w3.org/2000/svg', 'https://x.com/',
    'https://www.youtube.com/channel/UC1jY5BEQXSetr93AbZNDbwg', 'https://www.youtube.com/watch?v=']);
  const found = [...html.matchAll(/https?:\/\/[^\s"'<>`)]+/g)].map(m => m[0].replace(/[;,.]+$/, ''));
  assert.ok(found.length >= allowed.size);
  for (const u of found) assert.ok(allowed.has(u), 'unexpected address in index.html: ' + u);
});

test('links to the repository use the account\'s name, renshuBTC, never RenshuTanz, which anyone can now claim', () => {
  // In November 2026 the GitHub account was renamed RenshuTanz for an hour and then back. GitHub gives a name up for
  // anyone to claim, and whoever takes RenshuTanz and makes a repository called URPD-History there would own every link
  // to it. (GitHub names ignore case: renshuBTC and RenshuBTC are the same account.)
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['index.html', 'privacy.html', 'terms.html', 'SECURITY.md', 'README.md', 'tools/video/page.html', 'tools/video/youtube.mjs'])
    assert.doesNotMatch(read(f), /github\.com\/RenshuTanz\b|RenshuTanz\/URPD-History|renshutanz\.github\.io/i, f);
  assert.match(html, /<a id="githubLink" href="https:\/\/github\.com\/renshuBTC\/URPD-History"/);
  for (const f of ['privacy.html', 'terms.html']) assert.match(read(f), /<a href="https:\/\/github\.com\/renshuBTC\/URPD-History">the source on GitHub<\/a>/, f);
  assert.match(read('SECURITY.md'), /gh attestation verify \S+ --repo renshuBTC\/URPD-History \\\n\s+--signer-workflow renshuBTC\/URPD-History\/\.github\/workflows\/video\.yml /);
});

test('whatever the API sends, the page keeps only real dates and finite amounts', () => {
  const { c } = app();
  assert.deepEqual(plain(c.cleanDates(['2009-01-03', '<a href="https://x">x</a>', '2009-01-04', '2009-01-04', '2009-01-02', 5, null, '2009-01-05T00:00', '2009-01-05'])),
    ['2009-01-03', '2009-01-04', '2009-01-05']);
  assert.throws(() => c.cleanDates({ length: 1, 0: '2009-01-03' }), /Unexpected/);
  const cohort = JSON.parse('{"0":1.5,"100":2,"1e2":7,"abc":3,"200":"5","300":-1,"400":null,"":4,"__proto__":9,"500":{"x":1}}');
  assert.deepEqual(plain(c.cleanCohort(cohort)), { 0: 1.5, 100: 2, '1e2': 7 });
  for (const bad of [null, [], '<script>', 5]) assert.throws(() => c.cleanCohort(bad), /Unexpected/);
  // A URPD as the API sends it: price and supply in columns, each bucket checked as above.
  const day = JSON.parse('{"date":"2020-01-01","buckets":{"price":[0,100,"x",200,-1,300,400],"supply":[1.5,2,3,"5",4,null,"<img src=x>"],' +
    '"realized_cap":[0,0,0,0,0,0,0],"unrealized_pnl":[0,0,0,0,0,0,0]}}');
  assert.deepEqual(plain(c.cleanCohort(day)), { 0: 1.5, 100: 2 });
  for (const bad of [{ buckets: null }, { buckets: { price: [1], supply: [] } }, { buckets: { price: '1', supply: [1] } }])
    assert.throws(() => c.cleanCohort(bad), /Unexpected/);
  assert.deepEqual(plain(c.cleanUrpd(day, '2020-01-01')), { 0: 1.5, 100: 2 });
  assert.throws(() => c.cleanUrpd(day, '2020-01-02'), /Unexpected/, 'another day than the one asked for');
  assert.deepEqual(plain(c.cleanSeries([1, 'x', -2, 3, null, Infinity], c.isAmount)), [1, null, null, 3, null, null]);
  assert.equal(c.cleanSeries('nope', c.isAmount), null);
});

test('cost-basis data is cleaned before it reaches the chart, and nothing that is not a date is ever requested', async () => {
  const urls = [];
  const body = JSON.stringify(Object.assign(urpd('2020-01-01', { 100: 5 }), { buckets: { price: [100, 200], supply: [5, '<img src=x onerror=alert(1)>'] } }));
  const { c } = app({ fetch: async url => { urls.push(url); return { ok: true, json: async () => JSON.parse(body) }; } });
  const raw = await c.fetchRaw('2020-01-01');
  assert.equal(urls.length, c.AGE_BANDS.length);
  assert.ok(urls.every(u => /^https:\/\/bitview\.space\/api\/urpd\/age_[a-z0-9_]+\/2020-01-01$/.test(u)));
  assert.deepEqual(urls.map(u => u.split('/')[5]), Array.from(c.AGE_BANDS, b => b.cohort), 'one request per age band, by its URPD cohort');
  assert.deepEqual(plain(raw.age[0]), { 100: 5 });
  assert.deepEqual(plain(raw.all), { 100: 5 * c.AGE_BANDS.length });
  await assert.rejects(c.fetchRaw('../../other'), /Not a date/);
  assert.equal(urls.length, c.AGE_BANDS.length);
});

test('startup keeps only real dates and prices from the API', async () => {
  const { c } = app();
  c.fetchJSON = url => {
    if (url.endsWith('/first_height/day1')) return Promise.resolve([0, '<b>1</b>', 0, 1]);
    if (url.endsWith('/price_close/day1')) return Promise.resolve([0, 'x', '<a href="https://x">10</a>']);
    if (url.endsWith('/date/day1')) return Promise.resolve(['2009-01-01', 'javascript:alert(1)', '2009-01-03']);
    return Promise.resolve({ 5: 2, 20: 1 });
  };
  c.loadAndRender = async () => {};
  await c.init();
  assert.deepEqual(plain(c.allDates), ['2009-01-03']);
  assert.deepEqual(plain(c.priceArray), [null, null, null]);
  assert.deepEqual(plain(c.priceDates), ['2009-01-01', null, '2009-01-03']);
  assert.equal(c.priceDateAt(1), '2009-01-02');   // a gap falls back to the calendar
});

test('the repository holds no file that the site could serve as a program, and nothing large', t => {
  // GitHub Pages publishes every file in the repository, so an executable committed anywhere would be downloadable
  // from the site's own address. Only these kinds of file may be committed.
  let files;
  try { files = require('node:child_process').execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch (e) { t.skip('not a git checkout'); return; }
  const kinds = /\.(html|md|json|cjs|mjs|js|svg|yml|sh)$/, names = new Set(['CNAME', 'LICENSE', '.gitignore', '.gitattributes', '.nojekyll']);
  for (const f of files) {
    assert.ok(kinds.test(f) || names.has(path.basename(f)), `${f}: not a kind of file this repository holds`);
    assert.ok(fs.statSync(path.join(ROOT, f)).size < 1e6, `${f}: over 1 MB (large files belong on a release, not in Git)`);
  }
});

// ---- the workflows -----------------------------------------------------------------------------------------------
const workflows = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter(f => /\.ya?ml$/.test(f))
  .map(f => ({ f, text: fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8') }));
// One job's block of a workflow: from its "  name:" line to the next job or the end.
function job(text, name) {
  const lines = text.split('\n'), start = lines.findIndex(l => l === `  ${name}:`);
  assert.ok(start >= 0, 'no job ' + name);
  let end = lines.findIndex((l, i) => i > start && /^ {2}[a-z][\w-]*:$/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

test('every action a workflow uses is pinned to a full commit hash, and nothing runs on pull_request_target', () => {
  assert.ok(workflows.length >= 3);
  for (const { f, text } of workflows) {
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)];
    for (const [, ref, comment] of uses) {
      assert.match(ref, /^actions\/[\w-]+@[0-9a-f]{40}$/, `${f}: ${ref} must be a GitHub action pinned to a commit`);
      assert.match(comment, /#\s*v\d+\.\d+\.\d+/, `${f}: ${ref} needs its version as a comment`);
    }
    assert.doesNotMatch(text, /pull_request_target|workflow_run/, f);
    assert.match(text, /^permissions:/m, `${f} must set its token's permissions`);
  }
});

test('the jobs that run third-party code or parse its output can read the repository and nothing else', () => {
  const video = workflows.find(w => w.f === 'video.yml').text;
  assert.match(video, /^permissions: \{\}/m);
  for (const name of ['render', 'vet']) {
    const block = job(video, name);
    assert.match(block, /permissions:\n\s+contents: read\s*(#.*)?\n\s+steps:/, name);
    assert.doesNotMatch(block, /GH_TOKEN|secrets\.|github\.token/, name);
    assert.match(block, /persist-credentials: false/, name);
  }
  assert.match(job(video, 'render'), /npm ci --ignore-scripts/);
  // The vet job checks the rendered file, rewrites it keeping only the picture, and decodes every frame.
  const vet = job(video, 'vet');
  assert.match(vet, /check-video\.sh "\$RUNNER_TEMP\/rendered\/\$FILE"/);
  assert.match(vet, /filter_units=pass_types=/);
  assert.match(vet, /check-video\.sh "\$RUNNER_TEMP\/vetted\/\$FILE" --decode/);
  // The jobs that can write never parse the video, and the publish job attests before it publishes.
  for (const name of ['update', 'publish']) assert.doesNotMatch(job(video, name), /ffmpeg|ffprobe|check-video/, name);
  const publish = job(video, 'publish');
  assert.match(publish, /needs: \[update, vet\]/);
  assert.match(publish, /uses: actions\/attest@/);
  // Every video the run drew is attested: the folder holds exactly those (the step before counts them).
  assert.match(publish, /subject-path: \$\{\{ runner\.temp \}\}\/vetted\/\*\.mp4\n/, 'every vetted video attested');
  assert.match(publish, /\[ "\$\(find "\$RUNNER_TEMP\/vetted" -type f \| wc -l\)" = "\$\{#FILES\[@\]\}" \]/, 'and nothing else in the folder');
  assert.ok(publish.indexOf('Look at the files without parsing them') < publish.indexOf('actions/attest@'), 'looked at before they are attested');
  assert.ok(publish.indexOf('actions/attest@') < publish.indexOf('replace-asset.sh video'), 'attest before publishing');
  assert.match(publish, /replace-asset\.sh video "\$RUNNER_TEMP\/vetted\/\$VIDEO_USD_AGE" "\$RUNNER_TEMP\/vetted\/\$VIDEO_BTC_AGE" \\\n\s+"\$RUNNER_TEMP\/vetted\/\$VIDEO_USD_LTHSTH" "\$RUNNER_TEMP\/vetted\/\$VIDEO_BTC_LTHSTH"\n/, 'these four and no other');
  assert.equal((publish.match(/replace-asset\.sh video /g) || []).length, 1);
  // The YouTube credentials reach two steps of each youtube job (the check for them and its one post) and nothing
  // else in the workflow; the steps that hold them run this repository's own code.
  assert.equal((video.match(/secrets\./g) || []).length, 24);
  const post = (tag, env, look) => `name: Post the ${tag} video to YouTube | run: node tools/video/youtube.mjs "$RUNNER_TEMP/vetted/$${env}" "$START" "$END" ${look} >> "$GITHUB_OUTPUT"`;
  const POSTS = { 'youtube-usd-age': post('USD-AGE', 'VIDEO_USD_AGE', 'usd-age'), 'youtube-btc-age': post('BTC-AGE', 'VIDEO_BTC_AGE', 'btc-age'),
    'youtube-usd-lthsth': post('USD-LTH/STH', 'VIDEO_USD_LTHSTH', 'usd-lthsth'), 'youtube-btc-lthsth': post('BTC-LTH/STH', 'VIDEO_BTC_LTHSTH', 'btc-lthsth') };
  assert.deepEqual([...video.matchAll(/^ {2}(youtube[\w-]*):$/gm)].map(m => m[1]), Object.keys(POSTS), 'these four youtube jobs and no other');
  for (const name of Object.keys(POSTS)) {
    const youtube = job(video, name);
    assert.equal((youtube.match(/secrets\.YOUTUBE_/g) || []).length, 6, name);
    const holders = youtube.split(/\n      - /).filter(step => /secrets\./.test(step));
    assert.deepEqual(holders.map(step => (step.match(/(?:name: .*|run: .*)/g) || []).join(' | ')), ['name: Look for the YouTube credentials | run: |', POSTS[name]], name);
    assert.equal((youtube.match(/run: node tools\/video\/youtube\.mjs /g) || []).length, 1, name);
    assert.doesNotMatch(youtube, /npm |contents: write|GH_TOKEN|uses: (?!actions\/(checkout|setup-node|download-artifact)@)/, name);
  }
});

test('the site check compares the live page, the pages it links to and the data it loads with the latest main', () => {
  const check = workflows.find(w => w.f === 'site-check.yml').text;
  assert.match(check, /files="index\.html privacy\.html terms\.html data\/youtube\.json data\/scales\.json"/);
  assert.match(check, /git fetch -q --depth=1 origin main\n/, 'fetched again on every try: the daily commits land while it runs');
  assert.match(check, /git show "FETCH_HEAD:\$f" \| cmp -s - "\$RUNNER_TEMP\/live"/);
  assert.match(check, /--proto '=https' --tlsv1\.2/);
  // Every file the site links to or loads from itself is among them.
  const own = [...new Set([...html.matchAll(/(?:href|fetchJSON\()\s*=?\s*"((?:[a-z]+\/)?[a-z]+\.(?:html|json))"/g)].map(m => m[1]))];
  assert.ok(own.length >= 4, own.join(' '));
  for (const f of own) assert.ok(check.includes(f), f);
});

test('the evals workflow can read the repository and nothing else, holds no secret and installs no package scripts', () => {
  const evals = workflows.find(w => w.f === 'evals.yml').text;
  assert.match(evals, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(evals, /secrets\.|GH_TOKEN|github\.token|contents: write|id-token/);
  assert.match(evals, /persist-credentials: false/);
  assert.match(evals, /npm ci --ignore-scripts/);
  // The one expression is the hand-run's plan, read through the environment, never pasted into a script.
  assert.deepEqual([...evals.matchAll(/\$\{\{[^}]*\}\}/g)].map(m => m[0]), ["${{ inputs.plan || 'daily' }}"]);
  assert.match(evals, /PLAN: \$\{\{ inputs\.plan \|\| 'daily' \}\}/);
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'package-lock.json'), 'utf8'));
  for (const [name, p] of Object.entries(lock.packages)) if (name) assert.match(p.integrity || '', /^sha512-/, name + ' is pinned by its hash');
});

test('the privacy page runs nothing and loads nothing from elsewhere, and the explainer links to it', () => {
  const page = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  assert.match(page, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">/);
  assert.doesNotMatch(page, /<script|\son[a-z]+=|javascript:/i, 'no script of any kind');
  assert.doesNotMatch(page, /<(iframe|object|embed|form|img)\b/i);
  assert.match(page, /Bitcoin Supply Chart uploader/, 'it names the app that posts to YouTube');
  assert.match(page, /https:\/\/www\.youtube\.com\/t\/terms/);
  assert.match(page, /https:\/\/policies\.google\.com\/privacy/);
  assert.match(page, /This site uses the YouTube API Services\./);
  assert.match(page, /https:\/\/security\.google\.com\/settings\/security\/permissions/, 'how the permission is withdrawn');
  assert.match(page, /<a href="terms\.html">Terms<\/a>/);
  assert.match(html, /<p id="explainFoot"><a id="privacyLink" href="privacy.html">Privacy<\/a> · <a id="termsLink" href="terms.html">Terms<\/a><\/p>/);
});

test('the terms page runs nothing either, and binds the video to YouTube\'s terms', () => {
  const page = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8');
  assert.match(page, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">/);
  assert.doesNotMatch(page, /<script|\son[a-z]+=|javascript:/i, 'no script of any kind');
  assert.doesNotMatch(page, /<(iframe|object|embed|form|img)\b/i);
  assert.match(page, /agree\s+to be bound by the <a href="https:\/\/www\.youtube\.com\/t\/terms">YouTube Terms of Service<\/a>/);
  assert.match(page, /https:\/\/policies\.google\.com\/privacy/);
  assert.match(page, /not financial, investment,\s+tax or legal advice/);
  assert.match(page, /<a href="privacy\.html">Privacy<\/a>/);
});
