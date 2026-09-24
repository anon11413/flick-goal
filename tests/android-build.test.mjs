// Android / Google Play packaging: the no-bundler web copy, build-profile stamping, the config guard
// script, and consistency between src/config.js, capacitor.config.json and the committed android/ project.
// Nothing here needs Java, Gradle or the Android SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });

test('build:web copies only the game files and stamps the build profile into the copy', async () => {
  const out = '.tmp-www-test';
  const outAbs = path.join(ROOT, out);
  const out2 = '.tmp-www-test2';
  const outAbs2 = path.join(ROOT, out2);
  try {
    const r = node(['scripts/build-web.mjs', '--profile', 'android-release', '--ads', 'test', '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'src/main.js', 'src/config.js', 'src/platform/nativeShell.js']) {
      assert.ok(fs.existsSync(path.join(outAbs, f)), `missing ${f}`);
    }
    for (const f of ['tests', 'docs', 'scripts', 'node_modules', 'android', 'package.json', 'PLAYTEST.md', 'sketches']) {
      assert.ok(!fs.existsSync(path.join(outAbs, f)), `${f} must not be copied`);
    }
    // The committed profile stays 'dev'; only the copy is stamped.
    assert.match(read('src/build-profile.js'), /profile: 'dev'/);
    // A release copy turns dev tools and URL flags off (config derives them from the profile).
    const { CONFIG: rel } = await import(pathToFileURL(path.join(outAbs, 'src', 'config.js')).href);
    assert.equal(rel.build.profile, 'android-release');
    assert.equal(rel.build.adMode, 'test');
    assert.equal(rel.dev.enabled, false);
    assert.equal(rel.allowUrlFlags, false);

    // A second folder: ES modules are cached per URL, including build-profile.js.
    const r2 = node(['scripts/build-web.mjs', '--profile', 'android-debug', '--out', out2]);
    assert.equal(r2.status, 0, r2.stderr);
    const { CONFIG: dbg } = await import(pathToFileURL(path.join(outAbs2, 'src', 'config.js')).href);
    assert.equal(dbg.build.profile, 'android-debug');
    assert.equal(dbg.dev.enabled, true);
    assert.equal(dbg.allowUrlFlags, false);
  } finally {
    fs.rmSync(outAbs, { recursive: true, force: true });
    fs.rmSync(outAbs2, { recursive: true, force: true });
  }
});

test('build:web refuses bad arguments and never writes outside a scratch folder', () => {
  assert.notEqual(node(['scripts/build-web.mjs', '--profile', 'prod']).status, 0);
  assert.notEqual(node(['scripts/build-web.mjs', '--profile', 'android-debug', '--ads', 'live']).status, 0);
  assert.notEqual(node(['scripts/build-web.mjs', '--out', 'src']).status, 0);
  assert.notEqual(node(['scripts/build-web.mjs', '--out', '..']).status, 0);
});

test('android-config guard: test ids pass for debug / test releases, live release needs real ids', () => {
  const dbg = node(['scripts/android-config.mjs', '--profile', 'android-debug', '--check']);
  assert.equal(dbg.status, 0, dbg.stderr);
  const relTest = node(['scripts/android-config.mjs', '--profile', 'android-release', '--ads', 'test', '--check']);
  assert.equal(relTest.status, 0, relTest.stderr);
  const live = node(['scripts/android-config.mjs', '--profile', 'android-release', '--ads', 'live', '--check']);
  assert.notEqual(live.status, 0, 'shipping Google test ad ids with --ads live must fail');
  assert.match(live.stderr, /TEST ids/);
  assert.notEqual(node(['scripts/android-config.mjs', '--profile', 'android-debug', '--ads', 'live', '--check']).status, 0);
});

test('package name agrees everywhere (config, Capacitor, Gradle, Java package)', () => {
  const id = CONFIG.store.androidAppId;
  assert.match(id, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
  const cap = JSON.parse(read('capacitor.config.json'));
  assert.equal(cap.appId, id);
  assert.equal(cap.appName, 'Flick Goal');
  assert.equal(cap.webDir, 'www');
  const gradle = read('android/app/build.gradle');
  assert.ok(gradle.includes(`applicationId "${id}"`));
  // The namespace (Java package of MainActivity / R) may stay put if the appId is changed later.
  const ns = /namespace = "([^"]+)"/.exec(gradle)[1];
  const javaPath = path.join('android/app/src/main/java', ...ns.split('.'), 'MainActivity.java');
  assert.match(read(javaPath), new RegExp(`^package ${ns.replace(/\./g, '\\.')};`, 'm'));
});

