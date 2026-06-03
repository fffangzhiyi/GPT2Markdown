'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(overrides = {}) {
  const commandListeners = [];
  const runtimeListeners = [];
  const sentMessages = [];
  const badgeTexts = [];
  const storageState = {
    exportHistory: []
  };

  const context = {
    console,
    Date: {
      now: () => 1780000000000
    },
    setTimeout(callback, delay) {
      context.timeout = {
        callback,
        delay
      };
      return 1;
    },
    chrome: {
      commands: {
        onCommand: {
          addListener(listener) {
            commandListeners.push(listener);
          }
        }
      },
      tabs: {
        query: async () => [
          {
            id: 123,
            url: 'https://chatgpt.com/c/abc'
          }
        ],
        sendMessage: async (tabId, message) => {
          sentMessages.push({
            tabId,
            message
          });
          return {
            action: 'exportResult',
            status: 'success',
            detail: {
              filename: '2026-06-02-Title.md',
              title: 'Title'
            }
          };
        }
      },
      action: {
        setBadgeText: async (payload) => {
          badgeTexts.push(payload.text);
        }
      },
      storage: {
        sync: {
          get: async (key) => {
            if (typeof key === 'string') {
              return {
                [key]: storageState[key]
              };
            }

            return {
              exportHistory: storageState.exportHistory
            };
          },
          set: async (value) => {
            Object.assign(storageState, value);
          }
        }
      },
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          }
        }
      }
    },
    commandListeners,
    runtimeListeners,
    sentMessages,
    badgeTexts,
    storageState,
    ...overrides
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadBackground(context) {
  const source = fs.readFileSync('background.js', 'utf8');
  vm.runInContext(source, context);
}

async function sendRuntimeMessage(context, message) {
  let response;
  const keepAlive = context.runtimeListeners[0](message, {}, (value) => {
    response = value;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    keepAlive,
    response
  };
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
  await test('keyboard command sends export message and saves successful record', async () => {
    const context = createContext();
    loadBackground(context);

    await context.commandListeners[0]('export-conversation');

    assertJsonEqual(context.sentMessages[0], {
      tabId: 123,
      message: {
        action: 'exportCurrentConversation'
      }
    });
    assertJsonEqual(context.storageState.exportHistory, [
      {
        timestamp: 1780000000000,
        filename: '2026-06-02-Title.md',
        title: 'Title'
      }
    ]);
  });

  await test('keyboard command ignores unrelated command names', async () => {
    const context = createContext();
    loadBackground(context);

    await context.commandListeners[0]('other-command');

    assert.strictEqual(context.sentMessages.length, 0);
    assert.strictEqual(context.storageState.exportHistory.length, 0);
  });

  await test('keyboard command shows badge on non ChatGPT page and clears it after two seconds', async () => {
    const context = createContext();
    context.chrome.tabs.query = async () => [
      {
        id: 123,
        url: 'https://example.com/'
      }
    ];
    context.chrome.tabs.sendMessage = async () => {
      throw new Error('should not send');
    };
    loadBackground(context);

    await context.commandListeners[0]('export-conversation');

    assertJsonEqual(context.badgeTexts, ['!']);
    assert.strictEqual(context.timeout.delay, 2000);
    await context.timeout.callback();
    assertJsonEqual(context.badgeTexts, ['!', '']);
    assert.strictEqual(context.sentMessages.length, 0);
  });

  await test('getExportStatus returns latest export record', async () => {
    const context = createContext();
    context.storageState.exportHistory = [
      {
        timestamp: 123,
        filename: 'latest.md',
        title: 'Latest'
      }
    ];
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'getExportStatus'
    });

    assert.strictEqual(result.keepAlive, true);
    assertJsonEqual(result.response, {
      lastExportTime: 123,
      lastExportFilename: 'latest.md'
    });
  });

  await test('getExportStatus returns empty values when history is empty', async () => {
    const context = createContext();
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'getExportStatus'
    });

    assertJsonEqual(result.response, {
      lastExportTime: null,
      lastExportFilename: ''
    });
  });

  await test('popup export sends message to active tab, saves record, and returns response', async () => {
    const context = createContext();
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assert.strictEqual(result.keepAlive, true);
    assertJsonEqual(result.response, {
      action: 'exportResult',
      status: 'success',
      detail: {
        filename: '2026-06-02-Title.md',
        title: 'Title'
      }
    });
    assert.strictEqual(context.storageState.exportHistory.length, 1);
  });

  await test('popup export returns NOT_ON_CHATGPT_PAGE outside ChatGPT', async () => {
    const context = createContext();
    context.chrome.tabs.query = async () => [
      {
        id: 123,
        url: 'https://example.com/'
      }
    ];
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assertJsonEqual(result.response, {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'NOT_ON_CHATGPT_PAGE'
      }
    });
  });

  await test('popup export returns CONTENT_SCRIPT_NOT_READY when tab messaging fails', async () => {
    const context = createContext();
    context.chrome.tabs.sendMessage = async () => {
      throw new Error('not ready');
    };
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assertJsonEqual(result.response, {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'CONTENT_SCRIPT_NOT_READY'
      }
    });
  });

  await test('saveExportRecord keeps only latest ten records', async () => {
    const context = createContext();
    context.storageState.exportHistory = Array.from({
      length: 10
    }, (_, index) => ({
      timestamp: index,
      filename: 'old-' + index + '.md',
      title: 'Old ' + index
    }));
    loadBackground(context);

    await context.commandListeners[0]('export-conversation');

    assert.strictEqual(context.storageState.exportHistory.length, 10);
    assert.strictEqual(context.storageState.exportHistory[0].filename, '2026-06-02-Title.md');
    assert.strictEqual(context.storageState.exportHistory[9].filename, 'old-8.md');
  });

  await test('ignores empty runtime messages', async () => {
    const context = createContext();
    loadBackground(context);

    const result = await sendRuntimeMessage(context, null);

    assert.strictEqual(result.keepAlive, false);
    assert.strictEqual(result.response, undefined);
  });
})();
