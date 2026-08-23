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
  const styleWrites = [];
  const querySelectorCalls = [];
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
    if (selector === 'div') {
      return element.tagName === 'DIV';
    }
    if (selector === 'h2') {
      return element.tagName === 'H2';
    }
    if (selector === 'li') {
      return element.tagName === 'LI';
    }
    if (selector === 'a[href*="/c/"]') {
      return element.tagName === 'A' && (element.attributes.href || '').includes('/c/');
    }
    if (selector === 'a[href]') {
      return element.tagName === 'A' && Boolean(element.attributes.href);
    }
    if (/^a\[href\*="([^"]+)"\]$/.test(selector)) {
      const hrefPart = selector.match(/^a\[href\*="([^"]+)"\]$/)[1];
      return element.tagName === 'A' && (element.attributes.href || '').includes(hrefPart);
    }
    if (selector === '[role="link"]') {
      return element.attributes.role === 'link';
    }
    if (selector === '[role="button"]') {
      return element.attributes.role === 'button';
    }
    if (selector === '[aria-controls]') {
      return Object.prototype.hasOwnProperty.call(element.attributes, 'aria-controls');
    }
    if (selector === '[data-testid]') {
      return Object.prototype.hasOwnProperty.call(element.dataset, 'testid');
    }
    if (/^\[class\*="([^"]+)"\]$/.test(selector)) {
      var classPart = selector.match(/^\[class\*="([^"]+)"\]$/)[1];
      return classNames(element).some(function (c) { return c.indexOf(classPart) !== -1; });
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
    if (selector === '.gpt2md-checkbox[data-conversation-id]') {
      return classNames(element).includes('gpt2md-checkbox')
        && Object.prototype.hasOwnProperty.call(element.dataset, 'conversationId');
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

  function matchesAny(element, selector) {
    return selector.split(',').some((part) => matches(element, part.trim()));
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
    const style = {};
    const element = {
      tagName: String(tagName).toUpperCase(),
      className: '',
      style,
      dataset: {},
      attributes: {},
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
      insertBefore(child, referenceChild) {
        const index = this.children.indexOf(referenceChild);
        child.parentNode = this;
        if (index === -1) {
          this.children.push(child);
        } else {
          this.children.splice(index, 0, child);
        }
        if (child.id) {
          elementsById[child.id] = child;
        }
      },
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      },
      removeEventListener(type, listener) {
        if (this.listeners[type] === listener) {
          delete this.listeners[type];
        }
      },
      getAttribute(name) {
        return this.attributes[name] || null;
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      querySelector(selector) {
        return descendants(this).find((child) => matchesAny(child, selector)) || null;
      },
      querySelectorAll(selector) {
        return descendants(this).filter((child) => matchesAny(child, selector));
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

    Object.defineProperty(style, 'position', {
      get() {
        return this._position || '';
      },
      set(value) {
        this._position = value;
        styleWrites.push({
          element,
          value
        });
        if (typeof overrides.onStyleWrite === 'function') {
          overrides.onStyleWrite(element, value);
        }
      }
    });

    Object.defineProperty(element, 'parentElement', {
      get() {
        return this.parentNode;
      }
    });

    Object.defineProperty(element, 'nextElementSibling', {
      get() {
        if (!this.parentNode) {
          return null;
        }
        const index = this.parentNode.children.indexOf(this);
        if (index === -1) {
          return null;
        }
        return this.parentNode.children[index + 1] || null;
      }
    });

    Object.defineProperty(element, 'firstChild', {
      get() {
        return this.children[0] || null;
      }
    });

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
      querySelectorCalls.push(selector);
      return descendants(body).filter((element) => matchesAny(element, selector));
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
    styleWrites,
    querySelectorCalls,
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
    createHistoryConversation(id, href) {
      const row = createElement('li');
      const link = createElement('a');
      link.setAttribute('href', href || '/c/' + id);
      row.appendChild(link);
      body.appendChild(row);
      return {
        row,
        link
      };
    },
    createProjectLink(href, title) {
      const link = createElement('a');
      link.setAttribute('href', href);
      link.textContent = title;
      body.appendChild(link);
      return link;
    },
    createProjectElement(href, title) {
      const element = createElement('div');
      element.setAttribute('role', 'button');
      element.setAttribute('data-href', href);
      element.textContent = title;
      body.appendChild(element);
      return element;
    },
    createProjectHeadingConversation(projectKey, projectTitle, conversationId, conversationTitle) {
      const section = createElement('div');
      section.className = 'group/sidebar-expando-section';
      const heading = createElement('h2');
      const row = createElement('li');
      const link = createElement('a');
      heading.textContent = projectTitle;
      link.setAttribute('href', '/g/' + projectKey + '/c/' + conversationId);
      link.textContent = conversationTitle;
      row.appendChild(link);
      section.appendChild(heading);
      section.appendChild(row);
      body.appendChild(section);
      return {
        section,
        heading,
        row,
        link
      };
    },
    createProjectUnfurlConversation(projectKey, projectTitle, conversationId, conversationTitle) {
      const section = createElement('div');
      const list = createElement('ul');
      const projectItem = createElement('li');
      const unfurlRow = createElement('div');
      const button = createElement('div');
      const labelContainer = createElement('div');
      const label = createElement('div');
      const panel = createElement('div');
      const conversationRow = createElement('li');
      const link = createElement('a');
      const panelId = '_project_' + projectKey.replace(/[^a-zA-Z0-9]/g, '_');
      section.className = 'group/sidebar-expando-section';
      list.className = 'm-0 list-none p-0';
      unfurlRow.className = 'group/project-unfurl-row relative';
      button.setAttribute('role', 'button');
      button.setAttribute('aria-controls', panelId);
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('data-sidebar-item', 'true');
      labelContainer.className = 'flex min-w-0 grow items-center gap-2.5';
      label.className = 'truncate';
      label.textContent = projectTitle;
      panel.id = panelId;
      panel.className = 'overflow-hidden';
      link.setAttribute('href', '/g/' + projectKey + '/c/' + conversationId);
      link.textContent = conversationTitle;
      labelContainer.appendChild(label);
      button.appendChild(labelContainer);
      unfurlRow.appendChild(button);
      conversationRow.appendChild(link);
      panel.appendChild(conversationRow);
      projectItem.appendChild(unfurlRow);
      projectItem.appendChild(panel);
      list.appendChild(projectItem);
      section.appendChild(list);
      body.appendChild(section);
      return {
        section,
        button,
        label,
        panel,
        link
      };
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

    assert.strictEqual(context.document.getElementById('gpt2md-styles'), null);
    assert.ok(context.document.getElementById('gpt2md-action-bar'));
    assert.strictEqual(context.document.querySelectorAll('.gpt2md-checkbox').length, 2);
    assert.strictEqual(context.document.querySelectorAll('.gpt2md-checkbox')[0].checked, true);
    assert.strictEqual(context.mutationObservers[0].observed, true);
    assert.strictEqual(context.documentListeners.keydown.length, 1);
  });

  await test('uses the manifest-loaded bridge stylesheet without inline style injection', () => {
    const bridgeSource = fs.readFileSync('lib/bridge.js', 'utf8');
    const bridgeCss = fs.readFileSync('lib/bridge-ui.css', 'utf8');
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

    assert.strictEqual(manifest.content_scripts[0].css[0], 'lib/bridge-ui.css');
    assert.strictEqual(bridgeSource.includes('gpt2md-styles'), false);
    assert.strictEqual(bridgeSource.includes("createElement('style')"), false);
    assert.ok(bridgeCss.includes('#gpt2md-action-bar'));
    assert.ok(bridgeCss.includes('#gpt2md-batch-action-bar'));
    assert.strictEqual(/(^|[,{\s])(body|button|input|div)(?=[.{:#\s,])/m.test(bridgeCss), false);
  });

  await test('selection dock shows an independent count and disables export at zero', async () => {
    const context = createContext();
    context.createMessageElement('user');
    context.createMessageElement('assistant');
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_ENTER_SELECTION'
    });

    const exportButton = context.document.getElementById('gpt2md-export-selected-btn');
    const count = context.document.getElementById('gpt2md-selection-count');
    assert.strictEqual(count.textContent, '已选择 2 条');
    assert.strictEqual(exportButton.textContent, '导出');
    assert.strictEqual(exportButton.disabled, false);

    context.document.querySelectorAll('.gpt2md-checkbox')[0].checked = false;
    context.document.querySelectorAll('.gpt2md-checkbox')[0].listeners.change();
    context.document.querySelectorAll('.gpt2md-checkbox')[1].checked = false;
    context.document.querySelectorAll('.gpt2md-checkbox')[1].listeners.change();
    assert.strictEqual(count.textContent, '已选择 0 条');
    assert.strictEqual(exportButton.disabled, true);
  });

  await test('enterSelectionMode batches style reads before DOM writes', async () => {
    const operations = [];
    const context = createContext({
      onStyleWrite: (element, value) => {
        operations.push('write:' + value);
      },
      getComputedStyle: () => {
        operations.push('read');
        return {
          position: 'static'
        };
      }
    });
    context.createMessageElement('user');
    context.createMessageElement('assistant');
    context.createMessageElement('user');
    context.styleWrites.length = 0;
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_ENTER_SELECTION'
    });

    assertJsonEqual(operations.slice(0, 3), ['read', 'read', 'read']);
    assert.strictEqual(context.document.querySelectorAll('.gpt2md-checkbox').length, 3);
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

  await test('exitSelectionMode collects wrappers and containers before removing DOM', async () => {
    const context = createContext();
    context.createMessageElement('user');
    context.createMessageElement('assistant');
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_ENTER_SELECTION'
    });
    context.querySelectorCalls.length = 0;
    await dispatchMessage(context, {
      type: 'GPT2MD_EXIT_SELECTION'
    });

    assertJsonEqual(context.querySelectorCalls.slice(0, 2), [
      '.gpt2md-checkbox-wrapper',
      '.gpt2md-message-container'
    ]);
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

  await test('returns deduplicated DOM conversations with project metadata', async () => {
    const context = createContext();
    context.createProjectLink('/g/g-p-123-vibecoding/project', 'VibeCoding');
    context.createHistoryConversation(
      'conversation-1',
      '/g/g-p-123-vibecoding/c/conversation-1'
    ).link.textContent = 'Project Chat';
    context.createHistoryConversation(
      'conversation-1',
      '/g/g-p-123-vibecoding/c/conversation-1'
    ).link.textContent = 'Project Chat Duplicate';
    context.createHistoryConversation('conversation-2').link.textContent = 'Regular Chat';
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_GET_BATCH_CONVERSATIONS',
      requestId: 'batch-list-1'
    });

    assertJsonEqual(context.postedMessages[0], {
      type: 'GPT2MD_BATCH_CONVERSATIONS_RESULT',
      requestId: 'batch-list-1',
      status: 'success',
      detail: {
        items: [
          {
            id: 'conversation-1',
            title: 'Project Chat',
            projectKey: 'g-p-123-vibecoding',
            projectTitle: 'VibeCoding'
          },
          {
            id: 'conversation-2',
            title: 'Regular Chat',
            projectKey: '',
            projectTitle: '未分组对话'
          }
        ]
      }
    });
  });

  await test('falls back to non-link elements for project titles', async () => {
    const context = createContext();
    context.createProjectElement('/g/g-p-456-growthos', 'GrowthOS');
    context.createHistoryConversation(
      'conversation-1',
      '/g/g-p-456-growthos/c/conversation-1'
    ).link.textContent = 'Project Chat';
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_GET_BATCH_CONVERSATIONS',
      requestId: 'batch-list-2'
    });

    assert.strictEqual(
      context.postedMessages[0].detail.items[0].projectTitle,
      'GrowthOS'
    );
  });

  await test('falls back to h2 project headings that contain project conversations', async () => {
    const context = createContext();
    context.createProjectHeadingConversation(
      'g-p-789-agent',
      'Agent Projects',
      'conversation-1',
      'Project Chat'
    );
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_GET_BATCH_CONVERSATIONS',
      requestId: 'batch-list-3'
    });

    assert.strictEqual(
      context.postedMessages[0].detail.items[0].projectTitle,
      'Agent Projects'
    );
  });

  await test('uses adjacent h2 section instead of broad parent when resolving project titles', async () => {
    const context = createContext();
    const globalHeading = context.document.createElement('h2');
    const unrelatedSection = context.document.createElement('div');
    globalHeading.textContent = '历史聊天记录';
    context.document.body.appendChild(globalHeading);
    context.document.body.appendChild(unrelatedSection);
    context.createProjectHeadingConversation(
      'g-p-999-sidebar',
      'Sidebar Project',
      'conversation-1',
      'Project Chat'
    );
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_GET_BATCH_CONVERSATIONS',
      requestId: 'batch-list-4'
    });

    assert.strictEqual(
      context.postedMessages[0].detail.items[0].projectTitle,
      'Sidebar Project'
    );
  });

  await test('resolves project title from aria-controlled project unfurl rows', async () => {
    const context = createContext();
    context.createProjectUnfurlConversation(
      'g-p-060b3f50424881919abd9f9faf75d0dc',
      'VibeCoding',
      'conversation-1',
      'Project Chat'
    );
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_GET_BATCH_CONVERSATIONS',
      requestId: 'batch-list-5'
    });

    assert.strictEqual(
      context.postedMessages[0].detail.items[0].projectTitle,
      'VibeCoding'
    );
  });

  await test('starts batch export from popup selections without page checkboxes', async () => {
    const fetchedIds = [];
    const context = createContext({
      fetchConversationById: async (id) => {
        fetchedIds.push(id);
        return {
          success: true,
          data: {
            title: id
          }
        };
      },
      parseConversation: (data) => ({
        title: data.title,
        messages: []
      }),
      generateMarkdown: (parsed) => '# ' + parsed.title + '\n',
      createFilename: (title) => title + '.md'
    });
    context.createHistoryConversation('conversation-1').link.textContent = 'First Chat';
    context.createHistoryConversation('conversation-2').link.textContent = 'Second Chat';
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_START_BATCH_EXPORT',
      items: [
        {
          id: 'conversation-2',
          title: 'Second Chat'
        }
      ]
    });

    assertJsonEqual(fetchedIds, ['conversation-2']);
    assert.strictEqual(
      context.document.querySelectorAll('.gpt2md-checkbox[data-conversation-id]').length,
      0
    );
    assert.ok(context.document.getElementById('gpt2md-batch-action-bar'));
    assert.strictEqual(context.documentListeners.keydown.length, 1);
  });

  await test('exits popup-started batch mode and removes the action bar', async () => {
    const context = createContext();
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_START_BATCH_EXPORT',
      items: [
        {
          id: 'conversation-1',
          title: 'First Chat'
        }
      ]
    });
    const cancelButton = context.document.getElementById('gpt2md-batch-close-btn');
    cancelButton.click();

    assert.strictEqual(context.document.getElementById('gpt2md-styles'), null);
    assert.strictEqual(context.document.getElementById('gpt2md-batch-action-bar'), null);
    assert.strictEqual(context.documentListeners.keydown.length, 0);
  });

  await test('exports each selected history conversation and posts a success summary', async () => {
    const fetchedIds = [];
    const context = createContext({
      fetchConversationById: async (id) => {
        fetchedIds.push(id);
        return {
          success: true,
          data: {
            title: id
          }
        };
      },
      parseConversation: (data) => ({
        title: data.title,
        messages: []
      }),
      generateMarkdown: (parsed) => '# ' + parsed.title + '\n',
      createFilename: (title) => title + '.md'
    });
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_START_BATCH_EXPORT',
      items: [
        {
          id: 'conversation-1',
          title: 'First Chat'
        },
        {
          id: 'conversation-2',
          title: 'Second Chat'
        }
      ]
    });

    assertJsonEqual(fetchedIds, ['conversation-1', 'conversation-2']);
    assertJsonEqual(context.postedMessages, [
      {
        type: 'GPT2MD_EXPORT_RESULT',
        batchExport: true,
        status: 'success',
        detail: {
          filename: 'conversation-1.md',
          title: 'conversation-1',
          markdown: '# conversation-1\n'
        }
      },
      {
        type: 'GPT2MD_EXPORT_RESULT',
        batchExport: true,
        status: 'success',
        detail: {
          filename: 'conversation-2.md',
          title: 'conversation-2',
          markdown: '# conversation-2\n'
        }
      },
      {
        type: 'GPT2MD_EXPORT_RESULT',
        batchExport: true,
        batchSummary: true,
        status: 'success',
        detail: {
          successCount: 2,
          failedCount: 0,
          failedItems: [],
          summaryText: '全部导出完成（2 条）'
        }
      }
    ]);
    assert.strictEqual(
      context.document.getElementById('gpt2md-batch-progress-title').textContent,
      '导出完成'
    );
    assert.strictEqual(
      context.document.getElementById('gpt2md-batch-progress-summary').textContent,
      '成功导出 2 个对话'
    );
    assert.strictEqual(
      context.document.getElementById('gpt2md-batch-export-btn').textContent,
      '导出完成'
    );
    assert.strictEqual(
      context.document.getElementById('gpt2md-batch-export-btn').disabled,
      true
    );
  });

  await test('continues batch export after an API failure and reports the failed item', async () => {
    const context = createContext({
      fetchConversationById: async (id) => {
        if (id === 'conversation-2') {
          return {
            success: false,
            error: 'RATE_LIMITED'
          };
        }
        return {
          success: true,
          data: {
            title: id
          }
        };
      },
      parseConversation: (data) => ({
        title: data.title,
        messages: []
      }),
      generateMarkdown: (parsed) => '# ' + parsed.title + '\n',
      createFilename: (title) => title + '.md'
    });
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_START_BATCH_EXPORT',
      items: [
        {
          id: 'conversation-1',
          title: 'First Chat'
        },
        {
          id: 'conversation-2',
          title: 'Second Chat'
        }
      ]
    });

    assertJsonEqual(context.postedMessages[1], {
      type: 'GPT2MD_EXPORT_RESULT',
      batchExport: true,
      batchSummary: true,
      status: 'success',
      detail: {
        successCount: 1,
        failedCount: 1,
        failedItems: [
          {
            id: 'conversation-2',
            title: 'Second Chat',
            error: 'RATE_LIMITED'
          }
        ],
        summaryText: '成功 1 条，失败 1 条：Second Chat'
      }
    });
    assert.strictEqual(
      context.document.getElementById('gpt2md-batch-progress-title').textContent,
      '已完成，1 个失败'
    );
    assert.strictEqual(
      context.document.getElementById('gpt2md-batch-export-btn').textContent,
      '重试失败项'
    );
    assert.strictEqual(
      context.document.getElementById('gpt2md-batch-export-btn').disabled,
      false
    );
  });

  await test('retries only failed items after a partial batch failure', async () => {
    const attempts = [];
    var retrySucceeds = false;
    const context = createContext({
      fetchConversationById: async (id) => {
        attempts.push(id);
        if (id === 'conversation-2' && !retrySucceeds) {
          return {
            success: false,
            error: 'NETWORK_ERROR'
          };
        }
        return {
          success: true,
          data: {
            title: id
          }
        };
      },
      parseConversation: (data) => ({
        title: data.title,
        messages: []
      }),
      generateMarkdown: (parsed) => '# ' + parsed.title + '\n',
      createFilename: (title) => title + '.md'
    });
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_START_BATCH_EXPORT',
      items: [
        {
          id: 'conversation-1',
          title: 'First Chat'
        },
        {
          id: 'conversation-2',
          title: 'Second Chat'
        },
        {
          id: 'conversation-3',
          title: 'Third Chat'
        }
      ]
    });

    const exportBtn = context.document.getElementById('gpt2md-batch-export-btn');

    assertJsonEqual(attempts, [
      'conversation-1',
      'conversation-2',
      'conversation-3'
    ]);
    assert.strictEqual(exportBtn.textContent, '重试失败项');
    assert.strictEqual(exportBtn.disabled, false);

    retrySucceeds = true;
    await exportBtn.click();

    assertJsonEqual(attempts, [
      'conversation-1',
      'conversation-2',
      'conversation-3',
      'conversation-2'
    ]);
    assert.strictEqual(exportBtn.textContent, '导出完成');
    assert.strictEqual(exportBtn.disabled, true);
    assertJsonEqual(context.postedMessages[4], {
      type: 'GPT2MD_EXPORT_RESULT',
      batchExport: true,
      batchSummary: true,
      status: 'success',
      detail: {
        successCount: 1,
        failedCount: 0,
        failedItems: [],
        summaryText: '重试完成：全部成功（1 条）'
      }
    });
  });

  await test('keeps failed titles available when a retry still fails', async () => {
    const context = createContext({
      fetchConversationById: async (id) => {
        if (id === 'conversation-1') {
          return {
            success: false,
            error: 'NETWORK_ERROR'
          };
        }
        return {
          success: true,
          data: {
            title: id
          }
        };
      },
      parseConversation: (data) => ({
        title: data.title,
        messages: []
      }),
      generateMarkdown: (parsed) => '# ' + parsed.title + '\n',
      createFilename: (title) => title + '.md'
    });
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_START_BATCH_EXPORT',
      items: [
        {
          id: 'conversation-1',
          title: 'My First Chat'
        },
        {
          id: 'conversation-2',
          title: 'My Second Chat'
        }
      ]
    });

    const exportBtn = context.document.getElementById('gpt2md-batch-export-btn');
    await exportBtn.click();

    assert.strictEqual(exportBtn.textContent, '重试失败项');
    assert.strictEqual(exportBtn.disabled, false);
    assertJsonEqual(context.postedMessages[2], {
      type: 'GPT2MD_EXPORT_RESULT',
      batchExport: true,
      batchSummary: true,
      status: 'success',
      detail: {
        successCount: 0,
        failedCount: 1,
        failedItems: [
          {
            id: 'conversation-1',
            title: 'My First Chat',
            error: 'NETWORK_ERROR'
          }
        ],
        summaryText: '重试完成：成功 0 条，仍失败 1 条'
      }
    });
  });

  await test('exits batch mode when Escape is pressed', async () => {
    const context = createContext();
    loadBridge(context);

    await dispatchMessage(context, {
      type: 'GPT2MD_START_BATCH_EXPORT',
      items: [
        {
          id: 'conversation-1',
          title: 'First Chat'
        }
      ]
    });
    context.documentListeners.keydown[0]({
      key: 'Escape'
    });

    assert.strictEqual(context.document.getElementById('gpt2md-batch-action-bar'), null);
  });
})();
