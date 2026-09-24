#!/usr/bin/env node
// Copies the store settings from src/config.js (THE one block: CONFIG.store) into the Android project,
// and refuses release builds that would ship test / missing IDs.
//
//   node scripts/android-config.mjs [--profile android-debug|android-release] [--ads test|live]
//                                   [--version-code N] [--check]
//
// Writes (both committed, so Android Studio / a fresh checkout also builds):
//   android/app/src/main/res/values/admob.xml   <string name="admob_app_id"> = store.admob.appId
//   android/version.properties                   versionName = CONFIG.version, versionCode = --version-code
//                                                (kept as is when --version-code is not given)
// --check  only validates, writes nothing (exit 1 on problems).
//
// Checks (exit 1 = the CI job fails):
//   - capacitor.config.json appId == store.androidAppId == android/app/build.gradle applicationId
//   - store.admob ids look like AdMob ids (app id has '~', ad units have '/')
//   - release + ads live: no Google TEST publisher id (3940256099942544) left, and a RevenueCat
//     Google key ("goog_...") is set, and store.privacyPolicyUrl is an https:// link
//   - a RevenueCat key must never be a SECRET key ("sk_...")
// Warnings only: release + ads test (fine for internal / closed testing), empty RevenueCat key
// (purchases are hidden in the app), a Test Store key present (release builds never use it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_PUB = '3940256099942544';

function parseArgs(argv) {
  const o = { profile: 'android-debug', ads: 'test', versionCode: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v == null || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--profile') o.profile = val();
    else if (a === '--ads') o.ads = val();
    else if (a === '--version-code') o.versionCode = val();
    else if (a === '--check') o.check = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

const errors = [];
const warnings = [];
let opt;
try { opt = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`android-config: ${e.message}`); process.exit(1); }
if (!['android-debug', 'android-release'].includes(opt.profile)) errors.push(`--profile must be android-debug or android-release (got "${opt.profile}")`);
if (!['test', 'live'].includes(opt.ads)) errors.push(`--ads must be test or live (got "${opt.ads}")`);
if (opt.ads === 'live' && opt.profile !== 'android-release') errors.push('--ads live is only for android-release (debug builds always use Google test ads)');
let versionCode = null;
if (opt.versionCode != null) {
  versionCode = Number(opt.versionCode);
  // Play's maximum versionCode is 2100000000.
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) errors.push(`--version-code must be an integer 1..2100000000 (got "${opt.versionCode}")`);
}

const { CONFIG } = await import(pathToFileURL(path.join(ROOT, 'src', 'config.js')).href);
const store = CONFIG.store || {};
const admob = store.admob || {};
const rc = store.revenuecat || {};

// ---- package name: three places must agree ----
const capCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
const gradlePath = path.join(ROOT, 'android', 'app', 'build.gradle');
const gradle = fs.existsSync(gradlePath) ? fs.readFileSync(gradlePath, 'utf8') : '';
const gradleId = (/applicationId\s+"([^"]+)"/.exec(gradle) || [])[1];
const gradleNs = (/namespace\s*=\s*"([^"]+)"/.exec(gradle) || [])[1];
if (!store.androidAppId) errors.push('src/config.js store.androidAppId is empty');
if (capCfg.appId !== store.androidAppId) errors.push(`capacitor.config.json appId "${capCfg.appId}" != src/config.js store.androidAppId "${store.androidAppId}"`);
if (!gradle) errors.push('android/app/build.gradle not found (run: npx cap add android)');
else {
  if (gradleId !== store.androidAppId) errors.push(`android/app/build.gradle applicationId "${gradleId}" != store.androidAppId "${store.androidAppId}"`);
  // The namespace may differ from the appId (it names the Java package, not the app), but MainActivity must live in it.
  const mainActivity = gradleNs ? path.join(ROOT, 'android', 'app', 'src', 'main', 'java', ...gradleNs.split('.'), 'MainActivity.java') : '';
  if (!gradleNs || !fs.existsSync(mainActivity)) errors.push(`android/app/build.gradle namespace "${gradleNs}" has no MainActivity.java in its Java package folder`);
}

