'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(overrides = {}) {
  const clicks = [];
  const appended = [];
  const removed = [];
  const revoked = [];

  function FixedDate() {
    return new Date('2026-06-02T20:30:00');
  }

  FixedDate.now = () => 1780000000000;
  FixedDate.prototype = Date.prototype;

  const context = {
    console,
    Date: FixedDate,
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL(blob) {
        context.createdBlob = blob;
        return 'blob:download-url';
      },
      revokeObjectURL(url) {
        revoked.push(url);
      }
    },
    document: {
      body: {
        appendChild(element) {
          appended.push(element);
        },
        removeChild(element) {
          removed.push(element);
        }
      },
      createElement(tagName) {
        return {
          tagName,
          style: {},
          click() {
            clicks.push(this);
          }
        };
      }
    },
    clicks,
    appended,
    removed,
    revoked,
    ...overrides
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadDownload(context) {
  const source = fs.readFileSync('lib/download.js', 'utf8');
  vm.runInContext(source, context);
}

function assertJsonEqual(actual, expected) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));
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
  await test('downloads markdown with sanitized dated filename and default folder', async () => {
    const context = createContext();
    loadDownload(context);

    const result = await context.downloadMarkdown('markdown content', '  A/B\\C:D*E?F"G<H>I|J  ');

    assertJsonEqual(result, {
      success: true,
      filename: '2026-06-02-ABCDEFGHIJ.md'
    });
    assert.strictEqual(context.appended.length, 1);
    assert.strictEqual(context.removed.length, 1);
    assert.strictEqual(context.clicks.length, 1);
    assert.strictEqual(context.revoked[0], 'blob:download-url');
    assert.strictEqual(context.appended[0].href, 'blob:download-url');
    assert.strictEqual(context.appended[0].download, 'chatgpt-inbox/2026-06-02-ABCDEFGHIJ.md');
    assertJsonEqual(context.createdBlob.parts, ['markdown content']);
    assertJsonEqual(context.createdBlob.options, {
      type: 'text/markdown;charset=utf-8'
    });
  });

  await test('uses provided folder name', async () => {
    const context = createContext();
    loadDownload(context);

    const result = await context.downloadMarkdown('content', 'Title', 'custom-folder');

    assertJsonEqual(result, {
      success: true,
      filename: '2026-06-02-Title.md'
    });
    assert.strictEqual(context.appended[0].download, 'custom-folder/2026-06-02-Title.md');
  });

  await test('truncates title to 50 characters before creating filename', async () => {
    const context = createContext();
    loadDownload(context);

    const result = await context.downloadMarkdown('content', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');

    assertJsonEqual(result, {
      success: true,
      filename: '2026-06-02-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX.md'
    });
  });

  await test('uses Untitled for null title', async () => {
    const context = createContext();
    loadDownload(context);

    const result = await context.downloadMarkdown('content', null);

    assertJsonEqual(result, {
      success: true,
      filename: '2026-06-02-Untitled.md'
    });
  });

  await test('uses Untitled timestamp when title is empty after trim', async () => {
    const context = createContext();
    loadDownload(context);

    const result = await context.downloadMarkdown('content', '   ');

    assertJsonEqual(result, {
      success: true,
      filename: '2026-06-02-Untitled-1780000000000.md'
    });
  });

  await test('returns NO_CONTENT when markdown is null undefined or empty string', async () => {
    const context = createContext();
    loadDownload(context);

    assertJsonEqual(await context.downloadMarkdown(null, 'Title'), {
      success: false,
      error: 'NO_CONTENT'
    });
    assertJsonEqual(await context.downloadMarkdown(undefined, 'Title'), {
      success: false,
      error: 'NO_CONTENT'
    });
    assertJsonEqual(await context.downloadMarkdown('', 'Title'), {
      success: false,
      error: 'NO_CONTENT'
    });
    assert.strictEqual(context.appended.length, 0);
  });

  await test('returns DOWNLOAD_FAILED when download operations throw', async () => {
    const context = createContext({
      document: {
        body: {
          appendChild() {
            throw new Error('append failed');
          },
          removeChild() {}
        },
        createElement() {
          return {
            style: {},
            click() {}
          };
        }
      }
    });
    loadDownload(context);

    const result = await context.downloadMarkdown('content', 'Title');

    assertJsonEqual(result, {
      success: false,
      error: 'DOWNLOAD_FAILED'
    });
  });
})();
