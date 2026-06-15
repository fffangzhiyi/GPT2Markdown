'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext() {
  const context = {
    console,
    URL
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

  await test('normalizes citation metadata with marker titles and URLs', () => {
    const context = createContext();
    loadParser(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';
    const content = '价格信息。' + marker;

    const result = context.parseConversation({
      title: 'Citations',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: null,
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: [content]
            },
            metadata: {
              citations: [
                {
                  start_ix: content.indexOf(marker),
                  end_ix: content.length,
                  metadata: {
                    title: 'X Premium 帮助中心',
                    url: 'https://help.x.com/en/using-x/x-premium'
                  }
                }
              ]
            }
          }
        }
      }
    });

    assertJsonEqual(result.messages[0], {
      role: 'assistant',
      content,
      references: [
        {
          marker,
          title: 'X Premium 帮助中心',
          url: 'https://help.x.com/en/using-x/x-premium'
        }
      ]
    });
  });

  await test('normalizes grouped content references and removes duplicate URLs', () => {
    const context = createContext();
    loadParser(context);
    const marker = '\uE200cite\uE202turn0search0\uE202turn0search1\uE201';

    const result = context.parseConversation({
      title: 'Grouped citations',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: null,
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: ['多个来源。' + marker]
            },
            metadata: {
              content_references: [
                {
                  matched_text: marker,
                  title: '帮助中心',
                  safe_urls: [
                    'https://help.x.com/one',
                    'https://help.x.com/two',
                    'https://help.x.com/one'
                  ]
                }
              ]
            }
          }
        }
      }
    });

    assertJsonEqual(result.messages[0].references, [
      {
        marker,
        title: '帮助中心',
        url: 'https://help.x.com/one'
      },
      {
        marker,
        title: '帮助中心',
        url: 'https://help.x.com/two'
      }
    ]);
  });

  await test('extracts a plain title from ChatGPT escaped citation labels', () => {
    const context = createContext();
    loadParser(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';
    const url = 'https://github.com/refactoringhq/tolaria';

    const result = context.parseConversation({
      title: 'Escaped citation title',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: null,
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: ['Tolaria 是本地优先的知识库。' + marker]
            },
            metadata: {
              content_references: [
                {
                  matched_text: marker,
                  title: '(\\[GitHub\\](' + url + '))',
                  url
                }
              ]
            }
          }
        }
      }
    });

    assertJsonEqual(result.messages[0].references, [
      {
        marker,
        title: 'GitHub · tolaria',
        url
      }
    ]);
  });

  await test('extracts a plain title from ChatGPT nested Markdown citation labels', () => {
    const context = createContext();
    loadParser(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';
    const url = 'https://github.com/refactoringhq/tolaria';

    const result = context.parseConversation({
      title: 'Nested citation title',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: null,
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: ['Tolaria 是本地优先的知识库。' + marker]
            },
            metadata: {
              content_references: [
                {
                  matched_text: marker,
                  title: '([GitHub](' + url + '))',
                  url
                }
              ]
            }
          }
        }
      }
    });

    assertJsonEqual(result.messages[0].references, [
      {
        marker,
        title: 'GitHub · tolaria',
        url
      }
    ]);
  });

  await test('prefers citation.title over metadata.title for references', () => {
    const context = createContext();
    loadParser(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';
    const content = '仓库信息。' + marker;

    const result = context.parseConversation({
      title: 'Citation title priority',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: null,
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: [content]
            },
            metadata: {
              citations: [
                {
                  title: 'user/repo',
                  start_ix: content.indexOf(marker),
                  end_ix: content.length,
                  metadata: {
                    title: 'GitHub',
                    url: 'https://github.com/user/repo'
                  }
                }
              ]
            }
          }
        }
      }
    });

    assert.strictEqual(result.messages[0].references[0].title, 'user/repo');
  });

  await test('derives meaningful suffix from URL when title is a common domain', () => {
    const context = createContext();
    loadParser(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';
    const content = '架构文档。' + marker;

    const result = context.parseConversation({
      title: 'Common citation title',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: null,
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: [content]
            },
            metadata: {
              citations: [
                {
                  title: 'GitHub',
                  start_ix: content.indexOf(marker),
                  end_ix: content.length,
                  metadata: {
                    title: 'GitHub',
                    url: 'https://github.com/user/repo/blob/main/docs/ARCHITECTURE.md'
                  }
                }
              ]
            }
          }
        }
      }
    });

    assert.strictEqual(
      result.messages[0].references[0].title,
      'GitHub · ARCHITECTURE'
    );
  });

  await test('does not add URL suffix when title is already specific', () => {
    const context = createContext();
    loadParser(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';
    const content = '仓库介绍。' + marker;

    const result = context.parseConversation({
      title: 'Specific citation title',
      current_node: 'assistant',
      mapping: {
        assistant: {
          parent: null,
          message: {
            author: {
              role: 'assistant'
            },
            content: {
              parts: [content]
            },
            metadata: {
              citations: [
                {
                  start_ix: content.indexOf(marker),
                  end_ix: content.length,
                  metadata: {
                    title: 'Tolaria GitHub Repository',
                    url: 'https://github.com/refactoringhq/tolaria'
                  }
                }
              ]
            }
          }
        }
      }
    });

    assert.strictEqual(
      result.messages[0].references[0].title,
      'Tolaria GitHub Repository'
    );
  });
})();
