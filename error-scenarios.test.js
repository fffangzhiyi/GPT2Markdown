'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createElement(id) {
  return {
    id,
    textContent: '',
    disabled: false,
    hidden: true,
    className: '',
    classList: {
      values: new Set(),
      add(value) {
        this.values.add(value);
      },
      remove(value) {
        this.values.delete(value);
      }
    },
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    click() {
      if (this.listeners.click) {
        this.listeners.click({
          preventDefault() {}
        });
      }
    }
  };
}

function createContext(exportResponse) {
  const elements = {
    'full-export-btn': createElement('full-export-btn'),
    'select-export-btn': createElement('select-export-btn'),
    'batch-export-btn': createElement('batch-export-btn'),
    'conversation-actions': createElement('conversation-actions'),
    'history-actions': createElement('history-actions'),
    'other-message': createElement('other-message'),
    'voice-warning': createElement('voice-warning'),
    status: createElement('status'),
    'last-export': createElement('last-export'),
    'settings-link': createElement('settings-link')
  };
  elements['full-export-btn'].textContent = '全量导出';

  const context = {
    console,
    Date,
    document: {
      getElementById(id) {
        return elements[id];
      }
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          if (message.action === 'getExportStatus') {
            callback({
              lastExportTime: null,
              lastExportFilename: '',
              pageContext: 'conversation'
            });
            return;
          }
          callback(exportResponse);
        },
        openOptionsPage() {}
      }
    },
    window: {
      close() {}
    },
    elements
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadPopup(context) {
  const source = fs.readFileSync('popup/popup.js', 'utf8');
  vm.runInContext(source, context);
}

function createErrorResponse(error) {
  return {
    action: 'exportResult',
    status: 'error',
    detail: {
      error
    }
  };
}

function runExportScenario(response) {
  const context = createContext(response);
  loadPopup(context);
  context.elements['full-export-btn'].click();
  return context;
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
  await test('API timeout shows Chinese popup message', () => {
    const context = runExportScenario(createErrorResponse('TIMEOUT'));

    assert.strictEqual(context.elements.status.textContent, '请求超时，请重试');
  });

  await test('download failure shows download error popup message', () => {
    const context = runExportScenario(createErrorResponse('DOWNLOAD_FAILED'));

    assert.strictEqual(context.elements.status.textContent, '文件下载失败，请检查下载权限');
  });

  await test('empty content shows no content popup message', () => {
    const context = runExportScenario(createErrorResponse('NO_CONTENT'));

    assert.strictEqual(context.elements.status.textContent, '对话内容为空，无法导出');
  });
})();
