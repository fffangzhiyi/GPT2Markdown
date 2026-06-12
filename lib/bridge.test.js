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
  const consoleLogs = [];
  const timers = [];
  var performanceTime = 0;
  var currentTime = 1000;
  var pathname = '/';

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
    console: {
      log() {
        consoleLogs.push(Array.from(arguments));
      }
    },
    performance: {
      now() {
        performanceTime += 10;
        return performanceTime;
      }
    },
    Date: {
      now() {
        return currentTime;
      }
    },
    setTimeout(callback, delay) {
      const timer = {
        callback,
        delay,
        cleared: false
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) {
        timer.cleared = true;
      }
    },
    document,
    MutationObserver,
    getComputedStyle: () => ({
      position: 'static'
    }),
    window: {
      location: {
        get pathname() {
          return pathname;
        }
      },
      addEventListener(type, listener) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      },
      postMessage(message) {
        postedMessages.push(message);
      }
    },
    history: {
      pushState(state, title, url) {
        if (url) {
          pathname = new URL(url, 'https://chatgpt.com').pathname;
        }
      },
      replaceState(state, title, url) {
        if (url) {
          pathname = new URL(url, 'https://chatgpt.com').pathname;
        }
      }
    },
    listeners,
    postedMessages,
    documentListeners,
    mutationObservers,
    consoleLogs,
    timers,
    setCurrentTime(value) {
      currentTime = value;
    },
    setPathname(value) {
      pathname = value;
    },
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

  await test('logs full export pipeline timing and message count', async () => {
    const times = [100, 460, 475, 500];
    const context = createContext({
      performance: {
        now() {
          return times.shift();
        }
      },
      parseConversation: () => ({
        title: 'Timed Conversation',
        messages: [
          {
            role: 'user',
            content: 'Hello'
          },
          {
            role: 'assistant',
            content: 'Hi'
          }
        ]
      })
    });
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_EXPORT_REQUEST'
    });

    assertJsonEqual(context.consoleLogs[0], [
      '[GPT2MD 全量导出]',
      'API: 360ms',
      '| Parse: 15ms',
      '| Markdown: 25ms',
      '| 总计: 400ms',
      '| 消息数: 2'
    ]);
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

  await test('prefetches conversation data and consumes fresh cache on full export', async () => {
    var fetchCount = 0;
    const context = createContext({
      fetchConversation: async () => {
        fetchCount += 1;
        return {
          success: true,
          data: {
            title: 'Prefetched'
          }
        };
      }
    });
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_PREFETCH'
    });
    assert.strictEqual(fetchCount, 1);
    await new Promise((resolve) => setImmediate(resolve));

    await dispatchMessage(context, {
      type: 'GPT2MD_EXPORT_REQUEST'
    });

    assert.strictEqual(fetchCount, 1);
    assert.strictEqual(context.postedMessages[0].detail.title, 'Prefetched');
  });

  await test('prefetches on initial conversation page and skips duplicate request while fresh', async () => {
    var fetchCount = 0;
    const context = createContext({
      fetchConversation: async () => {
        fetchCount += 1;
        return {
          success: true,
          data: {
            title: 'Initial'
          }
        };
      }
    });
    context.setPathname('/c/initial-id');
    context.createMessageElement('user');

    loadBridge(context);
    await new Promise((resolve) => setImmediate(resolve));
    await dispatchMessage(context, {
      type: 'GPT2MD_PREFETCH'
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(fetchCount, 1);
    assert.strictEqual(context.timers[0].delay, 1500);
  });

  await test('refetches when message count changes before popup prefetch request', async () => {
    var fetchCount = 0;
    const context = createContext({
      fetchConversation: async () => {
        fetchCount += 1;
        return {
          success: true,
          data: {
            title: 'Fetch ' + fetchCount
          }
        };
      }
    });
    context.setPathname('/c/count-id');
    context.createMessageElement('user');

    loadBridge(context);
    await new Promise((resolve) => setImmediate(resolve));
    context.createMessageElement('assistant');
    await dispatchMessage(context, {
      type: 'GPT2MD_PREFETCH'
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(fetchCount, 2);
  });

  await test('corrects initial prefetch after DOM stabilizes and starts polling', async () => {
    var fetchCount = 0;
    const context = createContext({
      fetchConversation: async () => {
        fetchCount += 1;
        return {
          success: true,
          data: {
            title: 'Fetch ' + fetchCount
          }
        };
      }
    });
    context.setPathname('/c/stabilize-id');
    context.createMessageElement('user');

    loadBridge(context);
    await new Promise((resolve) => setImmediate(resolve));
    context.createMessageElement('assistant');
    await context.timers[0].callback();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(fetchCount, 2);
    assert.strictEqual(context.timers[1].delay, 5000);
  });

  await test('polls for message count changes and refetches after settle and throttle windows', async () => {
    var fetchCount = 0;
    const context = createContext({
      fetchConversation: async () => {
        fetchCount += 1;
        return {
          success: true,
          data: {
            title: 'Fetch ' + fetchCount
          }
        };
      }
    });
    context.setPathname('/c/poll-id');
    context.createMessageElement('user');

    loadBridge(context);
    await new Promise((resolve) => setImmediate(resolve));
    await context.timers[0].callback();
    context.createMessageElement('assistant');
    context.setCurrentTime(31000);
    await context.timers[1].callback();

    const settleTimer = context.timers.find((timer) => timer.delay === 3000 && !timer.cleared);
    assert.ok(settleTimer);
    await settleTimer.callback();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(fetchCount, 2);
  });

  await test('releases old cache and prefetches after SPA conversation change', async () => {
    var fetchCount = 0;
    const context = createContext({
      fetchConversation: async () => {
        fetchCount += 1;
        return {
          success: true,
          data: {
            title: 'Fetch ' + fetchCount
          }
        };
      }
    });
    context.setPathname('/c/first-id');
    context.createMessageElement('user');

    loadBridge(context);
    await new Promise((resolve) => setImmediate(resolve));
    context.history.pushState({}, '', '/c/second-id');
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(fetchCount, 2);
    assert.strictEqual(context.window.location.pathname, '/c/second-id');
  });

  await test('refetches conversation data when prefetched cache is older than TTL', async () => {
    var fetchCount = 0;
    const context = createContext({
      fetchConversation: async () => {
        fetchCount += 1;
        return {
          success: true,
          data: {
            title: 'Fetch ' + fetchCount
          }
        };
      }
    });
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_PREFETCH'
    });
    await new Promise((resolve) => setImmediate(resolve));
    context.setCurrentTime(181000);
    await dispatchMessage(context, {
      type: 'GPT2MD_EXPORT_REQUEST'
    });

    assert.strictEqual(fetchCount, 2);
    assert.strictEqual(context.postedMessages[0].detail.title, 'Fetch 2');
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

  await test('releases prefetched data when selection mode exits', async () => {
    var fetchCount = 0;
    const context = createContext({
      fetchConversation: async () => {
        fetchCount += 1;
        return {
          success: true,
          data: {
            title: 'Fetch ' + fetchCount
          }
        };
      }
    });
    context.createMessageElement('user');
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_ENTER_SELECTION'
    });
    await Promise.resolve();
    await dispatchMessage(context, {
      type: 'GPT2MD_EXIT_SELECTION'
    });
    await dispatchMessage(context, {
      type: 'GPT2MD_EXPORT_REQUEST'
    });

    assert.strictEqual(fetchCount, 2);
    assert.strictEqual(context.postedMessages[0].detail.title, 'Fetch 2');
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

  await test('logs selection export timing and selected message count', async () => {
    const times = [200, 500, 510, 530];
    const context = createContext({
      performance: {
        now() {
          return times.shift();
        }
      },
      parseConversation: () => ({
        title: 'Timed Selection',
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
      generateMarkdown: (parsed) => parsed.messages.map((message) => message.content).join('\n')
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

    assertJsonEqual(context.consoleLogs[0], [
      '[GPT2MD 选择导出]',
      'API: 300ms',
      '| Parse: 10ms',
      '| Filter+Markdown: 20ms',
      '| 总计: 330ms',
      '| 导出: 1/2 条'
    ]);
  });
})();
