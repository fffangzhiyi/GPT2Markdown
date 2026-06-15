'use strict';

(function initContent(globalScope) {
  const REQUEST_TYPE = 'GPT2MD_EXPORT_REQUEST';
  const RESULT_TYPE = 'GPT2MD_EXPORT_RESULT';
  const SELECTION_ENTER_TYPE = 'GPT2MD_ENTER_SELECTION';
  const SELECTION_EXIT_TYPE = 'GPT2MD_EXIT_SELECTION';
  const BATCH_LIST_REQUEST_TYPE = 'GPT2MD_GET_BATCH_CONVERSATIONS';
  const BATCH_LIST_RESULT_TYPE = 'GPT2MD_BATCH_CONVERSATIONS_RESULT';
  const BATCH_START_TYPE = 'GPT2MD_START_BATCH_EXPORT';
  const PREFETCH_TYPE = 'GPT2MD_PREFETCH';
  const DEFAULT_FOLDER_NAME = 'chatgpt-inbox';
  const EXPORT_TIMEOUT_MS = 15000;
  let batchRequestCounter = 0;

  function requestMainWorldExport(folderName) {
    return new Promise((resolve) => {
      const timeoutId = globalScope.setTimeout(() => {
        globalScope.window.removeEventListener('message', handleMessage);
        resolve({
          status: 'error',
          detail: {
            error: 'TIMEOUT'
          }
        });
      }, EXPORT_TIMEOUT_MS);

      function handleMessage(event) {
        if (!event.data || event.data.type !== RESULT_TYPE) {
          return;
        }

        globalScope.clearTimeout(timeoutId);
        globalScope.window.removeEventListener('message', handleMessage);
        resolve({
          status: event.data.status,
          detail: event.data.detail
        });
      }

      globalScope.window.addEventListener('message', handleMessage);
      globalScope.window.postMessage({
        type: REQUEST_TYPE,
        folderName
      }, '*');
    });
  }

  function requestBatchConversations() {
    return new Promise((resolve) => {
      batchRequestCounter += 1;
      const requestId = 'batch-' + Date.now() + '-' + batchRequestCounter;
      const timeoutId = globalScope.setTimeout(() => {
        globalScope.window.removeEventListener('message', handleMessage);
        resolve({
          status: 'error',
          detail: {
            error: 'TIMEOUT'
          }
        });
      }, EXPORT_TIMEOUT_MS);

      function handleMessage(event) {
        if (
          !event.data
          || event.data.type !== BATCH_LIST_RESULT_TYPE
          || event.data.requestId !== requestId
        ) {
          return;
        }

        globalScope.clearTimeout(timeoutId);
        globalScope.window.removeEventListener('message', handleMessage);
        resolve({
          status: event.data.status,
          detail: event.data.detail
        });
      }

      globalScope.window.addEventListener('message', handleMessage);
      globalScope.window.postMessage({
        type: BATCH_LIST_REQUEST_TYPE,
        requestId
      }, '*');
    });
  }

  globalScope.window.addEventListener('message', (event) => {
    if (
      !event.data
      || event.data.type !== RESULT_TYPE
      || event.data.selectionExport !== true
    ) {
      return;
    }

    globalScope.chrome.runtime.sendMessage({
      action: 'processSelectionExportResult',
      response: {
        action: 'exportResult',
        status: event.data.status,
        detail: event.data.detail
      }
    });
  });

  globalScope.window.addEventListener('message', (event) => {
    if (
      !event.data
      || event.data.type !== RESULT_TYPE
      || event.data.batchExport !== true
    ) {
      return;
    }

    globalScope.chrome.runtime.sendMessage({
      action: 'processBatchExportResult',
      response: {
        action: 'exportResult',
        status: event.data.status,
        detail: event.data.detail,
        batchExport: true,
        batchSummary: Boolean(event.data.batchSummary)
      }
    });
  });

  globalScope.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.action === 'enterSelectionMode') {
      globalScope.window.postMessage({
        type: SELECTION_ENTER_TYPE
      }, '*');
      sendResponse({
        status: 'success'
      });
      return false;
    }

    if (message.action === 'exitSelectionMode') {
      globalScope.window.postMessage({
        type: SELECTION_EXIT_TYPE
      }, '*');
      sendResponse({
        status: 'success'
      });
      return false;
    }

    if (message.action === 'getBatchConversations') {
      requestBatchConversations().then((result) => {
        sendResponse(result);
      });
      return true;
    }

    if (message.action === 'startBatchExport') {
      globalScope.window.postMessage({
        type: BATCH_START_TYPE,
        items: Array.isArray(message.items) ? message.items : []
      }, '*');
      sendResponse({
        status: 'success'
      });
      return false;
    }

    if (message.action === 'prefetchConversation') {
      globalScope.window.postMessage({
        type: PREFETCH_TYPE
      }, '*');
      return false;
    }

    if (message.action !== 'exportCurrentConversation') {
      return false;
    }

    requestMainWorldExport(message.folderName || DEFAULT_FOLDER_NAME).then((result) => {
      sendResponse({
        action: 'exportResult',
        status: result.status,
        detail: result.detail
      });
    });

    return true;
  });
})(globalThis);
