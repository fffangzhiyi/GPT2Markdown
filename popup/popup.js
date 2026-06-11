'use strict';

var fullExportBtn = document.getElementById('full-export-btn');
var selectExportBtn = document.getElementById('select-export-btn');
var batchExportBtn = document.getElementById('batch-export-btn');
var conversationActions = document.getElementById('conversation-actions');
var historyActions = document.getElementById('history-actions');
var otherMessage = document.getElementById('other-message');
var statusElement = document.getElementById('status');
var voiceWarningElement = document.getElementById('voice-warning');
var lastExportElement = document.getElementById('last-export');
var settingsLink = document.getElementById('settings-link');

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(timestamp) {
  var date = new Date(timestamp);
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('-') + ' ' + [
    padNumber(date.getHours()),
    padNumber(date.getMinutes())
  ].join(':');
}

function setStatus(message, type) {
  statusElement.textContent = message;
  statusElement.className = type ? 'status ' + type : 'status';
}

function setVoiceWarning(isVisible) {
  if (!isVisible) {
    voiceWarningElement.textContent = '';
    voiceWarningElement.className = 'voice-warning';
    return;
  }
  voiceWarningElement.textContent = '目前不支持语音消息导出，语音消息将被占位符替换。';
  voiceWarningElement.className = 'voice-warning visible';
}

function getErrorMessage(error) {
  var messages = {
    NOT_ON_CHATGPT_PAGE: '请在 ChatGPT 对话页面使用',
    NOT_A_CONVERSATION_PAGE: '请在 ChatGPT 对话页面使用',
    CONTENT_SCRIPT_NOT_READY: '请刷新页面后重试',
    NETWORK_ERROR: '网络请求失败，请检查登录状态',
    UNAUTHORIZED: '请先登录 ChatGPT',
    TIMEOUT: '请求超时，请重试',
    RATE_LIMITED: '请求过于频繁，请稍后重试',
    PARSE_ERROR: 'API 返回数据异常，请刷新后重试',
    NO_CONTENT: '对话内容为空，无法导出',
    DOWNLOAD_FAILED: '文件下载失败，请检查下载权限'
  };
  return messages[error] || '导出失败，请重试';
}

function setButtonLoading(button, isLoading, loadingText, normalText) {
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : normalText;
  if (isLoading) {
    button.classList.add('loading');
  } else {
    button.classList.remove('loading');
  }
}

function showPageContext(context) {
  conversationActions.hidden = context !== 'conversation';
  historyActions.hidden = context !== 'history';
  otherMessage.hidden = context !== 'other';
}

function refreshExportStatus() {
  chrome.runtime.sendMessage({
    action: 'getExportStatus'
  }, function (response) {
    if (chrome.runtime.lastError) {
      return;
    }

    if (response && response.lastExportTime) {
      lastExportElement.textContent = '上次导出: ' + formatDateTime(response.lastExportTime);
    } else {
      lastExportElement.textContent = '暂无导出记录';
    }

    showPageContext(response && response.pageContext ? response.pageContext : 'other');
  });
}

function handleExportResponse(response) {
  if (response && response.status === 'success') {
    setVoiceWarning(Boolean(response.detail && response.detail.hasUnsupportedContent));
    setStatus('✅ 已导出: ' + response.detail.filename, 'success');
    refreshExportStatus();
    return;
  }

  setVoiceWarning(false);
  var error = response && response.detail ? response.detail.error : '';
  setStatus(getErrorMessage(error), 'error');
}

function exportCurrentConversation() {
  setButtonLoading(fullExportBtn, true, '导出中...', '全量导出');
  setStatus('', '');
  setVoiceWarning(false);

  chrome.runtime.sendMessage({
    action: 'exportCurrentConversation'
  }, function (response) {
    setButtonLoading(fullExportBtn, false, '', '全量导出');
    handleExportResponse(response);
  });
}

function enterSelectionMode() {
  chrome.runtime.sendMessage({
    action: 'enterSelectionMode'
  }, function (response) {
    if (chrome.runtime.lastError) {
      return;
    }
    if (response && response.status === 'success') {
      window.close();
      return;
    }
    var error = response && response.detail ? response.detail.error : '';
    setStatus(getErrorMessage(error), 'error');
  });
}

function enterBatchMode() {
  setStatus('此功能开发中，即将上线', 'success');
}

fullExportBtn.addEventListener('click', exportCurrentConversation);
selectExportBtn.addEventListener('click', enterSelectionMode);
batchExportBtn.addEventListener('click', enterBatchMode);

settingsLink.addEventListener('click', function (event) {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

refreshExportStatus();
