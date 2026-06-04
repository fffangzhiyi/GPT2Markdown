'use strict';

const exportButton = document.getElementById('export-btn');
const statusElement = document.getElementById('status');
const lastExportElement = document.getElementById('last-export');
const settingsLink = document.getElementById('settings-link');

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

function setLoading(isLoading) {
  exportButton.disabled = isLoading;
  exportButton.textContent = isLoading ? '导出中...' : '导出当前对话';
  if (isLoading) {
    exportButton.classList.add('loading');
    return;
  }
  exportButton.classList.remove('loading');
}

function setStatus(message, type) {
  statusElement.textContent = message;
  statusElement.className = type ? 'status ' + type : 'status';
}

function getErrorMessage(error) {
  const messages = {
    NOT_ON_CHATGPT_PAGE: '请在 ChatGPT 对话页面使用',
    CONTENT_SCRIPT_NOT_READY: '请刷新页面后重试',
    NETWORK_ERROR: '网络请求失败，请检查登录状态',
    UNAUTHORIZED: '请先登录 ChatGPT',
    TIMEOUT: '请求超时，请重试',
    RATE_LIMITED: '请求过于频繁，请稍后重试',
    PARSE_ERROR: 'API 返回数据异常，请刷新后重试',
    CANCELLED: '已取消导出',
    NO_CONTENT: '对话内容为空，无法导出',
    DOWNLOAD_FAILED: '文件下载失败，请检查下载权限',
    DOM_PARSE_FAILED: '页面内容解析失败，请刷新后重试'
  };
  return messages[error] || '导出失败，请重试';
}

function refreshExportStatus() {
  chrome.runtime.sendMessage({
    action: 'getExportStatus'
  }, (response) => {
    if (response && response.lastExportTime) {
      lastExportElement.textContent = '上次导出: ' + formatDateTime(response.lastExportTime);
      return;
    }
    lastExportElement.textContent = '暂无导出记录';
  });
}

function exportCurrentConversation() {
  setLoading(true);
  setStatus('', '');
  chrome.runtime.sendMessage({
    action: 'exportCurrentConversation'
  }, (response) => {
    setLoading(false);
    if (response && response.status === 'success') {
      setStatus('✅ 已导出: ' + response.detail.filename, 'success');
      refreshExportStatus();
      return;
    }

    const error = response && response.detail ? response.detail.error : '';
    setStatus(getErrorMessage(error), 'error');
  });
}

exportButton.addEventListener('click', exportCurrentConversation);

settingsLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

refreshExportStatus();
