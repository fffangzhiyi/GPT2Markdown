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
    const markdown = globalScope.generateMarkdown(parsed);
    const downloadResult = await globalScope.downloadMarkdown(markdown, parsed.title, event.data.folderName);
    if (!downloadResult.success) {
      postResult('error', {
        error: downloadResult.error
      });
      return;
    }

    postResult('success', {
      filename: downloadResult.filename,
      title: parsed.title
    });
  }

  globalScope.window.addEventListener('message', handleExportRequest);
})(globalThis);
