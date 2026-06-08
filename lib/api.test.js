'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(overrides = {}) {
  const context = {
    window: {
      location: {
        pathname: '/c/conversation-123'
      }
    },
    console,
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    AbortController: class {
      constructor() {
        this.signal = {};
      }

      abort() {
        this.signal.aborted = true;
      }
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ title: 'Test conversation' })
    }),
    ...overrides
  };

  context.globalThis = context;
  context.window.fetch = context.fetch;
  context.window.AbortController = context.AbortController;
  return vm.createContext(context);
}

function loadApi(context) {
  const source = fs.readFileSync('lib/api.js', 'utf8');
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
  await test('returns NOT_A_CONVERSATION_PAGE outside /c/:id', async () => {
    const context = createContext({
      window: {
        location: {
          pathname: '/'
        }
      }
    });
    loadApi(context);

    const result = await context.fetchConversation();

    assertJsonEqual(result, {
      success: false,
      error: 'NOT_A_CONVERSATION_PAGE'
    });
  });

  await test('fetches and parses conversation JSON', async () => {
    let requestedUrl;
    const context = createContext({
      fetch: async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'conversation-123' })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    const result = await context.fetchConversation();

    assert.strictEqual(requestedUrl, 'https://chatgpt.com/backend-api/conversation/conversation-123');
    assertJsonEqual(result, {
      success: true,
      data: {
        id: 'conversation-123'
      }
    });
  });

  await test('adds Authorization header from /api/auth/session accessToken', async () => {
    let requestOptions;
    const calls = [];
    const context = createContext({
      fetch: async (url, options) => {
        calls.push(url);
        if (url === '/api/auth/session') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              accessToken: 'session-endpoint-token'
            })
          };
        }

        requestOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'conversation-123' })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    await context.fetchConversation();

    assertJsonEqual(calls, [
      '/api/auth/session',
      'https://chatgpt.com/backend-api/conversation/conversation-123'
    ]);
    assertJsonEqual(requestOptions.headers, {
      Authorization: 'Bearer session-endpoint-token'
    });
  });

  await test('requests /api/auth/session with included credentials', async () => {
    let sessionOptions;
    const context = createContext({
      fetch: async (url, options) => {
        if (url === '/api/auth/session') {
          sessionOptions = options;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              accessToken: 'session-endpoint-token'
            })
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'conversation-123' })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    await context.fetchConversation();

    assertJsonEqual(sessionOptions, {
      credentials: 'include'
    });
  });

  await test('requests backend conversation with included credentials', async () => {
    let backendOptions;
    const context = createContext({
      fetch: async (url, options) => {
        if (url === '/api/auth/session') {
          return {
            ok: true,
            status: 200,
            json: async () => ({})
          };
        }

        backendOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'conversation-123' })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    await context.fetchConversation();

    assert.strictEqual(backendOptions.credentials, 'include');
  });

  await test('adds Authorization header from sessionStorage token', async () => {
    let requestOptions;
    const context = createContext({
      sessionStorage: {
        length: 1,
        key(index) {
          return index === 0 ? 'accessToken' : null;
        },
        getItem(key) {
          return key === 'accessToken' ? 'plain-token' : null;
        }
      },
      fetch: async (url, options) => {
        requestOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'conversation-123' })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    await context.fetchConversation();

    assertJsonEqual(requestOptions.headers, {
      Authorization: 'Bearer plain-token'
    });
  });

  await test('extracts Authorization token from JSON sessionStorage value', async () => {
    let requestOptions;
    const context = createContext({
      sessionStorage: {
        length: 1,
        key(index) {
          return index === 0 ? 'session-data' : null;
        },
        getItem(key) {
          return key === 'session-data' ? '{"accessToken":"json-token"}' : null;
        }
      },
      fetch: async (url, options) => {
        requestOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'conversation-123' })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    await context.fetchConversation();

    assertJsonEqual(requestOptions.headers, {
      Authorization: 'Bearer json-token'
    });
  });

  await test('ignores non-token JSON sessionStorage values', async () => {
    let requestOptions;
    const context = createContext({
      sessionStorage: {
        length: 1,
        key(index) {
          return index === 0 ? 'session-data' : null;
        },
        getItem(key) {
          return key === 'session-data' ? '{"user":{"email":"user@example.com"}}' : null;
        }
      },
      fetch: async (url, options) => {
        if (url === '/api/auth/session') {
          return {
            ok: true,
            status: 200,
            json: async () => ({})
          };
        }

        requestOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'conversation-123' })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    await context.fetchConversation();

    assertJsonEqual(requestOptions.headers, {});
  });

  await test('continues without Authorization header when token is unavailable', async () => {
    let requestOptions;
    const context = createContext({
      sessionStorage: {
        length: 0,
        key() {
          return null;
        },
        getItem() {
          return null;
        }
      },
      fetch: async (url, options) => {
        requestOptions = options;
        return {
          ok: false,
          status: 401,
          json: async () => ({})
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    const result = await context.fetchConversation();

    assertJsonEqual(requestOptions.headers, {});
    assertJsonEqual(result, {
      success: false,
      error: 'UNAUTHORIZED'
    });
  });

  await test('adds Authorization header from readable session-token cookie fallback', async () => {
    let requestOptions;
    const context = createContext({
      sessionStorage: {
        length: 0,
        key() {
          return null;
        },
        getItem() {
          return null;
        }
      },
      document: {
        cookie: 'other=value; __Secure-next-auth.session-token=cookie-token'
      },
      fetch: async (url, options) => {
        requestOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'conversation-123' })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    await context.fetchConversation();

    assertJsonEqual(requestOptions.headers, {
      Authorization: 'Bearer cookie-token'
    });
  });

  await test('retries 429 once and succeeds', async () => {
    let backendCalls = 0;
    const context = createContext({
      fetch: async (url) => {
        if (url === '/api/auth/session') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              accessToken: 'session-endpoint-token'
            })
          };
        }

        backendCalls += 1;
        if (backendCalls === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({})
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true })
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    const result = await context.fetchConversation();

    assert.strictEqual(backendCalls, 2);
    assertJsonEqual(result, {
      success: true,
      data: {
        ok: true
      }
    });
  });

  await test('returns RATE_LIMITED when retry also gets 429', async () => {
    let backendCalls = 0;
    const context = createContext({
      fetch: async (url) => {
        if (url === '/api/auth/session') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              accessToken: 'session-endpoint-token'
            })
          };
        }

        backendCalls += 1;
        return {
          ok: false,
          status: 429,
          json: async () => ({})
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    const result = await context.fetchConversation();

    assert.strictEqual(backendCalls, 2);
    assertJsonEqual(result, {
      success: false,
      error: 'RATE_LIMITED'
    });
  });

  await test('returns UNAUTHORIZED for 401 and 403', async () => {
    for (const status of [401, 403]) {
      const context = createContext({
        fetch: async () => ({
          ok: false,
          status,
          json: async () => ({})
        })
      });
      context.window.fetch = context.fetch;
      loadApi(context);

      const result = await context.fetchConversation();

      assertJsonEqual(result, {
        success: false,
        error: 'UNAUTHORIZED'
      });
    }
  });

  await test('returns NETWORK_ERROR for other non-OK HTTP responses', async () => {
    const context = createContext({
      fetch: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'server error' })
      })
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    const result = await context.fetchConversation();

    assertJsonEqual(result, {
      success: false,
      error: 'NETWORK_ERROR'
    });
  });

  await test('returns PARSE_ERROR when response JSON parsing fails', async () => {
    const context = createContext({
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json');
        }
      })
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    const result = await context.fetchConversation();

    assertJsonEqual(result, {
      success: false,
      error: 'PARSE_ERROR'
    });
  });

  await test('returns NETWORK_ERROR for fetch failures', async () => {
    const context = createContext({
      fetch: async () => {
        throw new TypeError('network failed');
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    const result = await context.fetchConversation();

    assertJsonEqual(result, {
      success: false,
      error: 'NETWORK_ERROR'
    });
  });

  await test('returns TIMEOUT when the request is aborted by timeout', async () => {
    const context = createContext({
      setTimeout(callback) {
        callback();
        return 1;
      },
      fetch: async (url, options) => {
        if (options.signal.aborted) {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({})
        };
      }
    });
    context.window.fetch = context.fetch;
    loadApi(context);

    const result = await context.fetchConversation();

    assertJsonEqual(result, {
      success: false,
      error: 'TIMEOUT'
    });
  });
})();
