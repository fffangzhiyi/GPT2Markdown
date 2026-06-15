'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createElement(id, tagName = 'div') {
  const element = {
    id,
    tagName: tagName.toUpperCase(),
    textContent: '',
    href: '',
    disabled: false,
    hidden: true,
    className: '',
    checked: false,
    type: '',
    dataset: {},
    children: [],
    parentNode: null,
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
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    replaceChildren() {
      this.children = Array.from(arguments);
      for (const child of this.children) {
        child.parentNode = this;
      }
    },
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
  return element;
}

function descendants(element) {
  const result = [];
  for (const child of element.children) {
    result.push(child);
    result.push(...descendants(child));
  }
  return result;
}

function createContext(responses = {}) {
  const elements = {
    'main-view': createElement('main-view'),
    'export-btn': createElement('export-btn', 'button'),
    'full-export-btn': createElement('full-export-btn', 'button'),
    'select-export-btn': createElement('select-export-btn', 'button'),
    'batch-export-btn': createElement('batch-export-btn', 'button'),
    'conversation-actions': createElement('conversation-actions'),
    'history-actions': createElement('history-actions'),
    'other-message': createElement('other-message'),
    'voice-warning': createElement('voice-warning'),
    status: createElement('status'),
    'last-export': createElement('last-export'),
    'settings-link': createElement('settings-link'),
    'batch-panel': createElement('batch-panel'),
    'batch-list': createElement('batch-list'),
    'batch-empty': createElement('batch-empty'),
    'batch-selected-count': createElement('batch-selected-count'),
    'start-batch-export-btn': createElement('start-batch-export-btn', 'button'),
    'reload-list-btn': createElement('reload-list-btn', 'button'),
    'back-btn': createElement('back-btn', 'button'),
    'batch-status': createElement('batch-status')
  };
  elements['main-view'].hidden = false;
  elements['batch-panel'].hidden = true;
  elements['batch-empty'].hidden = true;
  elements['export-btn'].textContent = '导出当前对话';
  elements['full-export-btn'].textContent = '全量导出';
  elements['select-export-btn'].textContent = '选择导出';
  elements['batch-export-btn'].textContent = '批量导出';
  elements['batch-selected-count'].textContent = '已选择 0 条';
  elements['start-batch-export-btn'].textContent = '导出已选';
  elements['start-batch-export-btn'].disabled = true;
  elements['reload-list-btn'].textContent = '重新读取';
  elements['back-btn'].textContent = '返回';

  const sentMessages = [];
  const tabQueries = [];
  const tabMessages = [];
  const openedOptionsPages = [];
  const closedWindows = [];
  const createdWindows = [];
  const body = createElement('body', 'body');
  const context = {
    console,
    Date,
    Map,
    Array,
    document: {
      body,
      getElementById(id) {
        return elements[id];
      },
      createElement(tagName) {
        return createElement('', tagName);
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
      },
      tabs: {
        query(queryInfo, callback) {
          tabQueries.push(queryInfo);
          callback(responses.tabs || [
            {
              id: 123,
              url: 'https://chatgpt.com/'
            }
          ]);
        },
        sendMessage(tabId, message, callback) {
          tabMessages.push({
            tabId,
            message
          });
          const response = responses[message.action];
          if (typeof response === 'function') {
            response(callback);
            return;
          }
          if (callback) {
            callback(response);
          }
        }
      },
      windows: {
        create(options) {
          createdWindows.push(options);
        }
      }
    },
    window: {
      close() {
        closedWindows.push(true);
      }
    },
    elements,
    body,
    sentMessages,
    tabQueries,
    tabMessages,
    openedOptionsPages,
    closedWindows,
    createdWindows
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
    assert.strictEqual(context.elements['history-actions'].hidden, false);
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

  await test('popup contains an inline batch selection view', () => {
    const html = fs.readFileSync('popup/popup.html', 'utf8');
    const css = fs.readFileSync('popup/popup.css', 'utf8');

    assert.ok(html.includes('id="main-view"'));
    assert.ok(html.includes('id="batch-panel"'));
    assert.ok(html.includes('id="batch-list"'));
    assert.ok(html.includes('id="start-batch-export-btn"'));
    assert.ok(html.includes('id="back-btn"'));
    assert.ok(!html.includes('batch.html'));
    assert.ok(css.includes('body.batch-mode'));
    assert.ok(css.includes('width: 380px'));
    assert.ok(css.includes('height: 360px'));
    assert.strictEqual(fs.existsSync('popup/batch.html'), false);
    assert.strictEqual(fs.existsSync('popup/batch.js'), false);
  });

  await test('batch button switches the current popup to a larger batch view', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      },
      getBatchConversations: {
        status: 'success',
        detail: {
          items: []
        }
      }
    });

    loadPopup(context);
    context.elements['batch-export-btn'].click();

    assert.strictEqual(context.elements['main-view'].hidden, true);
    assert.strictEqual(context.elements['batch-panel'].hidden, false);
    assert.strictEqual(context.body.classList.contains('batch-mode'), true);
    assertJsonEqual(context.tabQueries, [
      {
        active: true,
        url: 'https://chatgpt.com/*'
      }
    ]);
    assertJsonEqual(context.tabMessages, [
      {
        tabId: 123,
        message: {
          action: 'getBatchConversations'
        }
      }
    ]);
    assert.strictEqual(context.createdWindows.length, 0);
    assert.strictEqual(context.closedWindows.length, 0);
  });

  await test('batch view renders unchecked conversations grouped by project', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      },
      getBatchConversations: {
        status: 'success',
        detail: {
          items: [
            {
              id: 'project-chat',
              title: 'Project Chat',
              projectKey: 'g-p-vibecoding',
              projectTitle: 'VibeCoding'
            },
            {
              id: 'regular-chat',
              title: 'Regular Chat',
              projectKey: '',
              projectTitle: '未分组对话'
            }
          ]
        }
      }
    });

    loadPopup(context);
    context.elements['batch-export-btn'].click();

    const groups = context.elements['batch-list'].children;
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].children[0].textContent, 'VibeCoding');
    assert.strictEqual(groups[1].children[0].textContent, '未分组对话');

    const inputs = descendants(context.elements['batch-list'])
      .filter((element) => element.tagName === 'INPUT');
    assert.strictEqual(inputs.length, 2);
    assert.strictEqual(inputs[0].checked, false);
    assert.strictEqual(inputs[1].checked, false);
    assert.strictEqual(context.elements['start-batch-export-btn'].disabled, true);
  });

  await test('batch view exports only checked conversations', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      },
      getBatchConversations: {
        status: 'success',
        detail: {
          items: [
            {
              id: 'conversation-1',
              title: 'First Chat',
              projectKey: '',
              projectTitle: '未分组对话'
            },
            {
              id: 'conversation-2',
              title: 'Second Chat',
              projectKey: '',
              projectTitle: '未分组对话'
            }
          ]
        }
      },
      startBatchExport: {
        status: 'success'
      }
    });

    loadPopup(context);
    context.elements['batch-export-btn'].click();

    const inputs = descendants(context.elements['batch-list'])
      .filter((element) => element.tagName === 'INPUT');
    inputs[1].checked = true;
    inputs[1].listeners.change.call(inputs[1]);
    context.elements['start-batch-export-btn'].click();

    assertJsonEqual(context.tabMessages[1], {
      tabId: 123,
      message: {
        action: 'startBatchExport',
        items: [
          {
            id: 'conversation-2',
            title: 'Second Chat'
          }
        ]
      }
    });
    assert.strictEqual(context.closedWindows.length, 1);
  });

  await test('back button restores the compact popup view', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      },
      getBatchConversations: {
        status: 'success',
        detail: {
          items: []
        }
      }
    });

    loadPopup(context);
    context.elements['batch-export-btn'].click();
    context.elements['back-btn'].click();

    assert.strictEqual(context.elements['main-view'].hidden, false);
    assert.strictEqual(context.elements['batch-panel'].hidden, true);
    assert.strictEqual(context.body.classList.contains('batch-mode'), false);
    assert.strictEqual(context.closedWindows.length, 0);
  });

  await test('empty batch view can reload the DOM conversation list', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      },
      getBatchConversations: {
        status: 'success',
        detail: {
          items: []
        }
      }
    });

    loadPopup(context);
    context.elements['batch-export-btn'].click();

    assert.strictEqual(context.elements['batch-empty'].hidden, false);
    assert.strictEqual(
      context.elements['batch-empty'].textContent,
      '未读取到对话，请先完全展开 ChatGPT 对话列表后重新读取。'
    );

    context.elements['reload-list-btn'].click();
    assert.strictEqual(context.tabMessages.length, 2);
  });

  await test('batch view shows an error when no active ChatGPT tab is available', () => {
    const context = createContext({
      tabs: [],
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'history'
      }
    });

    loadPopup(context);
    context.elements['batch-export-btn'].click();

    assert.strictEqual(context.tabMessages.length, 0);
    assert.strictEqual(context.elements['batch-status'].textContent, '未找到 ChatGPT 页面');
    assert.strictEqual(context.elements['batch-status'].className, 'batch-status error');
  });

  await test('popup initializes when optional batch controls are absent', () => {
    const context = createContext({
      getExportStatus: {
        lastExportTime: null,
        lastExportFilename: '',
        pageContext: 'conversation'
      }
    });
    delete context.elements['start-batch-export-btn'];
    delete context.elements['reload-list-btn'];
    delete context.elements['back-btn'];

    assert.doesNotThrow(() => loadPopup(context));
  });
})();
