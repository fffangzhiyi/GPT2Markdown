'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(overrides = {}) {
  const listeners = {};
  const postedMessages = [];
  const elementsById = {};
  const bodyChildren = [];
  const document = {
    body: {
      appendChild(element) {
        bodyChildren.push(element);
        registerIds(element);
      }
    },
    createElement(tagName) {
      return {
        tagName,
        style: {},
        children: [],
        listeners: {},
        innerHTML: '',
        appendChild(child) {
          this.children.push(child);
        },
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        },
        remove() {
          const index = bodyChildren.indexOf(this);
          if (index >= 0) {
            bodyChildren.splice(index, 1);
          }
        }
      };
    },
    getElementById(id) {
      return elementsById[id] || null;
    }
  };

  function registerIds(element) {
    const matches = element.innerHTML.matchAll(/id="([^"]+)"/g);
    for (const match of matches) {
      elementsById[match[1]] = {
        listeners: {},
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        },
        click() {
          if (this.listeners.click) {
            this.listeners.click();
          }
        }
      };
    }
    for (const child of element.children || []) {
      registerIds(child);
    }
  }

  const context = {
    console,
    document,
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
    createFilename: () => '2026-06-02-Conversation.md',
    elementsById,
    bodyChildren,
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

function waitForAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
      createFilename: (title) => {
        calls.push(['filename', title]);
        return '2026-06-02-Conversation.md';
      }
    });
    loadBridge(context);

    await dispatchRequest(context, 'custom-folder');

    assertJsonEqual(calls, [
      'fetch',
      ['parse', 'Conversation'],
      ['markdown', 'Conversation'],
      ['filename', 'Conversation']
    ]);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'success',
      detail: {
        filename: '2026-06-02-Conversation.md',
        title: 'Conversation',
        markdown: '# Conversation\n'
      }
    });
  });

  await test('marks unsupported multimodal placeholder content in success result', async () => {
    const context = createContext({
      parseConversation: () => ({
        title: 'Voice Conversation',
        messages: [
          {
            role: 'user',
            content: '[multimodal_text message]',
            contentType: 'multimodal_text'
          },
          {
            role: 'assistant',
            content: 'Readable response'
          }
        ]
      }),
      generateMarkdown: () => '# Voice Conversation\n',
      createFilename: () => '2026-06-02-Voice-Conversation.md'
    });
    loadBridge(context);

    await dispatchRequest(context);

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'success',
      detail: {
        filename: '2026-06-02-Voice-Conversation.md',
        title: 'Voice Conversation',
        markdown: '# Voice Conversation\n',
        hasUnsupportedContent: true
      }
    });
  });

  await test('posts API error directly when fetch fails', async () => {
    const context = createContext({
      fetchConversation: async () => ({
        success: false,
        error: 'UNAUTHORIZED'
      })
    });
    loadBridge(context);

    const event = {
      source: context.window,
      data: {
        type: 'GPT2MD_EXPORT_REQUEST'
      }
    };
    context.listeners.message[0](event);
    await waitForAsyncWork();

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'error',
      detail: {
        error: 'UNAUTHORIZED'
      }
    });
    assert.strictEqual(context.bodyChildren.length, 0);
  });

  await test('ignores request folder in MAIN world export result', async () => {
    const context = createContext({
      createFilename: () => '2026-06-02-Conversation.md'
    });
    loadBridge(context);

    await dispatchRequest(context, 'nested-folder');

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'success',
      detail: {
        filename: '2026-06-02-Conversation.md',
        title: 'Conversation',
        markdown: '# Conversation\n'
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
