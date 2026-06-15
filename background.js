'use strict';

const CHATGPT_URL_PART = 'chatgpt.com';
const EXPORT_COMMAND = 'export-conversation';
const EXPORT_ACTION = 'exportCurrentConversation';
const STATUS_ACTION = 'getExportStatus';
const DEFAULT_FOLDER_NAME = 'chatgpt-inbox';
const DEFAULT_SAVE_MODE = 'auto';

const pendingDownloadFilenames = [];

function isChatGPTTab(tab) {
  return Boolean(tab && tab.url && tab.url.includes(CHATGPT_URL_PART));
}

function getPageContext(tab) {
  if (!tab || !tab.url || !tab.url.includes(CHATGPT_URL_PART)) {
    return 'other';
  }
  if (tab.url.includes('/c/')) {
    return 'conversation';
  }
  return 'history';
}

async function showNotChatGPTBadge() {
  await chrome.action.setBadgeText({
    text: '!'
  });
  setTimeout(() => {
    chrome.action.setBadgeText({
      text: ''
    });
  }, 2000);
}

async function showLoadingBadge() {
  await chrome.action.setBadgeText({
    text: '⏳'
  });
  await chrome.action.setBadgeBackgroundColor({
    color: '#666'
  });
}

async function clearBadge() {
  await chrome.action.setBadgeText({
    text: ''
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0] || null;
}

async function saveExportRecord({ filename, title }) {
  const {
    exportHistory = []
  } = await chrome.storage.sync.get('exportHistory');
  exportHistory.unshift({
    timestamp: Date.now(),
    filename,
    title
  });
  await chrome.storage.sync.set({
    exportHistory: exportHistory.slice(0, 10)
  });
}

async function getFolderName() {
  const result = await chrome.storage.sync.get('settings');
  const settings = result.settings || {};
  return settings.folderName || DEFAULT_FOLDER_NAME;
}

async function getSaveMode() {
  const result = await chrome.storage.sync.get('settings');
  const settings = result.settings || {};
  return settings.saveMode || DEFAULT_SAVE_MODE;
}

function createMarkdownDataUrl(markdown) {
  return 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown);
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (
    downloadItem.url.startsWith('data:text/markdown')
    && pendingDownloadFilenames.length > 0
  ) {
    const pendingDownload = pendingDownloadFilenames.shift();
    suggest({
      filename: pendingDownload.filename,
      conflictAction: 'uniquify'
    });
    return;
  }
  suggest();
});

async function processExportResponse(response, folderName) {
  if (
    !response
    || response.status !== 'success'
    || !response.detail
    || !Object.prototype.hasOwnProperty.call(response.detail, 'markdown')
  ) {
    return response;
  }

  if (response.detail.markdown === '') {
    return {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'NO_CONTENT'
      }
    };
  }

  const saveMode = await getSaveMode();
  const targetFilename = saveMode === 'auto'
    ? folderName + '/' + response.detail.filename
    : response.detail.filename;
  const pendingDownload = {
    filename: targetFilename
  };
  pendingDownloadFilenames.push(pendingDownload);

  try {
    if (saveMode === 'auto') {
      await chrome.downloads.download({
        url: createMarkdownDataUrl(response.detail.markdown),
        filename: targetFilename,
        saveAs: false
      });
    } else {
      await chrome.downloads.download({
        url: createMarkdownDataUrl(response.detail.markdown),
        saveAs: true
      });
    }
  } catch (error) {
    const pendingIndex = pendingDownloadFilenames.indexOf(pendingDownload);
    if (pendingIndex !== -1) {
      pendingDownloadFilenames.splice(pendingIndex, 1);
    }
    return {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'DOWNLOAD_FAILED'
      }
    };
  }

  await saveExportRecord({
    filename: response.detail.filename,
    title: response.detail.title || ''
  });

  const detail = {
    filename: response.detail.filename,
    title: response.detail.title || ''
  };

  if (response.detail.hasUnsupportedContent) {
    detail.hasUnsupportedContent = true;
  }

  return {
    action: 'exportResult',
    status: 'success',
    detail
  };
}

