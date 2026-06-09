'use strict';

const DEFAULT_FOLDER_NAME = 'chatgpt-inbox';
const DEFAULT_SAVE_MODE = 'ask';

const folderSection = document.getElementById('folder-section');
const modeCardAsk = document.getElementById('mode-card-ask');
const modeCardAuto = document.getElementById('mode-card-auto');

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

function setSelectedCard(mode) {
  modeCardAsk.setAttribute('aria-checked', mode === 'ask' ? 'true' : 'false');
  modeCardAuto.setAttribute('aria-checked', mode === 'auto' ? 'true' : 'false');
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
  await chrome.storage.sync.set({ settings });
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
    setSelectedCard(saveMode);
    setFolderSectionVisible(saveMode === 'auto');
    updateFolderPreview(folderName, saveMode);
    renderExportHistory(historyResult.exportHistory);
  } catch (error) {
    folderInput.value = DEFAULT_FOLDER_NAME;
    setSelectedCard(DEFAULT_SAVE_MODE);
    setFolderSectionVisible(false);
    updateFolderPreview(DEFAULT_FOLDER_NAME, DEFAULT_SAVE_MODE);
    renderExportHistory([]);
  }
}

async function saveFolderName() {
  const folderInput = document.getElementById('folder-name');
  const folderName = folderInput.value.trim();

  if (!folderName) {
    showSaveStatus('文件夹名称不能为空', 'error');
    return;
  }

  try {
    const result = await chrome.storage.sync.get('settings');
    const settings = result.settings || {};
    settings.folderName = folderName;
    await chrome.storage.sync.set({ settings });
    folderInput.value = folderName;
    updateFolderPreview(folderName, settings.saveMode || DEFAULT_SAVE_MODE);
    showSaveStatus('已保存', 'success');
  } catch (error) {
    showSaveStatus('保存失败，请重试', 'error');
  }
}

async function handleModeChange(mode) {
  setSelectedCard(mode);
  await saveSaveMode(mode);
  const folderInput = document.getElementById('folder-name');
  const folderName = folderInput.value.trim() || DEFAULT_FOLDER_NAME;

  if (mode === 'ask') {
    setFolderSectionVisible(false);
  } else {
    setFolderSectionVisible(true);
  }
  updateFolderPreview(folderName, mode);
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('save-button').addEventListener('click', saveFolderName);

  modeCardAsk.addEventListener('click', () => handleModeChange('ask'));
  modeCardAuto.addEventListener('click', () => handleModeChange('auto'));

  await loadSettings();
});
