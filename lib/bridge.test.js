'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(overrides = {}) {
  const listeners = {};
  const postedMessages = [];
  const elementsById = {};
  const documentListeners = {};
  const mutationObservers = [];

  function classNames(element) {
    return element.className.split(/\s+/).filter(Boolean);
  }

  function matches(element, selector) {
    if (selector === 'article') {
      return element.tagName === 'ARTICLE';
    }
    if (selector === '[data-message-author-role]') {
      return Object.prototype.hasOwnProperty.call(element.dataset, 'messageAuthorRole');
    }
    if (selector === '[data-message-id]') {
      return Object.prototype.hasOwnProperty.call(element.dataset, 'messageId');
    }
    if (selector === '[data-gpt2md-restore-position]') {
      return Object.prototype.hasOwnProperty.call(element.dataset, 'gpt2mdRestorePosition');
    }
    if (selector.startsWith('.')) {
      return classNames(element).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) {
      return element.id === selector.slice(1);
    }
    return false;
  }

  function descendants(element) {
    const result = [];
    for (const child of element.children) {
      result.push(child);
      result.push(...descendants(child));
    }
    return result;
  }

  function unregister(element) {
    if (element.id) {
      delete elementsById[element.id];
    }
    for (const child of element.children) {
      unregister(child);
    }
  }

  function createElement(tagName) {
    const element = {
      tagName: String(tagName).toUpperCase(),
      className: '',
      style: {},
      dataset: {},
      children: [],
      parentNode: null,
      listeners: {},
      textContent: '',
      disabled: false,
      checked: false,
      type: '',
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (child.id) {
          elementsById[child.id] = child;
        }
      },
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      },
      querySelector(selector) {
        return descendants(this).find((child) => matches(child, selector)) || null;
      },
      closest(selector) {
        var current = this;
        while (current) {
          if (matches(current, selector)) {
            return current;
          }
          current = current.parentNode;
        }
        return null;
      },
      click() {
        if (this.listeners.click) {
          return this.listeners.click();
        }
      },
      remove() {
        if (this.parentNode) {
          const index = this.parentNode.children.indexOf(this);
          if (index >= 0) {
            this.parentNode.children.splice(index, 1);
          }
        }
        unregister(this);
        this.parentNode = null;
      }
    };

    Object.defineProperty(element, 'id', {
      get() {
        return this._id || '';
      },
      set(value) {
        if (this._id) {
          delete elementsById[this._id];
        }
        this._id = value;
        if (value) {
          elementsById[value] = this;
        }
      }
    });

    element.classList = {
      add(value) {
        const values = new Set(classNames(element));
        values.add(value);
        element.className = Array.from(values).join(' ');
      },
      remove(value) {
        element.className = classNames(element).filter((item) => item !== value).join(' ');
      },
      contains(value) {
        return classNames(element).includes(value);
      }
    };

    return element;
  }

  const head = createElement('head');
  const body = createElement('body');
  const document = {
    head,
    body,
    createElement,
    getElementById(id) {
      return elementsById[id] || null;
    },
    querySelectorAll(selector) {
      return descendants(body).filter((element) => matches(element, selector));
    },
    addEventListener(type, listener) {
      documentListeners[type] = documentListeners[type] || [];
      documentListeners[type].push(listener);
    },
    removeEventListener(type, listener) {
      documentListeners[type] = (documentListeners[type] || [])
        .filter((item) => item !== listener);
    }
  };

  function MutationObserver(callback) {
    this.callback = callback;
    this.observed = false;
    this.disconnected = false;
    this.events = [];
    this.observe = () => {
      this.observed = true;
      this.events.push('observe');
    };
    this.disconnect = () => {
      this.disconnected = true;
      this.events.push('disconnect');
    };
    mutationObservers.push(this);
  }

  const context = {
    console,
    document,
    MutationObserver,
    getComputedStyle: () => ({
      position: 'static'
    }),
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
    documentListeners,
    mutationObservers,
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
    createMessageElement(role) {
      const article = createElement('article');
      article.dataset.messageAuthorRole = role;
      body.appendChild(article);
      return article;
    },
    ...overrides
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadBridge(context) {
  const source = fs.readFileSync('lib/bridge.js', 'utf8');
  vm.runInContext(source, context);
}

async function dispatchMessage(context, data) {
  const event = {
    source: context.window,
    data
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
      createFilename: (title) => {
        calls.push(['filename', title]);
        return '2026-06-02-Conversation.md';
      }
    });
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_EXPORT_REQUEST',
      folderName: 'custom-folder'
    });

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

    await dispatchMessage(context, {
      type: 'GPT2MD_EXPORT_REQUEST'
    });

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

    await dispatchMessage(context, {
      type: 'GPT2MD_EXPORT_REQUEST'
    });

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      status: 'error',
      detail: {
        error: 'UNAUTHORIZED'
      }
    });
  });

  await test('ignores unrelated messages', async () => {
    const context = createContext();
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'OTHER_MESSAGE'
    });

    assert.strictEqual(context.postedMessages.length, 0);
  });

  await test('enters selection mode with checked messages and an action bar', async () => {
    const context = createContext();
    context.createMessageElement('user');
    context.createMessageElement('assistant');
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_ENTER_SELECTION'
    });

    assert.ok(context.document.getElementById('gpt2md-styles'));
    assert.ok(context.document.getElementById('gpt2md-action-bar'));
    assert.strictEqual(context.document.querySelectorAll('.gpt2md-checkbox').length, 2);
    assert.strictEqual(context.document.querySelectorAll('.gpt2md-checkbox')[0].checked, true);
    assert.strictEqual(context.mutationObservers[0].observed, true);
    assert.strictEqual(context.documentListeners.keydown.length, 1);
  });

  await test('exits selection mode and restores injected DOM state', async () => {
    const context = createContext();
    const message = context.createMessageElement('user');
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_ENTER_SELECTION'
    });
    await dispatchMessage(context, {
      type: 'GPT2MD_EXIT_SELECTION'
    });

    assert.strictEqual(context.document.getElementById('gpt2md-styles'), null);
    assert.strictEqual(context.document.getElementById('gpt2md-action-bar'), null);
    assert.strictEqual(context.document.querySelectorAll('.gpt2md-checkbox-wrapper').length, 0);
    assert.strictEqual(message.style.position, '');
    assert.strictEqual(context.mutationObservers[0].disconnected, true);
    assert.strictEqual(context.documentListeners.keydown.length, 0);
  });

  await test('disconnects observer while refreshing selection mode DOM', async () => {
    const context = createContext();
    context.createMessageElement('user');
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_ENTER_SELECTION'
    });

    context.mutationObservers[0].callback();

    assertJsonEqual(context.mutationObservers[0].events, [
      'observe',
      'disconnect',
      'observe'
    ]);
  });

  await test('exports only selected message indices and exits selection mode', async () => {
    const context = createContext({
      parseConversation: () => ({
        title: 'Selected',
        messages: [
          {
            role: 'user',
            content: 'First'
          },
          {
            role: 'assistant',
            content: 'Second'
          }
        ]
      }),
      generateMarkdown: (parsed) => parsed.messages.map((message) => message.content).join('\n'),
      createFilename: () => 'Selected.md'
    });
    context.createMessageElement('user');
    context.createMessageElement('assistant');
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_ENTER_SELECTION'
    });

    const checkboxes = context.document.querySelectorAll('.gpt2md-checkbox');
    checkboxes[1].checked = false;
    checkboxes[1].listeners.change();
    await context.document.getElementById('gpt2md-export-selected-btn').click();

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_EXPORT_RESULT',
      selectionExport: true,
      status: 'success',
      detail: {
        filename: 'Selected.md',
        title: 'Selected',
        markdown: 'First',
        selectedCount: 1
      }
    });
    assert.strictEqual(context.document.getElementById('gpt2md-action-bar'), null);
  });
})();
