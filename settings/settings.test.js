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
    attributes: {},
    classList: {
      _classes: [],
      add(cls) { if (!this._classes.includes(cls)) this._classes.push(cls); },
      remove(cls) { this._classes = this._classes.filter(c => c !== cls); },
      contains(cls) { return this._classes.includes(cls); }
    },
    appendChild(child) {
      this.children.push(child);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name] || null;
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
    'mode-card-ask': createElement('mode-card-ask'),
    'mode-card-auto': createElement('mode-card-auto'),
    'folder-section': createElement('folder-section')
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
              return { [key]: storageState[key] };
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
      timeouts.push({ callback, delay });
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
  await test('loads saveMode=ask, hides folder section, marks ask card selected', async () => {
    const context = createContext({
      settings: { saveMode: 'ask', folderName: 'my-exports' },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);

    assert.strictEqual(context.elements['mode-card-ask'].getAttribute('aria-checked'), 'true');
    assert.strictEqual(context.elements['mode-card-auto'].getAttribute('aria-checked'), 'false');
    assert.strictEqual(context.elements['folder-section'].classList.contains('hidden'), true);
    assert.strictEqual(context.elements['folder-preview'].textContent, '');
  });

  await test('loads saveMode=auto, shows folder section with preview', async () => {
    const context = createContext({
      settings: { saveMode: 'auto', folderName: 'custom-folder' },
      exportHistory: [
        { timestamp: 1780000000000, filename: 'test.md', title: 'Test Chat' }
      ]
    });
    loadSettings(context);
    await initialize(context);

    assert.strictEqual(context.elements['mode-card-auto'].getAttribute('aria-checked'), 'true');
    assert.strictEqual(context.elements['mode-card-ask'].getAttribute('aria-checked'), 'false');
    assert.strictEqual(context.elements['folder-section'].classList.contains('hidden'), false);
    assert.strictEqual(context.elements['folder-name'].value, 'custom-folder');
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/custom-folder/');
  });

  await test('defaults to saveMode=ask when settings missing', async () => {
    const context = createContext({ exportHistory: [] });
    loadSettings(context);
    await initialize(context);

    assert.strictEqual(context.elements['mode-card-ask'].getAttribute('aria-checked'), 'true');
    assert.strictEqual(context.elements['folder-section'].classList.contains('hidden'), true);
  });

  await test('clicking auto card saves saveMode and shows folder section', async () => {
    const context = createContext({
      settings: { saveMode: 'ask', folderName: 'chatgpt-inbox' },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);

    await context.elements['mode-card-auto'].click();

    assert.strictEqual(context.elements['mode-card-auto'].getAttribute('aria-checked'), 'true');
    assert.strictEqual(context.elements['mode-card-ask'].getAttribute('aria-checked'), 'false');
    assertJsonEqual(context.setCalls[0], {
      settings: { saveMode: 'auto', folderName: 'chatgpt-inbox' }
    });
    assert.strictEqual(context.elements['folder-section'].classList.contains('hidden'), false);
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/chatgpt-inbox/');
  });

  await test('clicking ask card saves saveMode and hides folder section', async () => {
    const context = createContext({
      settings: { saveMode: 'auto', folderName: 'chatgpt-inbox' },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);

    await context.elements['mode-card-ask'].click();

    assert.strictEqual(context.elements['mode-card-ask'].getAttribute('aria-checked'), 'true');
    assert.strictEqual(context.elements['mode-card-auto'].getAttribute('aria-checked'), 'false');
    assertJsonEqual(context.setCalls[0], {
      settings: { saveMode: 'ask', folderName: 'chatgpt-inbox' }
    });
    assert.strictEqual(context.elements['folder-section'].classList.contains('hidden'), true);
    assert.strictEqual(context.elements['folder-preview'].textContent, '');
  });

  await test('saves folderName preserves existing saveMode', async () => {
    const context = createContext({
      settings: { saveMode: 'auto', folderName: 'old-folder' },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);
    context.elements['folder-name'].value = '  new-folder  ';

    await context.elements['save-button'].click();

    assertJsonEqual(context.setCalls[0], {
      settings: { saveMode: 'auto', folderName: 'new-folder' }
    });
    assert.strictEqual(context.elements['folder-name'].value, 'new-folder');
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/new-folder/');
  });

  await test('shows warning for empty folderName', async () => {
    const context = createContext({
      settings: { saveMode: 'auto' },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);
    context.elements['folder-name'].value = '   ';

    await context.elements['save-button'].click();

    assert.strictEqual(context.setCalls.length, 0);
    assert.strictEqual(context.elements['save-status'].textContent, '文件夹名称不能为空');
  });

  await test('shows no history message when empty', async () => {
    const context = createContext({ exportHistory: [] });
    loadSettings(context);
    await initialize(context);

    assert.strictEqual(context.elements['history-list'].children.length, 1);
    assert.strictEqual(context.elements['history-list'].children[0].textContent, '暂无导出记录');
  });
})();