// ---- AdMob ids ----
const appIdRe = /^ca-app-pub-\d{16}~\d{8,12}$/;
const unitRe = /^ca-app-pub-\d{16}\/\d{8,12}$/;
if (!appIdRe.test(admob.appId || '')) errors.push(`store.admob.appId "${admob.appId}" is not an AdMob APP id (ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX)`);
for (const k of ['rewarded', 'interstitial']) {
  if (!unitRe.test(admob[k] || '')) errors.push(`store.admob.${k} "${admob[k]}" is not an AdMob AD UNIT id (ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX)`);
}
const pub = (id) => (/ca-app-pub-(\d{16})/.exec(id || '') || [])[1];
const pubs = new Set([pub(admob.appId), pub(admob.rewarded), pub(admob.interstitial)].filter(Boolean));
const usesTestIds = pubs.has(TEST_PUB);
if (pubs.size > 1) errors.push(`store.admob ids come from different AdMob accounts (${[...pubs].join(', ')}): app id and ad units must all be yours, or all Google's test ids`);

// ---- RevenueCat keys (PUBLIC keys only) ----
for (const k of ['googleApiKey', 'testStoreApiKey']) {
  const v = String(rc[k] || '');
  if (/^sk_/i.test(v) || /secret/i.test(v)) errors.push(`store.revenuecat.${k} looks like a SECRET key. Use the PUBLIC SDK key; never commit secret keys.`);
}
if (rc.googleApiKey && !/^goog_/.test(rc.googleApiKey)) warnings.push('store.revenuecat.googleApiKey does not start with "goog_" (the Google Play public SDK key usually does)');
if (rc.testStoreApiKey && !/^test_/.test(rc.testStoreApiKey)) warnings.push('store.revenuecat.testStoreApiKey does not start with "test_"');

// ---- release guards ----
if (opt.profile === 'android-release') {
  if (opt.ads === 'live') {
    if (usesTestIds) errors.push("release with --ads live, but store.admob still has Google's TEST ids: paste your AdMob app id + ad unit ids into src/config.js first");
    if (!rc.googleApiKey) errors.push('release with --ads live, but store.revenuecat.googleApiKey is empty (the store would have no coin packs / No Ads)');
    if (!/^https:\/\//.test(store.privacyPolicyUrl || '')) errors.push('release with --ads live, but store.privacyPolicyUrl is not an https:// link: Google Play requires a privacy policy link inside the app');
  } else {
    warnings.push('release build with TEST ads (fine for internal / closed testing; production needs --ads live)');
  }
  if (!rc.googleApiKey) warnings.push('store.revenuecat.googleApiKey is empty: coin packs / No Ads are hidden in this build');
  if (rc.testStoreApiKey) warnings.push('store.revenuecat.testStoreApiKey is set: release builds ignore it (only debug APKs use the Test Store)');
  if (Array.isArray(admob.testDeviceIds) && admob.testDeviceIds.length) warnings.push('store.admob.testDeviceIds is not empty: Google recommends removing test devices before release');
}

for (const w of warnings) console.warn(`android-config: warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`android-config: ERROR: ${e}`);
  process.exit(1);
}

if (opt.check) {
  console.log('android-config: ok (check only)');
  process.exit(0);
}

// ---- write admob.xml ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const admobXml = `<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by scripts/android-config.mjs from src/config.js (store.admob.appId). Edit src/config.js, not this file. -->
<resources>
    <string name="admob_app_id" translatable="false">${esc(admob.appId)}</string>
</resources>
`;
const admobPath = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'admob.xml');
fs.mkdirSync(path.dirname(admobPath), { recursive: true });
fs.writeFileSync(admobPath, admobXml);

// ---- write version.properties ----
const versionPath = path.join(ROOT, 'android', 'version.properties');
let prevCode = 1;
if (fs.existsSync(versionPath)) {
  const m = /^versionCode=(\d+)/m.exec(fs.readFileSync(versionPath, 'utf8'));
  if (m) prevCode = Number(m[1]);
}
const code = versionCode != null ? versionCode : prevCode;
const versionName = String(CONFIG.version || '1.0.0');
fs.writeFileSync(versionPath, `# GENERATED by scripts/android-config.mjs. versionName = CONFIG.version (src/config.js).
# versionCode must go UP for every Google Play upload (CI passes --version-code 1000 + run number).
versionCode=${code}
versionName=${versionName}
`);

console.log(`android-config: ${opt.profile}, ads ${opt.ads}${usesTestIds ? ' (Google TEST ad ids)' : ''}; admob app id ${admob.appId}; version ${versionName} (${code})`);
