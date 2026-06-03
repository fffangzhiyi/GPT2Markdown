'use strict';

(function initApi(globalScope) {
  const CONVERSATION_ID_PATTERN = /\/c\/([a-zA-Z0-9-]+)/;
  const API_BASE_URL = 'https://chatgpt.com/backend-api/conversation/';
  const REQUEST_TIMEOUT_MS = 10000;
  const RATE_LIMIT_RETRY_DELAY_MS = 3000;
  let sessionTokenCache = null;

  function getConversationId(pathname) {
    const match = CONVERSATION_ID_PATTERN.exec(pathname);
    return match ? match[1] : null;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => {
      globalScope.setTimeout(resolve, milliseconds);
    });
  }

  function extractTokenFromValue(value) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed.accessToken || parsed.token || parsed.value || value;
      }
      return value;
    } catch (error) {
      return value;
    }
  }

  async function getSessionToken() {
    if (sessionTokenCache) {
      return sessionTokenCache;
    }

    try {
      const response = await globalScope.fetch('/api/auth/session', {
        credentials: 'include'
      });
      if (response.ok) {
        const session = await response.json();
        if (session && typeof session === 'object') {
          const token = session.accessToken || session.token || session.value;
          if (token) {
            sessionTokenCache = token;
            return token;
          }
        }
      }
    } catch (error) {
    }

    try {
      for (let index = 0; index < globalScope.sessionStorage.length; index += 1) {
        const key = globalScope.sessionStorage.key(index);
        if (!key) {
          continue;
        }
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('token') || lowerKey.includes('session') || lowerKey.includes('access')) {
          const value = globalScope.sessionStorage.getItem(key);
          if (value) {
            const token = extractTokenFromValue(value);
            sessionTokenCache = token;
            return token;
          }
        }
      }
    } catch (error) {
    }

    try {
      const cookies = globalScope.document.cookie.split(';');
      for (const cookie of cookies) {
        const trimmed = cookie.trim();
        if (trimmed.startsWith('__Secure-next-auth.session-token=')) {
          sessionTokenCache = trimmed.slice('__Secure-next-auth.session-token='.length);
          return sessionTokenCache;
        }
      }
    } catch (error) {
    }

    return null;
  }

  async function fetchWithTimeout(url) {
    const controller = new globalScope.AbortController();
    const timeoutId = globalScope.setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const headers = {};
    const token = await getSessionToken();
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }

    try {
      return await globalScope.fetch(url, {
        signal: controller.signal,
        headers
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return {
          error: 'TIMEOUT'
        };
      }

      return {
        error: 'NETWORK_ERROR'
      };
    } finally {
      globalScope.clearTimeout(timeoutId);
    }
  }

  async function requestConversation(url) {
    const response = await fetchWithTimeout(url);
    if (response.error) {
      return {
        success: false,
        error: response.error
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: 'UNAUTHORIZED'
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'RATE_LIMITED'
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: 'NETWORK_ERROR'
      };
    }

    try {
      const data = await response.json();
      return {
        success: true,
        data
      };
    } catch (error) {
      return {
        success: false,
        error: 'PARSE_ERROR'
      };
    }
  }

  async function fetchConversation() {
    const conversationId = getConversationId(globalScope.window.location.pathname);
    if (!conversationId) {
      return {
        success: false,
        error: 'NOT_A_CONVERSATION_PAGE'
      };
    }

    const url = API_BASE_URL + conversationId;
    const firstAttempt = await requestConversation(url);
    if (firstAttempt.error !== 'RATE_LIMITED') {
      return firstAttempt;
    }

    await wait(RATE_LIMIT_RETRY_DELAY_MS);
    return requestConversation(url);
  }

  globalScope.fetchConversation = fetchConversation;
})(globalThis);
