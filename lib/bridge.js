'use strict';

(function initBridge(globalScope) {
  const REQUEST_TYPE = 'GPT2MD_EXPORT_REQUEST';
  const RESULT_TYPE = 'GPT2MD_EXPORT_RESULT';

  function postResult(status, detail) {
    globalScope.window.postMessage({
      type: RESULT_TYPE,
      status,
      detail
    }, '*');
  }

  function isUnsupportedContentPlaceholder(message) {
    if (!message || typeof message.content !== 'string') {
      return false;
    }

    if (message.content === '[non-text content]') {
      return true;
    }

    return typeof message.contentType === 'string'
      && message.contentType
      && message.content === '[' + message.contentType + ' message]';
  }

  function hasUnsupportedContent(parsed) {
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return messages.some(isUnsupportedContentPlaceholder);
  }

  async function exportParsedConversation(parsed) {
    const markdown = globalScope.generateMarkdown(parsed);
    const detail = {
      filename: globalScope.createFilename(parsed.title),
      title: parsed.title,
      markdown
    };

    if (hasUnsupportedContent(parsed)) {
      detail.hasUnsupportedContent = true;
    }

    postResult('success', detail);
  }

  async function handleExportRequest(event) {
    if (!event.data || event.data.type !== REQUEST_TYPE) {
      return;
    }

    const result = await globalScope.fetchConversation();
    if (!result.success) {
      postResult('error', {
        error: result.error
      });
      return;
    }

    const parsed = globalScope.parseConversation(result.data);
    await exportParsedConversation(parsed);
  }

  globalScope.window.addEventListener('message', handleExportRequest);
})(globalThis);
