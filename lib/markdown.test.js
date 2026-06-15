'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext() {
  function FixedDate() {
    return new Date('2026-06-02T20:30:00');
  }

  FixedDate.prototype = Date.prototype;

  const context = {
    console,
    Date: FixedDate
  };

  context.globalThis = context;
  return vm.createContext(context);
}

function loadMarkdown(context) {
  const source = fs.readFileSync('lib/markdown.js', 'utf8');
  vm.runInContext(source, context);
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
  await test('generates markdown for user and assistant messages in order', () => {
    const context = createContext();
    loadMarkdown(context);

    const markdown = context.generateMarkdown({
      title: '对话标题',
      messages: [
        {
          role: 'user',
          content: '什么是闭包？'
        },
        {
          role: 'assistant',
          content: '闭包是指...'
        },
        {
          role: 'user',
          content: '举个例子'
        }
      ]
    });

    assert.strictEqual(markdown, '# 对话标题\n\n> 导出时间: 2026-06-02 20:30 | 来源: ChatGPT\n\n## 你\n\n什么是闭包？\n\n## ChatGPT\n\n闭包是指...\n\n## 你\n\n举个例子\n\n');
  });

  await test('uses Untitled Conversation when title is missing', () => {
    const context = createContext();
    loadMarkdown(context);

    const markdown = context.generateMarkdown({
      messages: []
    });

    assert.strictEqual(markdown, '# Untitled Conversation\n\n> 导出时间: 2026-06-02 20:30 | 来源: ChatGPT\n\n');
  });

  await test('returns empty string for null or undefined input', () => {
    const context = createContext();
    loadMarkdown(context);

    assert.strictEqual(context.generateMarkdown(null), '');
    assert.strictEqual(context.generateMarkdown(undefined), '');
  });

  await test('returns title and metadata only when messages is missing or not an array', () => {
    const context = createContext();
    loadMarkdown(context);

    assert.strictEqual(
      context.generateMarkdown({
        title: 'No messages'
      }),
      '# No messages\n\n> 导出时间: 2026-06-02 20:30 | 来源: ChatGPT\n\n'
    );

    assert.strictEqual(
      context.generateMarkdown({
        title: 'Invalid messages',
        messages: {}
      }),
      '# Invalid messages\n\n> 导出时间: 2026-06-02 20:30 | 来源: ChatGPT\n\n'
    );
  });

  await test('preserves content exactly and does not merge consecutive roles', () => {
    const context = createContext();
    loadMarkdown(context);

    const markdown = context.generateMarkdown({
      title: 'Raw Content',
      messages: [
        {
          role: 'user',
          content: '```js\nconsole.log("hi");\n```'
        },
        {
          role: 'user',
          content: 'second user message'
        },
        {
          role: 'assistant',
          content: 'A | B\n--- | ---\n1 | 2'
        }
      ]
    });

    assert.strictEqual(markdown, '# Raw Content\n\n> 导出时间: 2026-06-02 20:30 | 来源: ChatGPT\n\n## 你\n\n```js\nconsole.log("hi");\n```\n\n## 你\n\nsecond user message\n\n## ChatGPT\n\nA | B\n--- | ---\n1 | 2\n\n');
  });

  await test('normalizes ChatGPT math delimiters outside code fences', () => {
    const context = createContext();
    loadMarkdown(context);

    const markdown = context.generateMarkdown({
      title: 'Math',
      messages: [
        {
          role: 'assistant',
          content: '公式如下：\n\n\\[ \\left\\lceil \\frac{X}{56} \\right\\rceil \\]\n\n其中 \\( X \\) 是长度。'
        }
      ]
    });

    assert.strictEqual(markdown, '# Math\n\n> 导出时间: 2026-06-02 20:30 | 来源: ChatGPT\n\n## ChatGPT\n\n公式如下：\n\n$$\n\\left\\lceil \\frac{X}{56} \\right\\rceil\n$$\n\n其中 $X$ 是长度。\n\n');
  });

  await test('does not normalize math delimiters inside code fences', () => {
    const context = createContext();
    loadMarkdown(context);

    const markdown = context.generateMarkdown({
      title: 'Code Math',
      messages: [
        {
          role: 'assistant',
          content: '```tex\n\\[ keep this literal \\]\n```\n\n\\[ convert this \\]'
        }
      ]
    });

    assert.strictEqual(markdown, '# Code Math\n\n> 导出时间: 2026-06-02 20:30 | 来源: ChatGPT\n\n## ChatGPT\n\n```tex\n\\[ keep this literal \\]\n```\n\n$$\nconvert this\n$$\n\n');
  });

  await test('converts ChatGPT citation markers to Markdown links', () => {
    const context = createContext();
    loadMarkdown(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';

    const markdown = context.generateMarkdown({
      title: 'Citations',
      messages: [
        {
          role: 'assistant',
          content: '价格信息。' + marker,
          references: [
            {
              marker,
              title: 'X Premium 帮助中心',
              url: 'https://help.x.com/en/using-x/x-premium'
            }
          ]
        }
      ]
    });

    assert.ok(markdown.includes(
      '价格信息。[X Premium 帮助中心](https://help.x.com/en/using-x/x-premium)'
    ));
    assert.strictEqual(markdown.includes(marker), false);
  });

  await test('renders grouped citation URLs as numbered Markdown links', () => {
    const context = createContext();
    loadMarkdown(context);
    const marker = '\uE200cite\uE202turn0search0\uE202turn0search1\uE201';

    const markdown = context.generateMarkdown({
      title: 'Grouped citations',
      messages: [
        {
          role: 'assistant',
          content: '多个来源。' + marker,
          references: [
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
          ]
        }
      ]
    });

    assert.ok(markdown.includes(
      '多个来源。[帮助中心](https://help.x.com/one) [帮助中心 2](https://help.x.com/two)'
    ));
  });

  await test('removes unresolved ChatGPT citation markers', () => {
    const context = createContext();
    loadMarkdown(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';

    const markdown = context.generateMarkdown({
      title: 'Missing citation metadata',
      messages: [
        {
          role: 'assistant',
          content: '保留正文。' + marker
        }
      ]
    });

    assert.ok(markdown.includes('保留正文。'));
    assert.strictEqual(markdown.includes(marker), false);
    assert.strictEqual(markdown.includes('turn0search0'), false);
  });

  await test('keeps escaped citation labels out of math and preserves later content', () => {
    const context = createContext();
    loadMarkdown(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';
    const url = 'https://github.com/refactoringhq/tolaria';

    const markdown = context.generateMarkdown({
      title: 'Escaped citation label',
      messages: [
        {
          role: 'assistant',
          content: 'Tolaria 是本地优先的知识库。' + marker
            + '\n\n---\n\n# 后续内容\n\n正文继续。',
          references: [
            {
              marker,
              title: '(\\[GitHub\\](' + url + '))',
              url
            }
          ]
        }
      ]
    });

    assert.ok(markdown.includes(
      'Tolaria 是本地优先的知识库。[GitHub](' + url + ')'
        + '\n\n---\n\n# 后续内容\n\n正文继续。'
    ));
    assert.strictEqual(markdown.includes('$$'), false);
    assert.strictEqual(markdown.includes('[(['), false);
  });

  await test('flattens nested Markdown citation labels to a single link', () => {
    const context = createContext();
    loadMarkdown(context);
    const marker = '\uE200cite\uE202turn0search0\uE201';
    const url = 'https://github.com/refactoringhq/tolaria';

    const markdown = context.generateMarkdown({
      title: 'Nested citation label',
      messages: [
        {
          role: 'assistant',
          content: 'Tolaria 是本地优先的知识库。' + marker
            + '\n\n---\n\n# 后续内容\n\n正文继续。',
          references: [
            {
              marker,
              title: '([GitHub](' + url + '))',
              url
            }
          ]
        }
      ]
    });

    assert.ok(markdown.includes(
      'Tolaria 是本地优先的知识库。[GitHub](' + url + ')'
        + '\n\n---\n\n# 后续内容\n\n正文继续。'
    ));
    assert.strictEqual(markdown.includes('[(['), false);
    assert.strictEqual(markdown.includes('\\[GitHub\\]'), false);
  });
})();
