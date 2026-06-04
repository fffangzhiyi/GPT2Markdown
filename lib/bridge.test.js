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
    downloadMarkdown: async () => ({
      success: true,
      filename: '2026-06-02-Conversation.md'
    }),
    domParseConversation: () => ({
      success: true,
      data: {
        title: 'DOM Conversation',
        messages: []
      }
    }),
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

function beginRequest(context, folderName = 'chatgpt-inbox') {
  const event = {
    source: context.window,
    data: {
      type: 'GPT2MD_EXPORT_REQUEST',
      folderName
    }
  };

  return Promise.all((context.listeners.message || []).map((listener) => listener(event)));
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

  await test('shows DOM fallback dialog when API fails', async () => {
    const context = createContext({
      fetchConversation: async () => ({
        success: false,
        error: 'UNAUTHORIZED'
      })
    });
    loadBridge(context);

    const request = beginRequest(context);
    await waitForAsyncWork();

    assert.strictEqual(context.bodyChildren.length, 1);
    assert.ok(context.elementsById['gpt2md-dom-confirm']);
    assert.ok(context.elementsById['gpt2md-dom-cancel']);
    context.elementsById['gpt2md-dom-cancel'].click();
    await request;
  });

  await test('posts CANCELLED when user cancels DOM fallback', async () => {
    const context = createContext({
      fetchConversation: async () => ({
        success: false,
        error: 'UNAUTHORIZED'
      })
    });
    loadBridge(context);

    const request = beginRequest(context);
    await waitForAsyncWork();
    context.elementsById['gpt2md-dom-cancel'].click();
    await request;

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'error',
      detail: {
        error: 'CANCELLED'
      }
    });
  });

  await test('exports successfully through DOM fallback', async () => {
    const calls = [];
    const context = createContext({
      fetchConversation: async () => ({
        success: false,
        error: 'NETWORK_ERROR'
      }),
      domParseConversation: () => ({
        success: true,
        data: {
          title: 'DOM Conversation',
          messages: [
            {
              role: 'user',
              content: 'Hello'
            }
          ]
        }
      }),
      generateMarkdown: (parsed) => {
        calls.push(['markdown', parsed.title]);
        return '# DOM Conversation\n';
      },
      downloadMarkdown: async (markdown, title, folderName) => {
        calls.push(['download', markdown, title, folderName]);
        return {
          success: true,
          filename: '2026-06-04-DOM-Conversation.md'
        };
      }
    });
    loadBridge(context);

    const request = beginRequest(context, 'custom-folder');
    await waitForAsyncWork();
    context.elementsById['gpt2md-dom-confirm'].click();
    await request;

    assertJsonEqual(calls, [
      ['markdown', 'DOM Conversation'],
      ['download', '# DOM Conversation\n', 'DOM Conversation', 'custom-folder']
    ]);
    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'success',
      detail: {
        filename: '2026-06-04-DOM-Conversation.md',
        title: 'DOM Conversation'
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
