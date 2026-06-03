'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(overrides = {}) {
  const listeners = {};
  const postedMessages = [];
  const context = {
    console,
    window: {
      addEventListener(type, listener) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      },
      postMessage(message) {
        postedMessages.push(message);
      }
    },
    listeners,
    postedMessages,
    fetchConversation: async () => ({
      success: true,
      data: {
        title: 'Conversation'
      }
    }),
    parseConversation: (data) => ({
      title: data.title,
      messages: []
    }),
    generateMarkdown: () => '# Conversation\n',
    downloadMarkdown: async () => ({
      success: true,
      filename: '2026-06-02-Conversation.md'
    }),
    ...overrides
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadBridge(context) {
  const source = fs.readFileSync('lib/bridge.js', 'utf8');
  vm.runInContext(source, context);
}

async function dispatchRequest(context, folderName = 'chatgpt-inbox') {
  const event = {
    source: context.window,
    data: {
      type: 'GPT2MD_EXPORT_REQUEST',
      folderName
    }
  };

  for (const listener of context.listeners.message || []) {
    await listener(event);
  }
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
  await test('runs the export pipeline and posts success result', async () => {
    const calls = [];
    const context = createContext({
      fetchConversation: async () => {
        calls.push('fetch');
        return {
          success: true,
          data: {
            title: 'Conversation'
          }
        };
      },
      parseConversation: (data) => {
        calls.push(['parse', data.title]);
        return {
          title: 'Conversation',
          messages: []
        };
      },
      generateMarkdown: (parsed) => {
        calls.push(['markdown', parsed.title]);
        return '# Conversation\n';
      },
      downloadMarkdown: async (markdown, title, folderName) => {
        calls.push(['download', markdown, title, folderName]);
        return {
          success: true,
          filename: '2026-06-02-Conversation.md'
        };
      }
    });
    loadBridge(context);

    await dispatchRequest(context, 'custom-folder');

    assertJsonEqual(calls, [
      'fetch',
      ['parse', 'Conversation'],
      ['markdown', 'Conversation'],
      ['download', '# Conversation\n', 'Conversation', 'custom-folder']
    ]);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'success',
      detail: {
        filename: '2026-06-02-Conversation.md',
        title: 'Conversation'
      }
    });
  });

  await test('posts fetch error without parsing or downloading', async () => {
    let parsed = false;
    const context = createContext({
      fetchConversation: async () => ({
        success: false,
        error: 'UNAUTHORIZED'
      }),
      parseConversation: () => {
        parsed = true;
      }
    });
    loadBridge(context);

    await dispatchRequest(context);

    assert.strictEqual(parsed, false);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'error',
      detail: {
        error: 'UNAUTHORIZED'
      }
    });
  });

  await test('posts download error', async () => {
    const context = createContext({
      downloadMarkdown: async () => ({
        success: false,
        error: 'NO_CONTENT'
      })
    });
    loadBridge(context);

    await dispatchRequest(context);

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'error',
      detail: {
        error: 'NO_CONTENT'
      }
    });
  });

  await test('ignores unrelated messages', async () => {
    const context = createContext();
    loadBridge(context);

    const event = {
      source: context.window,
      data: {
        type: 'OTHER_MESSAGE'
      }
    };
    for (const listener of context.listeners.message || []) {
      await listener(event);
    }

    assert.strictEqual(context.postedMessages.length, 0);
  });
})();
