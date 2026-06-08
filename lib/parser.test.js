'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext() {
  const context = {
    console
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadParser(context) {
  const source = fs.readFileSync('lib/parser.js', 'utf8');
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
  await test('parses the current-node parent chain in chronological order', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: '对话标题',
      current_node: 'assistant-2',
      mapping: {
        root: {
          parent: null,
          message: null
        },
        'user-1': {
          parent: 'root',
          message: {
            author: {
              role: 'user'
            },
            content: {
              content_type: 'text',
              parts: ['hello']
            }
          }
        },
        'assistant-2': {
          parent: 'user-1',
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: ['hi', ' there']
            },
            metadata: {
              model_slug: 'gpt-4'
            }
          }
        }
      }
    });

    assertJsonEqual(result, {
      title: '对话标题',
      messages: [
        {
          role: 'user',
          content: 'hello',
          contentType: 'text'
        },
        {
          role: 'assistant',
          content: 'hi there',
          model: 'gpt-4'
        }
      ]
    });
  });

  await test('filters messages that are not user or assistant', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: 'Filtered',
      current_node: 'assistant',
      mapping: {
        root: {
          parent: null,
          message: null
        },
        system: {
          parent: 'root',
          message: {
            author: {
              role: 'system'
            },
            content: {
              parts: ['hidden']
            }
          }
        },
        tool: {
          parent: 'system',
          message: {
            author: {
              role: 'tool'
            },
            content: {
              parts: ['tool output']
            }
          }
        },
        assistant: {
          parent: 'tool',
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: ['visible']
            }
          }
        }
      }
    });

    assertJsonEqual(result, {
      title: 'Filtered',
      messages: [
        {
          role: 'assistant',
          content: 'visible'
        }
      ]
    });
  });

  await test('returns empty title and messages when mapping is missing', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: 'Ignored without mapping',
      current_node: 'node'
    });

    assertJsonEqual(result, {
      title: '',
      messages: []
    });
  });

  await test('stops walking when a node is missing', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: 'Partial',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: 'missing-parent',
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: ['partial']
            }
          }
        }
      }
    });

    assertJsonEqual(result, {
      title: 'Partial',
      messages: [
        {
          role: 'assistant',
          content: 'partial'
        }
      ]
    });
  });

  await test('filters messages with empty content', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: 'Fallback',
      current_node: 'assistant',
      mapping: {
        user: {
          parent: null,
          message: {
            author: {
              role: 'user'
            }
          }
        },
        assistant: {
          parent: 'user',
          message: {
            author: {
              role: 'assistant'
            },
            content: {}
          }
        }
      }
    });

    assertJsonEqual(result, {
      title: 'Fallback',
      messages: []
    });
  });

  await test('filters messages with whitespace-only content', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: 'Whitespace',
      current_node: 'assistant',
      mapping: {
        user: {
          parent: null,
          message: {
            author: {
              role: 'user'
            },
            content: {
              parts: ['  \n\t  ']
            }
          }
        },
        assistant: {
          parent: 'user',
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: ['visible']
            }
          }
        }
      }
    });

    assertJsonEqual(result, {
      title: 'Whitespace',
      messages: [
        {
          role: 'assistant',
          content: 'visible'
        }
      ]
    });
  });

  await test('filters non-string content parts', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: 'Multimodal',
      current_node: 'assistant',
      mapping: {
        user: {
          parent: null,
          message: {
            author: {
              role: 'user'
            },
            content: {
              content_type: 'multimodal_text',
              parts: [
                'hello ',
                {
                  content_type: 'image_asset_pointer',
                  asset_pointer: 'file-xxx'
                },
                'world'
              ]
            }
          }
        },
        assistant: {
          parent: 'user',
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: ['response']
            }
          }
        }
      }
    });

    assertJsonEqual(result, {
      title: 'Multimodal',
      messages: [
        {
          role: 'user',
          content: 'hello world',
          contentType: 'multimodal_text'
        },
        {
          role: 'assistant',
          content: 'response'
        }
      ]
    });
  });

  await test('keeps non-string-only content parts with content type placeholder', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: 'Voice',
      current_node: 'assistant',
      mapping: {
        user: {
          parent: null,
          message: {
            author: {
              role: 'user'
            },
            content: {
              content_type: 'audio',
              parts: [
                {
                  content_type: 'audio',
                  part: {
                    asset_pointer: 'file-audio'
                  }
                }
              ]
            }
          }
        },
        assistant: {
          parent: 'user',
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              content_type: 'audio',
              parts: [
                {
                  content_type: 'audio',
                  part: {}
                }
              ]
            }
          }
        }
      }
    });

    assertJsonEqual(result, {
      title: 'Voice',
      messages: [
        {
          role: 'user',
          content: '[audio message]',
          contentType: 'audio'
        },
        {
          role: 'assistant',
          content: '[audio message]',
          contentType: 'audio'
        }
      ]
    });
  });

  await test('keeps non-string-only content parts with generic placeholder', () => {
    const context = createContext();
    loadParser(context);

    const result = context.parseConversation({
      title: 'Unknown multimodal',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: null,
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: [
                {
                  value: 'opaque'
                }
              ]
            }
          }
        }
      }
    });

    assertJsonEqual(result, {
      title: 'Unknown multimodal',
      messages: [
        {
          role: 'assistant',
          content: '[non-text content]'
        }
      ]
    });
  });
})();
