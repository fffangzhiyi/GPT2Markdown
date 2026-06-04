'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(document) {
  const context = {
    console
  };

  if (document !== undefined) {
    context.document = document;
  }

  context.globalThis = context;
  return vm.createContext(context);
}

function loadDomParse(context) {
  const source = fs.readFileSync('lib/dom-parse.js', 'utf8');
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
  await test('parses valid DOM with title and messages', () => {
    const messages = [
      {
        getAttribute(name) {
          return name === 'data-message-author-role' ? 'user' : null;
        },
        querySelector(selector) {
          return selector === '[data-message-content]' ? {
            textContent: 'Hello'
          } : null;
        },
        textContent: 'fallback user'
      },
      {
        getAttribute(name) {
          return name === 'data-message-author-role' ? 'assistant' : null;
        },
        querySelector(selector) {
          return selector === '.markdown' ? {
            textContent: 'Hi there'
          } : null;
        },
        textContent: 'fallback assistant'
      }
    ];
    const context = createContext({
      querySelector(selector) {
        return selector === 'h1' ? {
          textContent: 'Conversation title'
        } : null;
      },
      querySelectorAll(selector) {
        return selector === 'article[data-message-author-role]' ? messages : [];
      }
    });
    loadDomParse(context);

    const result = context.domParseConversation();

    assertJsonEqual(result, {
      success: true,
      data: {
        title: 'Conversation title',
        messages: [
          {
            role: 'user',
            content: 'Hello'
          },
          {
            role: 'assistant',
            content: 'Hi there'
          }
        ]
      }
    });
  });

  await test('returns DOM_PARSE_FAILED when no messages found', () => {
    const context = createContext({
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    });
    loadDomParse(context);

    assertJsonEqual(context.domParseConversation(), {
      success: false,
      error: 'DOM_PARSE_FAILED'
    });
  });

  await test('returns DOM_PARSE_FAILED when document is undefined', () => {
    const context = createContext();
    loadDomParse(context);

    assertJsonEqual(context.domParseConversation(), {
      success: false,
      error: 'DOM_PARSE_FAILED'
    });
  });
})();
