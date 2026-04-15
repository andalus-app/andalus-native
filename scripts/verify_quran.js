#!/usr/bin/env node
/**
 * Quran verse coverage verification script
 * Fetches all 604 Mushaf pages from api.quran.com and verifies
 * that every verse from 1:1 through 114:6 is present.
 */

const AUTHORITATIVE = {
  1:7,2:286,3:200,4:176,5:120,6:165,7:206,8:75,9:129,10:109,
  11:123,12:111,13:43,14:52,15:99,16:128,17:111,18:110,19:98,20:135,
  21:112,22:78,23:118,24:64,25:77,26:227,27:93,28:88,29:69,30:60,
  31:34,32:30,33:73,34:54,35:45,36:83,37:182,38:88,39:75,40:85,
  41:54,42:53,43:89,44:59,45:37,46:35,47:38,48:29,49:18,50:45,
  51:60,52:49,53:62,54:55,55:78,56:96,57:29,58:22,59:24,60:13,
  61:14,62:11,63:11,64:18,65:12,66:12,67:30,68:52,69:52,70:44,
  71:28,72:28,73:20,74:56,75:40,76:31,77:50,78:40,79:46,80:42,
  81:29,82:19,83:36,84:25,85:22,86:17,87:19,88:26,89:30,90:20,
  91:15,92:21,93:11,94:8,95:8,96:19,97:5,98:8,99:8,100:11,
  101:11,102:8,103:3,104:9,105:5,106:4,107:7,108:3,109:6,110:3,
  111:5,112:4,113:5,114:6
};

const BASE_URL = 'https://api.quran.com/api/v4/verses/by_page';
const PARAMS = 'words=true&word_fields=code_v2,page_number,verse_key&mushaf=1&per_page=300';
const TOTAL_PAGES = 604;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 250;

async function fetchPage(pageNum) {
  const url = `${BASE_URL}/${pageNum}?${PARAMS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for page ${pageNum}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Starting Quran Foundation API verification...');
  console.log(`Fetching pages 1-${TOTAL_PAGES} in batches of ${BATCH_SIZE}...\n`);

  // Set of all verse keys seen across all pages (using actual page_number from word data)
  // We collect from the verse_key fields in all responses
  const seenVerses = new Set(); // "surah:verse"
  const errors = [];
  let pagesProcessed = 0;

  for (let batchStart = 1; batchStart <= TOTAL_PAGES; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, TOTAL_PAGES);
    const batch = [];
    for (let p = batchStart; p <= batchEnd; p++) {
      batch.push(p);
    }

    const results = await Promise.all(
      batch.map(p =>
        fetchPage(p).catch(err => ({ __error: true, page: p, msg: err.message }))
      )
    );

    for (let i = 0; i < results.length; i++) {
      const pageNum = batch[i];
      const data = results[i];

      if (data.__error) {
        errors.push(`Page ${pageNum}: ${data.msg}`);
        continue;
      }

      pagesProcessed++;

      // Collect every verse_key from every word on this page
      if (data.verses && Array.isArray(data.verses)) {
        for (const verse of data.verses) {
          // verse_key from the verse object itself
          if (verse.verse_key) {
            seenVerses.add(verse.verse_key);
          }
          // Also from individual words (may differ if words overflow pages)
          if (verse.words && Array.isArray(verse.words)) {
            for (const word of verse.words) {
              if (word.verse_key) {
                seenVerses.add(word.verse_key);
              }
            }
          }
        }
      }
    }

    if (pagesProcessed % 50 === 0 || batchEnd === TOTAL_PAGES) {
      process.stdout.write(`\rProcessed ${pagesProcessed}/${TOTAL_PAGES} pages...`);
    }

    if (batchEnd < TOTAL_PAGES) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`\n\nFetch complete. Pages processed: ${pagesProcessed}/${TOTAL_PAGES}`);
  if (errors.length > 0) {
    console.log(`\nFetch errors (${errors.length}):`);
    errors.forEach(e => console.log('  ' + e));
  }

  // --- Analysis ---
  console.log('\n=== MISSING VERSE ANALYSIS ===\n');

  const missingVerses = [];
  const surahsWithMissing = {};

  for (let surah = 1; surah <= 114; surah++) {
    const expectedCount = AUTHORITATIVE[surah];
    const missingInSurah = [];
    for (let verse = 1; verse <= expectedCount; verse++) {
      const key = `${surah}:${verse}`;
      if (!seenVerses.has(key)) {
        missingVerses.push(key);
        missingInSurah.push(verse);
      }
    }
    if (missingInSurah.length > 0) {
      surahsWithMissing[surah] = missingInSurah;
    }
  }

  if (missingVerses.length === 0) {
    console.log('✓ ALL verses present (1:1 through 114:6). No missing verses detected.');
  } else {
    console.log(`✗ MISSING VERSES: ${missingVerses.length} total\n`);
    for (const [surah, verses] of Object.entries(surahsWithMissing)) {
      console.log(`  Surah ${surah}: missing verses ${verses.join(', ')}`);
    }
  }

  // --- Check for unexpected verses (verses not in the authoritative list) ---
  console.log('\n=== UNEXPECTED VERSES ANALYSIS ===\n');
  const unexpected = [];
  for (const key of seenVerses) {
    const [s, v] = key.split(':').map(Number);
    if (!AUTHORITATIVE[s] || v > AUTHORITATIVE[s] || v < 1) {
      unexpected.push(key);
    }
  }
  if (unexpected.length === 0) {
    console.log('✓ No unexpected verse keys found.');
  } else {
    console.log(`✗ UNEXPECTED verse keys (${unexpected.length}):`);
    unexpected.sort().forEach(k => console.log('  ' + k));
  }

  // --- Total verse count ---
  let totalExpected = 0;
  for (let s = 1; s <= 114; s++) totalExpected += AUTHORITATIVE[s];
  let totalSeen = 0;
  for (let s = 1; s <= 114; s++) {
    for (let v = 1; v <= AUTHORITATIVE[s]; v++) {
      if (seenVerses.has(`${s}:${v}`)) totalSeen++;
    }
  }
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total unique verse keys seen: ${seenVerses.size}`);
  console.log(`Expected Quran verses (1:1–114:6): ${totalExpected}`);
  console.log(`Matched expected verses: ${totalSeen}`);
  console.log(`Missing: ${totalExpected - totalSeen}`);
  console.log(`Fetch errors: ${errors.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
