'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createElement(id) {
  const element = {
    id,
    value: '',
    textContent: '',
    className: '',
    checked: false,
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

  element.classList = {
    add(value) {
      element.className = value;
    },
    remove(value) {
      if (element.className === value) {
        element.className = '';
      }
    }
  };

  return element;
}

function createRadioElement(id, value) {
  const element = createElement(id);
  element.type = 'radio';
  element.name = 'saveMode';
  element.value = value;
  return element;
}

function createContext(storageState = {}) {
  const elements = {
    'folder-name': createElement('folder-name'),
    'folder-preview': createElement('folder-preview'),
    'save-button': createElement('save-button'),
    'save-status': createElement('save-status'),
    'history-list': createElement('history-list'),
    'history-loading': createElement('history-loading'),
    'save-mode-ask': createRadioElement('save-mode-ask', 'ask'),
    'save-mode-auto': createRadioElement('save-mode-auto', 'auto'),
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
  await test('loads saveMode=ask, hides folder section, no preview text', async () => {
    const context = createContext({
      settings: {
        saveMode: 'ask',
        folderName: 'my-exports'
      },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);

    assert.strictEqual(context.elements['save-mode-ask'].checked, true);
    assert.strictEqual(context.elements['save-mode-auto'].checked, false);
    assert.strictEqual(context.elements['folder-section'].className, 'hidden');
    assert.strictEqual(context.elements['folder-preview'].textContent, '');
  });

  await test('loads saveMode=auto, shows folder section with preview', async () => {
    const context = createContext({
      settings: {
        saveMode: 'auto',
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

    assert.strictEqual(context.elements['save-mode-auto'].checked, true);
    assert.strictEqual(context.elements['save-mode-ask'].checked, false);
    assert.strictEqual(context.elements['folder-section'].className, '');
    assert.strictEqual(context.elements['folder-name'].value, 'custom-folder');
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/custom-folder/');
  });

  await test('defaults to saveMode=ask when settings missing', async () => {
    const context = createContext({
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);

    assert.strictEqual(context.elements['save-mode-ask'].checked, true);
    assert.strictEqual(context.elements['folder-section'].className, 'hidden');
  });

  await test('switch to auto saves saveMode and shows folder section', async () => {
    const context = createContext({
      settings: {
        saveMode: 'ask',
        folderName: 'chatgpt-inbox'
      },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);

    context.elements['save-mode-auto'].checked = true;
    await context.elements['save-mode-auto'].listeners.change();

    assertJsonEqual(context.setCalls[0], {
      settings: {
        saveMode: 'auto',
        folderName: 'chatgpt-inbox'
      }
    });
    assert.strictEqual(context.elements['folder-section'].className, '');
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/chatgpt-inbox/');
  });

  await test('switch to ask saves saveMode and hides folder section', async () => {
    const context = createContext({
      settings: {
        saveMode: 'auto',
        folderName: 'chatgpt-inbox'
      },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);

    context.elements['save-mode-ask'].checked = true;
    await context.elements['save-mode-ask'].listeners.change();

    assertJsonEqual(context.setCalls[0], {
      settings: {
        saveMode: 'ask',
        folderName: 'chatgpt-inbox'
      }
    });
    assert.strictEqual(context.elements['folder-section'].className, 'hidden');
    assert.strictEqual(context.elements['folder-preview'].textContent, '');
  });

  await test('saves folderName preserves existing saveMode', async () => {
    const context = createContext({
      settings: {
        saveMode: 'auto',
        folderName: 'old-folder'
      },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);
    context.elements['folder-name'].value = '  new-folder  ';

    await context.elements['save-button'].click();

    assertJsonEqual(context.setCalls[0], {
      settings: {
        saveMode: 'auto',
        folderName: 'new-folder'
      }
    });
    assert.strictEqual(context.elements['folder-name'].value, 'new-folder');
    assert.strictEqual(context.elements['folder-preview'].textContent, '文件保存到: 下载/new-folder/');
  });

  await test('shows warning for empty folderName', async () => {
    const context = createContext({
      settings: {
        saveMode: 'auto'
      },
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);
    context.elements['folder-name'].value = '   ';

    await context.elements['save-button'].click();

    assert.strictEqual(context.setCalls.length, 0);
    assert.strictEqual(context.elements['save-status'].textContent, '⚠️ 文件夹名称不能为空');
  });

  await test('shows no history message when empty', async () => {
    const context = createContext({
      exportHistory: []
    });
    loadSettings(context);
    await initialize(context);

    assert.strictEqual(context.elements['history-list'].children.length, 1);
    assert.strictEqual(context.elements['history-list'].children[0].textContent, '暂无导出记录');
  });
})();
