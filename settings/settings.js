'use strict';

const DEFAULT_FOLDER_NAME = 'chatgpt-inbox';
const DEFAULT_SAVE_MODE = 'ask';

const folderSection = document.getElementById('folder-section');
const saveModeAskRadio = document.getElementById('save-mode-ask');
const saveModeAutoRadio = document.getElementById('save-mode-auto');

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

function setFolderSectionVisible(visible) {
  if (visible) {
    folderSection.classList.remove('hidden');
  } else {
    folderSection.classList.add('hidden');
  }
}

async function saveSaveMode(mode) {
  const result = await chrome.storage.sync.get('settings');
  const settings = result.settings || {};
  settings.saveMode = mode;
  await chrome.storage.sync.set({
    settings
  });
}

function updateFolderPreview(folderName, saveMode) {
  const preview = document.getElementById('folder-preview');
  if (saveMode === 'ask') {
    preview.textContent = '';
  } else {
    preview.textContent = '文件保存到: 下载/' + folderName + '/';
  }
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
    const settings = settingsResult.settings || {};
    const folderName = settings.folderName || DEFAULT_FOLDER_NAME;
    const saveMode = settings.saveMode || DEFAULT_SAVE_MODE;

    folderInput.value = folderName;

    if (saveMode === 'ask') {
      saveModeAskRadio.checked = true;
      saveModeAutoRadio.checked = false;
      setFolderSectionVisible(false);
    } else {
      saveModeAutoRadio.checked = true;
      saveModeAskRadio.checked = false;
      setFolderSectionVisible(true);
    }

    updateFolderPreview(folderName, saveMode);
    renderExportHistory(historyResult.exportHistory);
  } catch (error) {
    folderInput.value = DEFAULT_FOLDER_NAME;
    saveModeAskRadio.checked = true;
    saveModeAutoRadio.checked = false;
    setFolderSectionVisible(false);
    updateFolderPreview(DEFAULT_FOLDER_NAME, DEFAULT_SAVE_MODE);
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
    const result = await chrome.storage.sync.get('settings');
    const settings = result.settings || {};
    settings.folderName = folderName;
    await chrome.storage.sync.set({
      settings
    });
    folderInput.value = folderName;
    updateFolderPreview(folderName, settings.saveMode || DEFAULT_SAVE_MODE);
    showSaveStatus('✅ 已保存', 'success');
  } catch (error) {
    showSaveStatus('⚠️ 保存失败，请重试', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('save-button').addEventListener('click', saveFolderName);

  saveModeAskRadio.addEventListener('change', async () => {
    if (saveModeAskRadio.checked) {
      await saveSaveMode('ask');
      setFolderSectionVisible(false);
      const folderInput = document.getElementById('folder-name');
      updateFolderPreview(folderInput.value.trim() || DEFAULT_FOLDER_NAME, 'ask');
    }
  });

  saveModeAutoRadio.addEventListener('change', async () => {
    if (saveModeAutoRadio.checked) {
      await saveSaveMode('auto');
      setFolderSectionVisible(true);
      const folderInput = document.getElementById('folder-name');
      updateFolderPreview(folderInput.value.trim() || DEFAULT_FOLDER_NAME, 'auto');
    }
  });

  await loadSettings();
});
