'use strict';

(function initContent(globalScope) {
  const REQUEST_TYPE = 'GPT2MD_EXPORT_REQUEST';
  const RESULT_TYPE = 'GPT2MD_EXPORT_RESULT';
  const SELECTION_ENTER_TYPE = 'GPT2MD_ENTER_SELECTION';
  const SELECTION_EXIT_TYPE = 'GPT2MD_EXIT_SELECTION';
  const BATCH_ENTER_TYPE = 'GPT2MD_ENTER_BATCH';
  const DEFAULT_FOLDER_NAME = 'chatgpt-inbox';
  const EXPORT_TIMEOUT_MS = 15000;

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

    if (message.action === 'enterBatchMode') {
      globalScope.window.postMessage({
        type: BATCH_ENTER_TYPE
      }, '*');
      sendResponse({
        status: 'success'
      });
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
