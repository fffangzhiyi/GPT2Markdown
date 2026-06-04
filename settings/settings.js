'use strict';

const DEFAULT_FOLDER_NAME = 'chatgpt-inbox';

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('-') + ' ' + [
    padNumber(date.getHours()),
    padNumber(date.getMinutes())
  ].join(':');
}

function updateFolderPreview(folderName) {
  document.getElementById('folder-preview').textContent = '文件保存到: 下载/' + folderName + '/';
}

function showSaveStatus(message, type) {
  const statusElement = document.getElementById('save-status');
  statusElement.textContent = message;
  statusElement.className = type ? 'save-status ' + type : 'save-status';
  setTimeout(() => {
    statusElement.textContent = '';
    statusElement.className = 'save-status';
  }, 2000);
}

function renderExportHistory(exportHistory) {
  const historyList = document.getElementById('history-list');
  historyList.replaceChildren();

  const records = Array.isArray(exportHistory)
    ? exportHistory.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 10)
    : [];

  if (records.length === 0) {
    const emptyElement = document.createElement('p');
    emptyElement.className = 'empty-history';
    emptyElement.textContent = '暂无导出记录';
    historyList.appendChild(emptyElement);
    return;
  }

  for (const record of records) {
    const item = document.createElement('p');
    item.className = 'history-item';
    item.textContent = formatDateTime(record.timestamp) + ' · ' + (record.title || record.filename || '未命名对话');
    historyList.appendChild(item);
  }
}

async function loadSettings() {
  const folderInput = document.getElementById('folder-name');

  try {
    const [settingsResult, historyResult] = await Promise.all([
      chrome.storage.sync.get('settings'),
      chrome.storage.sync.get('exportHistory')
    ]);
    const folderName = settingsResult.settings && settingsResult.settings.folderName
      ? settingsResult.settings.folderName
      : DEFAULT_FOLDER_NAME;

    folderInput.value = folderName;
    updateFolderPreview(folderName);
    renderExportHistory(historyResult.exportHistory);
  } catch (error) {
    folderInput.value = DEFAULT_FOLDER_NAME;
    updateFolderPreview(DEFAULT_FOLDER_NAME);
    renderExportHistory([]);
  }
}

async function saveFolderName() {
  const folderInput = document.getElementById('folder-name');
  const folderName = folderInput.value.trim();

  if (!folderName) {
    showSaveStatus('⚠️ 文件夹名称不能为空', 'error');
    return;
  }

  try {
    await chrome.storage.sync.set({
      settings: {
        folderName
      }
    });
    folderInput.value = folderName;
    updateFolderPreview(folderName);
    showSaveStatus('✅ 已保存', 'success');
  } catch (error) {
    showSaveStatus('⚠️ 保存失败，请重试', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('save-button').addEventListener('click', saveFolderName);
  await loadSettings();
});
