'use strict';

(function initMarkdown(globalScope) {
  function padNumber(value) {
    return String(value).padStart(2, '0');
  }

  function formatExportTime(date) {
    return [
      date.getFullYear(),
      padNumber(date.getMonth() + 1),
      padNumber(date.getDate())
    ].join('-') + ' ' + [
      padNumber(date.getHours()),
      padNumber(date.getMinutes())
    ].join(':');
  }

  function renderHeader(title) {
    return '# ' + title + '\n\n> 导出时间: ' + formatExportTime(new globalScope.Date()) + ' | 来源: ChatGPT\n\n';
  }

  function normalizeMathInText(text) {
    return text
      .replace(/\\\[\s*/g, function replaceDisplayMathStart() {
        return '$$\n';
      })
      .replace(/\s*\\\]/g, function replaceDisplayMathEnd() {
        return '\n$$';
      })
      .replace(/\\\(\s*/g, '$')
      .replace(/\s*\\\)/g, '$');
  }

  function normalizeContent(content) {
    const lines = String(content).split('\n');
    let inCodeFence = false;

    return lines.map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      if (inCodeFence) {
        return line;
      }

      return normalizeMathInText(line);
    }).join('\n');
  }

  function renderMessage(message) {
    const content = normalizeContent(message.content);

    if (message.role === 'user') {
      return '## 你\n\n' + content + '\n\n';
    }

    if (message.role === 'assistant') {
      return '## ChatGPT\n\n' + content + '\n\n';
    }

    return '';
  }

  function generateMarkdown(parsedData) {
    if (!parsedData) {
      return '';
    }

    const title = parsedData.title || 'Untitled Conversation';
    let markdown = renderHeader(title);

    if (!Array.isArray(parsedData.messages)) {
      return markdown;
    }

    for (const message of parsedData.messages) {
      markdown += renderMessage(message);
    }

    return markdown;
  }

  globalScope.generateMarkdown = generateMarkdown;
})(globalThis);
