'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createElement(id) {
  return {
    id,
    textContent: '',
    href: '',
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
      },
      contains(value) {
        return this.values.has(value);
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

function createContext(responses = {}) {
  const elements = {
    'export-btn': createElement('export-btn'),
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
  elements['export-btn'].textContent = '导出当前对话';
  elements['full-export-btn'].textContent = '全量导出';
  elements['select-export-btn'].textContent = '选择导出';
  elements['batch-export-btn'].textContent = '批量导出';

  const sentMessages = [];
  const openedOptionsPages = [];
  const closedWindows = [];
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
          sentMessages.push(message);
          const response = responses[message.action];
          if (typeof response === 'function') {
            response(callback);
            return;
          }
          if (callback) {
            callback(response);
          }
        },
        openOptionsPage() {
          openedOptionsPages.push(true);
        }
      }
    },
    window: {
      close() {
        closedWindows.push(true);
      }
    },
    elements,
    sentMessages,
    openedOptionsPages,
    closedWindows
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadPopup(context) {
  const source = fs.readFileSync('popup/popup.js', 'utf8');
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
  await test('loads last export status on init', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: new Date('2026-06-02T20:30:00').getTime(),
        lastExportFilename: 'file.md',
        pageContext: 'conversation'
      }
    });

    loadPopup(context);

    assertJsonEqual(context.sentMessages[0], {
      action: 'getExportStatus'
    });
    assert.strictEqual(context.elements['last-export'].textContent, '上次导出: 2026-06-02 20:30');
    assertJsonEqual(context.sentMessages[1], {
      action: 'prefetchConversation'
    });
  });

  await test('does not prefetch outside a conversation page', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      }
    });

    loadPopup(context);

    assertJsonEqual(context.sentMessages, [
      {
        action: 'getExportStatus'
      }
    ]);
  });

  await test('shows empty export history label when no record exists', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'conversation'
      }
    });

    loadPopup(context);

    assert.strictEqual(context.elements['last-export'].textContent, '暂无导出记录');
  });

  await test('exports current conversation and shows success filename', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: ''
      },
      exportCurrentConversation: {
        action: 'exportResult',
        status: 'success',
        detail: {
          filename: '2026-06-02-Title.md'
        }
      }
    });

    loadPopup(context);
    context.elements['full-export-btn'].click();

    assertJsonEqual(context.sentMessages[1], {
      action: 'exportCurrentConversation'
    });
    assert.strictEqual(context.elements['full-export-btn'].disabled, false);
    assert.strictEqual(context.elements['full-export-btn'].textContent, '全量导出');
    assert.strictEqual(context.elements.status.textContent, '✅ 已导出: 2026-06-02-Title.md');
    assert.strictEqual(context.elements.status.className, 'status success');
    assert.strictEqual(context.elements['voice-warning'].textContent, '');
    assert.strictEqual(context.elements['voice-warning'].className, 'voice-warning');
    assertJsonEqual(context.sentMessages[2], {
      action: 'getExportStatus'
    });
  });

  await test('shows voice export warning when unsupported content was replaced', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'conversation'
      },
      exportCurrentConversation: {
        action: 'exportResult',
        status: 'success',
        detail: {
          filename: '2026-06-02-Voice.md',
          hasUnsupportedContent: true
        }
      }
    });

    loadPopup(context);
    context.elements['full-export-btn'].click();

    assert.strictEqual(
      context.elements['voice-warning'].textContent,
      '目前不支持语音消息导出，语音消息将被占位符替换。'
    );
    assert.strictEqual(context.elements['voice-warning'].className, 'voice-warning visible');
  });

  await test('sets loading state before async export response resolves', () => {
    let exportCallback;
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'conversation'
      },
      exportCurrentConversation(callback) {
        exportCallback = callback;
      }
    });

    loadPopup(context);
    context.elements['full-export-btn'].click();

    assert.strictEqual(context.elements['full-export-btn'].disabled, true);
    assert.strictEqual(context.elements['full-export-btn'].textContent, '导出中...');
    assert.strictEqual(context.elements['full-export-btn'].classList.contains('loading'), true);

    exportCallback({
      action: 'exportResult',
      status: 'success',
      detail: {
        filename: 'done.md'
      }
    });

    assert.strictEqual(context.elements['full-export-btn'].disabled, false);
    assert.strictEqual(context.elements['full-export-btn'].classList.contains('loading'), false);
  });

  await test('maps export error codes to Chinese messages', () => {
    const cases = [
      ['NOT_ON_CHATGPT_PAGE', '请在 ChatGPT 对话页面使用'],
      ['CONTENT_SCRIPT_NOT_READY', '请刷新页面后重试'],
      ['NETWORK_ERROR', '网络请求失败，请检查登录状态'],
      ['UNAUTHORIZED', '请先登录 ChatGPT'],
      ['TIMEOUT', '请求超时，请重试'],
      ['RATE_LIMITED', '请求过于频繁，请稍后重试'],
      ['OTHER', '导出失败，请重试']
    ];

    for (const [error, message] of cases) {
      const context = createContext({
        getExportStatus: {
          lastExportTime: null,
          lastExportFilename: '',
          pageContext: 'conversation'
        },
        exportCurrentConversation: {
          action: 'exportResult',
          status: 'error',
          detail: {
            error
          }
        }
      });

      loadPopup(context);
      context.elements['full-export-btn'].click();

      assert.strictEqual(context.elements.status.textContent, message);
      assert.strictEqual(context.elements.status.className, 'status error');
    }
  });

  await test('opens options page from settings link', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'conversation'
      }
    });

    loadPopup(context);
    context.elements['settings-link'].click();

    assert.strictEqual(context.openedOptionsPages.length, 1);
  });

  await test('shows conversation actions on a conversation page', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'conversation'
      }
    });

    loadPopup(context);

    assert.strictEqual(context.elements['conversation-actions'].hidden, false);
    assert.strictEqual(context.elements['history-actions'].hidden, true);
    assert.strictEqual(context.elements['other-message'].hidden, true);
  });

  await test('shows batch actions on ChatGPT history', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      }
    });

    loadPopup(context);

    assert.strictEqual(context.elements['conversation-actions'].hidden, true);
    assert.strictEqual(context.elements['history-actions'].hidden, false);
    assert.strictEqual(context.elements['other-message'].hidden, true);
  });

  await test('shows usage hint outside ChatGPT', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'other'
      }
    });

    loadPopup(context);

    assert.strictEqual(context.elements['conversation-actions'].hidden, true);
    assert.strictEqual(context.elements['history-actions'].hidden, true);
    assert.strictEqual(context.elements['other-message'].hidden, false);
  });

  await test('selection button enters selection mode and closes popup', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'conversation'
      },
      enterSelectionMode: {
        status: 'success'
      }
    });

    loadPopup(context);
    context.elements['select-export-btn'].click();

    assertJsonEqual(context.sentMessages.slice(2), [
      {
        action: 'enterSelectionMode'
      }
    ]);
    assert.strictEqual(context.closedWindows.length, 1);
  });

  await test('batch button shows development status without messaging or closing', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      }
    });

    loadPopup(context);
    context.elements['batch-export-btn'].click();

    assertJsonEqual(context.sentMessages, [
      {
        action: 'getExportStatus'
      }
    ]);
    assert.strictEqual(context.closedWindows.length, 0);
    assert.strictEqual(context.elements.status.textContent, '此功能开发中，即将上线');
    assert.strictEqual(context.elements.status.className, 'status success');
  });
})();