test('AndroidManifest: AdMob app id, permissions, portrait game activity, singleTop', () => {
  const m = read('android/app/src/main/AndroidManifest.xml');
  assert.match(m, /android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"\s+android:value="@string\/admob_app_id"/);
  assert.match(m, /android\.permission\.INTERNET/);
  assert.match(m, /com\.google\.android\.gms\.permission\.AD_ID/);
  assert.match(m, /android:appCategory="game"/);
  assert.match(m, /android:screenOrientation="portrait"/);
  assert.match(m, /android:launchMode="singleTop"/);
  assert.doesNotMatch(m, /launchMode="singleTask"/);
  // The committed admob.xml carries exactly the app id from src/config.js.
  const admob = read('android/app/src/main/res/values/admob.xml');
  assert.ok(admob.includes(`<string name="admob_app_id" translatable="false">${CONFIG.store.admob.appId}</string>`));
});

test('Android SDK levels + version wiring', () => {
  const v = read('android/variables.gradle');
  assert.match(v, /minSdkVersion = 24/);
  assert.match(v, /compileSdkVersion = 36/);
  assert.match(v, /targetSdkVersion = 36/);  // Google Play: new apps / updates target API 36 from 2026-08-31
  // reproducible release builds: the Google Mobile Ads / UMP SDK versions are pinned (no '+')
  assert.match(v, /playServicesAdsVersion = '\d+\.\d+\.\d+'/);
  assert.match(v, /userMessagingPlatformVersion = '\d+\.\d+\.\d+'/);
  const props = read('android/version.properties');
  assert.match(props, new RegExp(`^versionName=${CONFIG.version.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(props, /^versionCode=\d+$/m);
  const g = read('android/app/build.gradle');
  assert.match(g, /versionCode fgVersionCode/);
  assert.match(g, /System\.getenv\('ANDROID_KEYSTORE_PASSWORD'\)/);
});

test('every committed Android XML resource is well formed', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.xml')) files.push(p);
    }
  };
  walk('android/app/src/main/res');
  files.push('android/app/src/main/AndroidManifest.xml');
  assert.ok(files.length >= 8);
  for (const f of files) assertWellFormed(read(f), f);
});

test('no secrets in the repo files that ship or configure builds', () => {
  const texts = [read('src/config.js'), read('capacitor.config.json'), read('.github/workflows/android.yml'), read('android/app/build.gradle')];
  for (const t of texts) {
    assert.doesNotMatch(t, /\bsk_[A-Za-z0-9]{10,}/, 'RevenueCat secret key');
    assert.doesNotMatch(t, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    assert.doesNotMatch(t, /"private_key"\s*:/);
  }
  const gi = read('.gitignore');
  for (const p of ['*.jks', '*.keystore', '*.p12', 'node_modules/', 'www/']) assert.ok(gi.includes(p), `.gitignore lacks ${p}`);
});

/** Minimal XML well-formedness check: balanced tags, one root, quoted attributes. */
function assertWellFormed(xml, name) {
  const s = xml.replace(/<\?xml[^?]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  let roots = 0;
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  let last = 0;
  while ((m = re.exec(s))) {
    const between = s.slice(last, m.index);
    assert.ok(!/[<>]/.test(between), `${name}: stray angle bracket near "${between.trim().slice(0, 40)}"`);
    last = re.lastIndex;
    const [, close, tag, , self] = m;
    if (close) {
      assert.equal(stack.pop(), tag, `${name}: mismatched </${tag}>`);
    } else {
      if (!stack.length) roots++;
      if (!self) stack.push(tag);
    }
  }
  assert.ok(!/[<>]/.test(s.slice(last)), `${name}: trailing markup`);
  assert.equal(stack.length, 0, `${name}: unclosed <${stack[stack.length - 1]}>`);
  assert.equal(roots, 1, `${name}: expected exactly one root element`);
}

test('Play store listing texts fit Google Play limits (name 30, short 80, full 4000)', () => {
  const md = read('docs/play/store-listing.md');
  const blocks = [...md.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 3);
  const [name, short, full] = blocks;
  assert.ok(name.length > 0 && name.length <= 30, `name ${name.length}`);
  assert.ok(short.length > 0 && short.length <= 80, `short ${short.length}`);
  assert.ok(full.length > 0 && full.length <= 4000, `full ${full.length}`);
});

test('Play store icon is a 512 x 512 32-bit PNG (RGBA), as Google Play asks', () => {
  const b = fs.readFileSync(path.join(ROOT, 'docs/play/graphics/icon-512.png'));
  assert.equal(b.readUInt32BE(16), 512);
  assert.equal(b.readUInt32BE(20), 512);
  assert.equal(b[24], 8, 'bit depth 8');
  assert.equal(b[25], 6, 'colour type 6 = RGBA');
  assert.ok(b.length <= 1024 * 1024);
});

test('workflow actions are on Node 24 majors (Node 20 is removed from runners on 2026-09-23)', () => {
  const y = read('.github/workflows/android.yml');
  const min = { 'actions/checkout': 5, 'actions/setup-node': 5, 'actions/setup-java': 5, 'actions/cache': 5, 'actions/upload-artifact': 6, 'gradle/actions/wrapper-validation': 5, 'android-actions/setup-android': 4 };
  const uses = [...y.matchAll(/uses:\s*([\w./-]+)@v(\d+)/g)];
  assert.ok(uses.length >= 7);
  for (const [, name, major] of uses) {
    assert.ok(name in min, `unexpected action ${name}`);
    assert.ok(Number(major) >= min[name], `${name}@v${major} is older than its Node 24 major`);
  }
});