async function exportFromActiveTab() {
  const tab = await getActiveTab();
  if (!isChatGPTTab(tab)) {
    return {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'NOT_ON_CHATGPT_PAGE'
      }
    };
  }

  const folderName = await getFolderName();

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: EXPORT_ACTION,
      folderName
    });
    return await processExportResponse(response, folderName);
  } catch (error) {
    return {
      action: 'exportResult',
      status: 'error',
      detail: {
        error: 'CONTENT_SCRIPT_NOT_READY'
      }
    };
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== EXPORT_COMMAND) {
    return;
  }

  const tab = await getActiveTab();
  if (!isChatGPTTab(tab)) {
    await showNotChatGPTBadge();
    return;
  }

  const folderName = await getFolderName();

  await showLoadingBadge();

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: EXPORT_ACTION,
      folderName
    });
    await processExportResponse(response, folderName);
  } catch (error) {
  }

  await clearBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.action === STATUS_ACTION) {
    (async () => {
      const {
        exportHistory = []
      } = await chrome.storage.sync.get('exportHistory');
      const last = exportHistory[0] || null;
      const tab = await getActiveTab();
      sendResponse({
        lastExportTime: last ? last.timestamp : null,
        lastExportFilename: last ? last.filename : '',
        pageContext: getPageContext(tab)
      });
    })();
    return true;
  }

  if (message.action === EXPORT_ACTION) {
    (async () => {
      const response = await exportFromActiveTab();
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'enterSelectionMode') {
    (async () => {
      const tab = await getActiveTab();
      if (!isChatGPTTab(tab)) {
        sendResponse({
          status: 'error',
          detail: {
            error: 'NOT_ON_CHATGPT_PAGE'
          }
        });
        return;
      }
      if (getPageContext(tab) !== 'conversation') {
        sendResponse({
          status: 'error',
          detail: {
            error: 'NOT_A_CONVERSATION_PAGE'
          }
        });
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'enterSelectionMode'
        });
        sendResponse({
          status: 'success'
        });
      } catch (error) {
        sendResponse({
          status: 'error',
          detail: {
            error: 'CONTENT_SCRIPT_NOT_READY'
          }
        });
      }
    })();
    return true;
  }

  if (message.action === 'getBatchConversations') {
    (async () => {
      const tab = await getActiveTab();
      if (!isChatGPTTab(tab)) {
        sendResponse({
          status: 'error',
          detail: {
            error: 'NOT_ON_CHATGPT_PAGE'
          }
        });
        return;
      }
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'getBatchConversations'
        });
        sendResponse(response);
      } catch (error) {
        sendResponse({
          status: 'error',
          detail: {
            error: 'CONTENT_SCRIPT_NOT_READY'
          }
        });
      }
    })();
    return true;
  }

  if (message.action === 'startBatchExport') {
    (async () => {
      const tab = await getActiveTab();
      if (!isChatGPTTab(tab)) {
        sendResponse({
          status: 'error',
          detail: {
            error: 'NOT_ON_CHATGPT_PAGE'
          }
        });
        return;
      }
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'startBatchExport',
          items: Array.isArray(message.items) ? message.items : []
        });
        sendResponse(response);
      } catch (error) {
        sendResponse({
          status: 'error',
          detail: {
            error: 'CONTENT_SCRIPT_NOT_READY'
          }
        });
      }
    })();
    return true;
  }

  if (message.action === 'prefetchConversation') {
    (async () => {
      const tab = await getActiveTab();
      if (!isChatGPTTab(tab)) {
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'prefetchConversation'
        });
      } catch (error) {
      }
    })();
    return false;
  }

  if (message.action === 'processSelectionExportResult') {
    (async () => {
      const folderName = await getFolderName();
      const response = await processExportResponse(message.response, folderName);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'processBatchExportResult') {
    (async () => {
      const folderName = await getFolderName();
      const response = await processExportResponse(message.response, folderName);
      sendResponse(response);
    })();
    return true;
  }

  return false;
});
