#!/usr/bin/env node
/**
 * downloadQCFFonts.js — downloads all 606 Mushaf font files to assets/fonts/qcf/
 *
 * Run from the project root:
 *   node scripts/downloadQCFFonts.js
 *
 * After this script completes successfully, run:
 *   node scripts/generateFontRequires.js
 *
 * Then in services/mushafFontManager.ts, set:
 *   const OFFLINE_MODE: 'bundled' | 'download' = 'bundled';
 *
 * Font sources:
 *   Page fonts  : https://verses.quran.foundation/fonts/quran/hafs/v2/ttf/p{N}.ttf
 *   Surah names : https://raw.githubusercontent.com/quran/quran.com-frontend/master/static/fonts/surah_names/surah_names.ttf
 *   Bismillah   : https://raw.githubusercontent.com/quran/quran.com-images/master/res/fonts/QCF_BSML.TTF
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const DEST_DIR     = path.resolve(__dirname, '../assets/fonts/qcf');
const CONCURRENCY  = 8;   // parallel downloads
const MIN_BYTES    = 1000; // sanity check — font file must be at least 1 KB

const PAGE_CDN  = n  => `https://verses.quran.foundation/fonts/quran/hafs/v2/ttf/p${n}.ttf`;
const PAGE_FILE = n  => path.join(DEST_DIR, `p${String(n).padStart(3, '0')}.ttf`);

const EXTRA_FONTS = [
  {
    url:  'https://raw.githubusercontent.com/quran/quran.com-frontend/master/static/fonts/surah_names/surah_names.ttf',
    dest: path.join(DEST_DIR, 'surah_names.ttf'),
    name: 'surah_names.ttf',
  },
  {
    url:  'https://raw.githubusercontent.com/quran/quran.com-images/master/res/fonts/QCF_BSML.TTF',
    dest: path.join(DEST_DIR, 'bismillah.ttf'),
    name: 'bismillah.ttf',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    // Skip if already downloaded and large enough
    if (fs.existsSync(destPath)) {
      const size = fs.statSync(destPath).size;
      if (size >= MIN_BYTES) { resolve({ url, destPath, skipped: true }); return; }
      fs.unlinkSync(destPath); // re-download incomplete file
    }

    const protocol = url.startsWith('https') ? https : http;
    const tmp = destPath + '.tmp';
    const file = fs.createWriteStream(tmp);

    protocol.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(tmp);
        download(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tmp);
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const size = fs.statSync(tmp).size;
          if (size < MIN_BYTES) {
            fs.unlinkSync(tmp);
            reject(new Error(`File too small (${size} bytes) for ${url}`));
          } else {
            fs.renameSync(tmp, destPath);
            resolve({ url, destPath, skipped: false });
          }
        });
      });
    }).on('error', err => {
      file.close();
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      reject(err);
    });
  });
}

async function runBatch(tasks, concurrency) {
  let i = 0;
  let done = 0;
  const total = tasks.length;
  const errors = [];

  async function worker() {
    while (i < tasks.length) {
      const task = tasks[i++];
      try {
        const result = await task();
        done++;
        if (!result.skipped) {
          process.stdout.write(`\r  ${done}/${total} downloaded`);
        }
      } catch (err) {
        errors.push(err.message);
        done++;
        process.stdout.write(`\r  ${done}/${total} (${errors.length} errors)`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, worker);
  await Promise.all(workers);
  return errors;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(DEST_DIR)) fs.mkdirSync(DEST_DIR, { recursive: true });

  console.log(`\nDownloading 606 Mushaf font files to ${DEST_DIR}\n`);

  // ── Page fonts (604) ──────────────────────────────────────────────────────
  console.log('Downloading page fonts (1–604)...');
  const pageTasks = [];
  for (let n = 1; n <= 604; n++) {
    const url  = PAGE_CDN(n);
    const dest = PAGE_FILE(n);
    pageTasks.push(() => download(url, dest));
  }
  const pageErrors = await runBatch(pageTasks, CONCURRENCY);
  console.log(`\n  Page fonts done. Errors: ${pageErrors.length}`);
  pageErrors.forEach(e => console.error('  ERROR:', e));

  // ── Extra fonts (surah_names + bismillah) ─────────────────────────────────
  console.log('\nDownloading surah_names.ttf and bismillah.ttf...');
  for (const { url, dest, name } of EXTRA_FONTS) {
    try {
      const result = await download(url, dest);
      console.log(`  ${name}: ${result.skipped ? 'already present' : 'downloaded'}`);
    } catch (err) {
      console.error(`  ERROR ${name}:`, err.message);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const files = fs.readdirSync(DEST_DIR).filter(f => f.endsWith('.ttf'));
  console.log(`\nComplete. ${files.length}/606 .ttf files present in ${DEST_DIR}`);

  if (pageErrors.length > 0) {
    console.warn(`\nWARNING: ${pageErrors.length} page font(s) failed. Re-run to retry.`);
    process.exit(1);
  }

  console.log('\nNext step: node scripts/generateFontRequires.js\n');
}

main().catch(err => { console.error(err); process.exit(1); });
