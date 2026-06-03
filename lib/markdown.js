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

  function renderMessage(message) {
    if (message.role === 'user') {
      return '## 你\n\n' + message.content + '\n\n';
    }

    if (message.role === 'assistant') {
      return '## ChatGPT\n\n' + message.content + '\n\n';
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
