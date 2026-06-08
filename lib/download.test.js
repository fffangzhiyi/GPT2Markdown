'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(overrides = {}) {
  function FixedDate() {
    return new Date('2026-06-02T20:30:00');
  }

  FixedDate.now = () => 1780000000000;
  FixedDate.prototype = Date.prototype;

  const context = {
    console,
    Date: FixedDate,
    ...overrides
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadDownload(context) {
  const source = fs.readFileSync('lib/download.js', 'utf8');
  vm.runInContext(source, context);
}

async function test(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (error) {
    console.error('FAIL', name);
    throw error;
  }
}

(async () => {
  await test('exposes filename helpers only', () => {
    const context = createContext();
    loadDownload(context);

    assert.strictEqual(typeof context.createFilename, 'function');
    assert.strictEqual(context.DEFAULT_FOLDER_NAME, 'chatgpt-inbox');
    assert.strictEqual(context.downloadMarkdown, undefined);
  });

  await test('creates sanitized dated filename', () => {
    const context = createContext();
    loadDownload(context);

    assert.strictEqual(
      context.createFilename('  A/B\\C:D*E?F"G<H>I|J  '),
      '2026-06-02-ABCDEFGHIJ.md'
    );
  });

  await test('truncates title to 50 characters before creating filename', () => {
    const context = createContext();
    loadDownload(context);

    assert.strictEqual(
      context.createFilename('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'),
      '2026-06-02-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX.md'
    );
  });

  await test('uses Untitled for null title', () => {
    const context = createContext();
    loadDownload(context);

    assert.strictEqual(context.createFilename(null), '2026-06-02-Untitled.md');
  });

  await test('uses Untitled timestamp when title is empty after trim', () => {
    const context = createContext();
    loadDownload(context);

    assert.strictEqual(context.createFilename('   '), '2026-06-02-Untitled-1780000000000.md');
  });
})();
