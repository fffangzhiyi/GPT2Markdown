'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    className: '',
    children: [],
    listeners: {},
    appendChild(child) {
      this.children.push(child);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    click() {
      if (this.listeners.click) {
        return this.listeners.click();
      }
    }
  };
}

function createContext(storageState = {}) {
  const elements = {
    'folder-name': createElement('folder-name'),
    'folder-preview': createElement('folder-preview'),
    'save-button': createElement('save-button'),
    'save-status': createElement('save-status'),
    'history-list': createElement('history-list'),
    'history-loading': createElement('history-loading')
  };
  const documentListeners = {};
  const setCalls = [];
  const timeouts = [];
  const context = {
    console,
    Date,
    document: {
      addEventListener(type, listener) {
        documentListeners[type] = listener;
      },
      getElementById(id) {
        return elements[id];
      },
      createElement() {
        return createElement('');
      }
    },
    chrome: {
      storage: {
        sync: {
          async get(key) {
            if (typeof key === 'string') {
              return {
                [key]: storageState[key]
              };
            }
            return storageState;
          },
          async set(value) {
            setCalls.push(value);
            Object.assign(storageState, value);
          }
        }
      }
    },
    setTimeout(callback, delay) {
      timeouts.push({
        callback,
        delay
      });
      return timeouts.length;
    },
    elements,
    documentListeners,
    setCalls,
    timeouts
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadSettings(context) {
  const source = fs.readFileSync('settings/settings.js', 'utf8');
  vm.runInContext(source, context);
}

async function initialize(context) {
  await context.documentListeners.DOMContentLoaded();
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
  await test('loads folderName and exportHistory on init', async () => {
    const context = createContext({
      settings: {
        folderName: 'custom-folder'
      },
      exportHistory: [
        {
          timestamp: 1780000000000,
          filename: 'test.md',
          title: 'Test Chat'
        }
      ]
    });
    loadSettings(context);

    await initialize(context);

    assert.strictEqual(context.elements['folder-name'].value, 'custom-folder');
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/custom-folder/');
    assert.strictEqual(context.elements['history-list'].children.length, 1);
    assert.strictEqual(context.elements['history-list'].children[0].textContent, '2026-05-29 04:26 · Test Chat');
  });

  await test('uses default folderName when not set', async () => {
    const context = createContext({
      exportHistory: []
    });
    loadSettings(context);

    await initialize(context);

    assert.strictEqual(context.elements['folder-name'].value, 'chatgpt-inbox');
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/chatgpt-inbox/');
  });

  await test('saves folderName on save button click', async () => {
    const context = createContext({
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);
    context.elements['folder-name'].value = '  saved-folder  ';

    await context.elements['save-button'].click();

    assertJsonEqual(context.setCalls[0], {
      settings: {
        folderName: 'saved-folder'
      }
    });
    assert.strictEqual(context.elements['folder-name'].value, 'saved-folder');
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/saved-folder/');
    assert.strictEqual(context.elements['save-status'].textContent, '✅ 已保存');
    assert.strictEqual(context.elements['save-status'].className, 'save-status success');
    assert.strictEqual(context.timeouts[0].delay, 2000);
  });

  await test('shows warning for empty folderName', async () => {
    const context = createContext({
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);
    context.elements['folder-name'].value = '   ';

    await context.elements['save-button'].click();

    assert.strictEqual(context.setCalls.length, 0);
    assert.strictEqual(context.elements['save-status'].textContent, '⚠️ 文件夹名称不能为空');
    assert.strictEqual(context.elements['save-status'].className, 'save-status error');
  });

  await test('shows no history message when empty', async () => {
    const context = createContext({
      exportHistory: []
    });
    loadSettings(context);

    await initialize(context);

    assert.strictEqual(context.elements['history-list'].children.length, 1);
    assert.strictEqual(context.elements['history-list'].children[0].textContent, '暂无导出记录');
    assert.strictEqual(context.elements['history-list'].children[0].className, 'empty-history');
  });
})();
