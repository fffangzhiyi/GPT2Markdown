'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(overrides = {}) {
  const commandListeners = [];
  const runtimeListeners = [];
  const determiningFilenameListeners = [];
  const sentMessages = [];
  const downloads = [];
  const filenameSuggestions = [];
  const badgeTexts = [];
  const badgeColors = [];
  const markdownDataUrl = 'data:text/markdown;charset=utf-8,%23%20Title%0A';
  const storageState = {
    settings: {
      saveMode: 'auto',
      folderName: 'custom-folder'
    },
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
    URL: {},
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
              title: 'Title',
              markdown: '# Title\n'
            }
          };
        }
      },
      downloads: {
        onDeterminingFilename: {
          addListener(listener) {
            determiningFilenameListeners.push(listener);
          }
        },
        download: async (payload) => {
          downloads.push(payload);
          for (const listener of determiningFilenameListeners) {
            listener({
              id: 456,
              url: payload.url,
              filename: 'download.md'
            }, (suggestion) => {
              filenameSuggestions.push(suggestion || null);
            });
          }
          return 456;
        }
      },
      action: {
        setBadgeText: async (payload) => {
          badgeTexts.push(payload.text);
        },
        setBadgeBackgroundColor: async (payload) => {
          badgeColors.push(payload.color);
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

            if (Array.isArray(key)) {
              return key.reduce((result, item) => {
                result[item] = storageState[item];
                return result;
              }, {});
            }

            if (key && typeof key === 'object') {
              return Object.keys(key).reduce((result, item) => {
                result[item] = storageState[item] === undefined ? key[item] : storageState[item];
                return result;
              }, {});
            }

            return {};
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
    determiningFilenameListeners,
    sentMessages,
    downloads,
    filenameSuggestions,
    markdownDataUrl,
    badgeTexts,
    badgeColors,
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
  await test('auto mode: keyboard command downloads with folder path and saveAs false', async () => {
    const context = createContext();
    loadBackground(context);

    await context.commandListeners[0]('export-conversation');

    assertJsonEqual(context.sentMessages[0], {
      tabId: 123,
      message: {
        action: 'exportCurrentConversation',
        folderName: 'custom-folder'
      }
    });
    assertJsonEqual(context.downloads[0], {
      url: context.markdownDataUrl,
      filename: 'custom-folder/2026-06-02-Title.md',
      saveAs: false
    });
    assertJsonEqual(context.storageState.exportHistory, [
      {
        timestamp: 1780000000000,
        filename: '2026-06-02-Title.md',
        title: 'Title'
      }
    ]);
    assertJsonEqual(context.badgeTexts, ['⏳', '']);
    assertJsonEqual(context.badgeColors, ['#666']);
  });

  await test('ask mode: keyboard command downloads without filename, saveAs true, suggests filename in listener', async () => {
    const context = createContext();
    context.storageState.settings.saveMode = 'ask';
    loadBackground(context);

    await context.commandListeners[0]('export-conversation');

    assertJsonEqual(context.downloads[0], {
      url: context.markdownDataUrl,
      saveAs: true
    });
    assert.strictEqual('filename' in context.downloads[0], false);
    assertJsonEqual(context.filenameSuggestions[context.filenameSuggestions.length - 1], {
      filename: '2026-06-02-Title.md',
      conflictAction: 'uniquify'
    });
    assertJsonEqual(context.storageState.exportHistory, [
      {
        timestamp: 1780000000000,
        filename: '2026-06-02-Title.md',
        title: 'Title'
      }
    ]);
  });

  await test('ask mode: popup export downloads without filename, suggests filename, returns success', async () => {
    const context = createContext();
    context.storageState.settings.saveMode = 'ask';
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
    assertJsonEqual(context.downloads[0], {
      url: context.markdownDataUrl,
      saveAs: true
    });
    assert.strictEqual('filename' in context.downloads[0], false);
  });

  await test('ask mode: popup export preserves unsupported content flag', async () => {
    const context = createContext();
    context.storageState.settings.saveMode = 'ask';
    context.chrome.tabs.sendMessage = async (tabId, message) => {
      context.sentMessages.push({ tabId, message });
      return {
        action: 'exportResult',
        status: 'success',
        detail: {
          filename: '2026-06-02-Voice.md',
          title: 'Voice',
          markdown: '# Voice\n',
          hasUnsupportedContent: true
        }
      };
    };
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assertJsonEqual(result.response, {
      action: 'exportResult',
      status: 'success',
      detail: {
        filename: '2026-06-02-Voice.md',
        title: 'Voice',
        hasUnsupportedContent: true
      }
    });
  });

  await test('onDeterminingFilename passes through non-markdown downloads', async () => {
    const context = createContext();
    loadBackground(context);

    for (const listener of context.determiningFilenameListeners) {
      listener({
        id: 999,
        url: 'https://example.com/file.pdf',
        filename: 'file.pdf'
      }, (suggestion) => {
        context.filenameSuggestions.push(suggestion || null);
      });
    }

    assert.strictEqual(context.filenameSuggestions.length, 1);
    assert.strictEqual(context.filenameSuggestions[0], null);
  });

  await test('missing saveMode defaults to auto with saveAs false', async () => {
    const context = createContext();
    delete context.storageState.settings.saveMode;
    loadBackground(context);

    await context.commandListeners[0]('export-conversation');

    assertJsonEqual(context.downloads[0], {
      url: context.markdownDataUrl,
      filename: 'custom-folder/2026-06-02-Title.md',
      saveAs: false
    });
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

  await test('keyboard command clears loading badge when tab messaging fails', async () => {
    const context = createContext();
    context.chrome.tabs.sendMessage = async () => {
      throw new Error('not ready');
    };
    loadBackground(context);

    await context.commandListeners[0]('export-conversation');

    assertJsonEqual(context.badgeTexts, ['⏳', '']);
    assertJsonEqual(context.badgeColors, ['#666']);
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
      lastExportFilename: 'latest.md',
      pageContext: 'conversation'
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
      lastExportFilename: '',
      pageContext: 'conversation'
    });
  });

  await test('getExportStatus reports history page context', async () => {
    const context = createContext();
    context.chrome.tabs.query = async () => [
      {
        id: 123,
        url: 'https://chatgpt.com/'
      }
    ];
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'getExportStatus'
    });

    assert.strictEqual(result.response.pageContext, 'history');
  });

  await test('getExportStatus reports other page context outside ChatGPT', async () => {
    const context = createContext();
    context.chrome.tabs.query = async () => [
      {
        id: 123,
        url: 'https://example.com/'
      }
    ];
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'getExportStatus'
    });

    assert.strictEqual(result.response.pageContext, 'other');
  });

  await test('enterSelectionMode rejects ChatGPT history pages', async () => {
    const context = createContext();
    context.chrome.tabs.query = async () => [
      {
        id: 123,
        url: 'https://chatgpt.com/'
      }
    ];
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'enterSelectionMode'
    });

    assert.strictEqual(result.keepAlive, true);
    assertJsonEqual(result.response, {
      status: 'error',
      detail: {
        error: 'NOT_A_CONVERSATION_PAGE'
      }
    });
  });

  await test('enterSelectionMode forwards to the active conversation tab', async () => {
    const context = createContext();
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'enterSelectionMode'
    });

    assert.strictEqual(result.keepAlive, true);
    assertJsonEqual(context.sentMessages[0], {
      tabId: 123,
      message: {
        action: 'enterSelectionMode'
      }
    });
    assertJsonEqual(result.response, {
      status: 'success'
    });
  });

  await test('prefetchConversation forwards to the active ChatGPT tab', async () => {
    const context = createContext();
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'prefetchConversation'
    });

    assert.strictEqual(result.keepAlive, false);
    assertJsonEqual(context.sentMessages[0], {
      tabId: 123,
      message: {
        action: 'prefetchConversation'
      }
    });
  });

  await test('enterBatchMode forwards on ChatGPT and reports messaging failures', async () => {
    const context = createContext();
    loadBackground(context);

    const success = await sendRuntimeMessage(context, {
      action: 'enterBatchMode'
    });

    assertJsonEqual(context.sentMessages[0], {
      tabId: 123,
      message: {
        action: 'enterBatchMode'
      }
    });
    assertJsonEqual(success.response, {
      status: 'success'
    });

    context.chrome.tabs.sendMessage = async () => {
      throw new Error('not ready');
    };
    const failure = await sendRuntimeMessage(context, {
      action: 'enterBatchMode'
    });

    assertJsonEqual(failure.response, {
      status: 'error',
      detail: {
        error: 'CONTENT_SCRIPT_NOT_READY'
      }
    });
  });

  await test('processSelectionExportResult downloads selected markdown', async () => {
    const context = createContext();
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'processSelectionExportResult',
      response: {
        action: 'exportResult',
        status: 'success',
        detail: {
          filename: 'Selected.md',
          title: 'Selected',
          markdown: '# Selected\n'
        }
      }
    });

    assert.strictEqual(result.keepAlive, true);
    assertJsonEqual(context.downloads[0], {
      url: 'data:text/markdown;charset=utf-8,%23%20Selected%0A',
      filename: 'custom-folder/Selected.md',
      saveAs: false
    });
    assertJsonEqual(result.response, {
      action: 'exportResult',
      status: 'success',
      detail: {
        filename: 'Selected.md',
        title: 'Selected'
      }
    });
  });

  await test('auto mode: popup export downloads and returns response', async () => {
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
    assertJsonEqual(context.downloads[0], {
      url: context.markdownDataUrl,
      filename: 'custom-folder/2026-06-02-Title.md',
      saveAs: false
    });
    assert.strictEqual(context.storageState.exportHistory.length, 1);
  });

  await test('auto mode: popup export preserves unsupported content flag', async () => {
    const context = createContext();
    context.chrome.tabs.sendMessage = async (tabId, message) => {
      context.sentMessages.push({ tabId, message });
      return {
        action: 'exportResult',
        status: 'success',
        detail: {
          filename: '2026-06-02-Voice.md',
          title: 'Voice',
          markdown: '# Voice\n',
          hasUnsupportedContent: true
        }
      };
    };
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assertJsonEqual(result.response, {
      action: 'exportResult',
      status: 'success',
      detail: {
        filename: '2026-06-02-Voice.md',
        title: 'Voice',
        hasUnsupportedContent: true
      }
    });
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

  await test('auto mode: popup export uses default folder when settings missing', async () => {
    const context = createContext();
    delete context.storageState.settings;
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assert.strictEqual(result.response.status, 'success');
    assertJsonEqual(context.sentMessages[0], {
      tabId: 123,
      message: {
        action: 'exportCurrentConversation',
        folderName: 'chatgpt-inbox'
      }
    });
    assert.strictEqual(context.downloads[0].filename, 'chatgpt-inbox/2026-06-02-Title.md');
  });

  await test('auto mode: popup export returns DOWNLOAD_FAILED when chrome download fails', async () => {
    const context = createContext();
    context.chrome.downloads.download = async () => {
      throw new Error('download failed');
    };
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assertJsonEqual(result.response, {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'DOWNLOAD_FAILED'
      }
    });
    assert.strictEqual(context.storageState.exportHistory.length, 0);
  });

  await test('both modes: popup export returns NO_CONTENT when markdown is empty', async () => {
    const context = createContext();
    context.chrome.tabs.sendMessage = async (tabId, message) => {
      context.sentMessages.push({ tabId, message });
      return {
        action: 'exportResult',
        status: 'success',
        detail: {
          filename: '2026-06-02-Title.md',
          title: 'Title',
          markdown: ''
        }
      };
    };
    loadBackground(context);

    const result = await sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assertJsonEqual(result.response, {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'NO_CONTENT'
      }
    });
    assert.strictEqual(context.downloads.length, 0);
    assert.strictEqual(context.storageState.exportHistory.length, 0);
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
