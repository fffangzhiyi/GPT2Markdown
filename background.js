'use strict';

const CHATGPT_URL_PART = 'chatgpt.com';
const EXPORT_COMMAND = 'export-conversation';
const EXPORT_ACTION = 'exportCurrentConversation';
const STATUS_ACTION = 'getExportStatus';

function isChatGPTTab(tab) {
  return Boolean(tab && tab.url && tab.url.includes(CHATGPT_URL_PART));
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

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: EXPORT_ACTION
    });
    if (response && response.status === 'success') {
      await saveExportRecord({
        filename: response.detail.filename,
        title: response.detail.title || ''
      });
    }
    return response;
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

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: EXPORT_ACTION
    });
    if (response && response.status === 'success') {
      await saveExportRecord({
        filename: response.detail.filename,
        title: response.detail.title || ''
      });
    }
  } catch (error) {
  }
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
      sendResponse({
        lastExportTime: last ? last.timestamp : null,
        lastExportFilename: last ? last.filename : ''
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

  return false;
});
