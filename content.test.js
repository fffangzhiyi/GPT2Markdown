'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext() {
  const windowListeners = {};
  const runtimeListeners = [];
  const postedMessages = [];
  const runtimeMessages = [];
  const context = {
    console,
    setTimeout(callback) {
      context.timeoutCallback = callback;
      return 1;
    },
    clearTimeout() {},
    window: {
      addEventListener(type, listener) {
        windowListeners[type] = windowListeners[type] || [];
        windowListeners[type].push(listener);
      },
      removeEventListener(type, listener) {
        windowListeners[type] = (windowListeners[type] || []).filter((item) => item !== listener);
      },
      postMessage(message) {
        postedMessages.push(message);
      }
    },
    chrome: {
      runtime: {
        sendMessage(message) {
          runtimeMessages.push(message);
        },
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          }
        }
      }
    },
    windowListeners,
    runtimeListeners,
    postedMessages,
    runtimeMessages
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadContent(context) {
  const source = fs.readFileSync('content.js', 'utf8');
  vm.runInContext(source, context);
}

function sendRuntimeMessage(context, message) {
  let response;
  const keepAlive = context.runtimeListeners[0](message, {}, (value) => {
    response = value;
  });

  return {
    keepAlive,
    getResponse() {
      return response;
    }
  };
}

async function dispatchWindowMessage(context, data) {
  const event = {
    source: context.window,
    data
  };

  for (const listener of context.windowListeners.message || []) {
    listener(event);
  }

  await Promise.resolve();
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
  await test('posts export request and returns bridge result through sendResponse', async () => {
    const context = createContext();
    loadContent(context);

    const runtime = sendRuntimeMessage(context, {
      action: 'exportCurrentConversation',
      folderName: 'custom-folder'
    });

    assert.strictEqual(runtime.keepAlive, true);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_REQUEST',
      folderName: 'custom-folder'
    });

    await dispatchWindowMessage(context, {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'success',
      detail: {
        filename: 'file.md',
        title: 'Title'
      }
    });

    assertJsonEqual(runtime.getResponse(), {
      action: 'exportResult',
      status: 'success',
      detail: {
        filename: 'file.md',
        title: 'Title'
      }
    });
  });

  await test('uses default folder name when message does not provide one', () => {
    const context = createContext();
    loadContent(context);

    sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_REQUEST',
      folderName: 'chatgpt-inbox'
    });
  });

  await test('returns timeout error when bridge does not respond', async () => {
    const context = createContext();
    loadContent(context);

    const runtime = sendRuntimeMessage(context, {
      action: 'exportCurrentConversation'
    });

    context.timeoutCallback();
    await Promise.resolve();

    assertJsonEqual(runtime.getResponse(), {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'TIMEOUT'
      }
    });
  });

  await test('ignores unrelated runtime messages', () => {
    const context = createContext();
    loadContent(context);

    const runtime = sendRuntimeMessage(context, {
      action: 'other'
    });

    assert.strictEqual(runtime.keepAlive, false);
    assert.strictEqual(context.postedMessages.length, 0);
  });

  await test('forwards enterSelectionMode to the MAIN world', () => {
    const context = createContext();
    loadContent(context);

    const runtime = sendRuntimeMessage(context, {
      action: 'enterSelectionMode'
    });

    assert.strictEqual(runtime.keepAlive, false);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_ENTER_SELECTION'
    });
    assertJsonEqual(runtime.getResponse(), {
      status: 'success'
    });
  });

  await test('forwards exitSelectionMode to the MAIN world', () => {
    const context = createContext();
    loadContent(context);

    const runtime = sendRuntimeMessage(context, {
      action: 'exitSelectionMode'
    });

    assert.strictEqual(runtime.keepAlive, false);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXIT_SELECTION'
    });
    assertJsonEqual(runtime.getResponse(), {
      status: 'success'
    });
  });

  await test('forwards enterBatchMode to the MAIN world', () => {
    const context = createContext();
    loadContent(context);

    const runtime = sendRuntimeMessage(context, {
      action: 'enterBatchMode'
    });

    assert.strictEqual(runtime.keepAlive, false);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_ENTER_BATCH'
    });
    assertJsonEqual(runtime.getResponse(), {
      status: 'success'
    });
  });

  await test('forwards prefetchConversation to the MAIN world', () => {
    const context = createContext();
    loadContent(context);

    const runtime = sendRuntimeMessage(context, {
      action: 'prefetchConversation'
    });

    assert.strictEqual(runtime.keepAlive, false);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_PREFETCH'
    });
  });

  await test('relays selection export results to the background download pipeline', async () => {
    const context = createContext();
    loadContent(context);

    await dispatchWindowMessage(context, {
      type: 'GPT2MD_EXPORT_RESULT',
      selectionExport: true,
      status: 'success',
      detail: {
        filename: 'Selected.md',
        title: 'Selected',
        markdown: '# Selected\n',
        selectedCount: 1
      }
    });

    assertJsonEqual(context.runtimeMessages[0], {
      action: 'processSelectionExportResult',
      response: {
        action: 'exportResult',
        status: 'success',
        detail: {
          filename: 'Selected.md',
          title: 'Selected',
          markdown: '# Selected\n',
          selectedCount: 1
        }
      }
    });
  });
})();
