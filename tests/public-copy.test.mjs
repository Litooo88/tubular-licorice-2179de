import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const home = read('index.html');
const booking = read('book-online/index.html');
const about = read('om-oss/index.html');

test('diagnosis copy follows the existing price list', () => {
  assert.match(home, /Grunddiagnos kostar 495 kr/);
  assert.match(home, /elektronik kostar 695 kr/);
  assert.doesNotMatch(home, /Felsökning startar från 395/);
  assert.doesNotMatch(home, /Fels&ouml;kning startar fr&aring;n 395/);
  assert.match(booking, /<b>495 kr<\/b><span>Grunddiagnos/);
});

test('booking copy does not promise drop-in or immediate notifications', () => {
  for (const html of [home, booking]) {
    assert.doesNotMatch(html, /f&ouml;re drop-in|drop-in i m&aring;n av tid/);
    assert.match(html, /15\.00&ndash;20\.00/);
  }
  assert.doesNotMatch(booking, /Inom 4 timmar|bekr&auml;ftelse direkt|SMS\/e-post direkt/);
  assert.doesNotMatch(about, /inom ett dygn/);
});

test('existing reviews are shown once and before the battery section', () => {
  assert.ok(home.indexOf('id="kundomdomen"') < home.indexOf('id="batteri-usp"'));
  for (const name of ['Adam Salih', 'Gabriel D', 'Tommie Irvhage']) {
    assert.equal(home.split(name).length - 1, 1);
  }
  assert.match(about, /Sebastian &mdash; &auml;gare och tekniskt ansvarig/);
  assert.doesNotMatch(home, /Spara 50–70%|<div class="usp-stat">50-70%/);
});

for (const path of ['index.html', 'book-online/index.html', 'om-oss/index.html']) {
  test(path + ': inline scripts and structured data parse', () => {
    for (const match of read(path).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/src\s*=/.test(match[1])) continue;
      if (/application\/ld\+json/.test(match[1])) JSON.parse(match[2]);
      else if (!/type\s*=/.test(match[1])) new Script(match[2], { filename: path });
    }
  });
}
