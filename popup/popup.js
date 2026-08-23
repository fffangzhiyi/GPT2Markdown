'use strict';

var fullExportBtn = document.getElementById('full-export-btn');
var selectExportBtn = document.getElementById('select-export-btn');
var conversationBatchExportBtn = document.getElementById('conversation-batch-export-btn');
var batchExportBtn = document.getElementById('batch-export-btn');
var conversationActions = document.getElementById('conversation-actions');
var historyActions = document.getElementById('history-actions');
var otherMessage = document.getElementById('other-message');
var contextDescription = document.getElementById('context-description');
var contextSummary = document.getElementById('context-summary');
var statusElement = document.getElementById('status');
var voiceWarningElement = document.getElementById('voice-warning');
var lastExportElement = document.getElementById('last-export');
var conversationFooterActions = document.getElementById('conversation-footer-actions');
var historyFooterActions = document.getElementById('history-footer-actions');
var settingsLink = document.getElementById('settings-link');
var headerSettingsBtn = document.getElementById('header-settings-btn');
var mainView = document.getElementById('main-view');
var batchPanel = document.getElementById('batch-panel');
var batchList = document.getElementById('batch-list');
var batchEmpty = document.getElementById('batch-empty');
var batchSelectedCount = document.getElementById('batch-selected-count');
var startBatchExportBtn = document.getElementById('start-batch-export-btn');
var reloadListBtn = document.getElementById('reload-list-btn');
var backBtn = document.getElementById('back-btn');
var batchStatus = document.getElementById('batch-status');
var selectedBatchItems = new Map();

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function formatTime(timestamp) {
  var date = new Date(timestamp);
  return padNumber(date.getHours()) + ':' + padNumber(date.getMinutes());
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

function openSettings(event) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }
  chrome.runtime.openOptionsPage();
}

function showPageContext(context) {
  conversationActions.hidden = context !== 'conversation';
  historyActions.hidden = context !== 'history';
  otherMessage.hidden = context !== 'other';
  if (conversationFooterActions) {
    conversationFooterActions.hidden = context !== 'conversation';
  }
  if (historyFooterActions) {
    historyFooterActions.hidden = context !== 'history';
  }

  if (contextDescription) {
    if (context === 'conversation') {
      contextDescription.textContent = '检测到当前为 ChatGPT 对话页面。';
    } else if (context === 'history') {
      contextDescription.textContent = '从历史记录中选择多个对话。';
    } else {
      contextDescription.textContent = '';
    }
  }

  if (contextSummary && context === 'conversation') {
    contextSummary.textContent = '可导出当前完整对话或选择部分消息';
  }
}

function refreshExportStatus() {
  chrome.runtime.sendMessage({
    action: 'getExportStatus'
  }, function (response) {
    if (chrome.runtime.lastError) {
      return;
    }

    if (response && response.lastExportTime) {
      lastExportElement.textContent = '上次导出 ' + formatTime(response.lastExportTime);
    } else {
      lastExportElement.textContent = '暂无导出记录';
    }

    showPageContext(response && response.pageContext ? response.pageContext : 'other');

    if (response && response.pageContext === 'conversation') {
      chrome.runtime.sendMessage({
        action: 'prefetchConversation'
      });
    }
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
  setButtonLoading(fullExportBtn, true, '导出中…', '导出 Markdown');
  setStatus('', '');
  setVoiceWarning(false);

  chrome.runtime.sendMessage({
    action: 'exportCurrentConversation'
  }, function (response) {
    setButtonLoading(fullExportBtn, false, '', '导出 Markdown');
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

function setBatchStatus(message, type) {
  batchStatus.textContent = message || '';
  batchStatus.className = type ? 'batch-status ' + type : 'batch-status';
}

function sendToActiveChatGPTTab(message, callback) {
  chrome.tabs.query({
    active: true,
    url: 'https://chatgpt.com/*'
  }, function (tabs) {
    if (chrome.runtime.lastError) {
      callback(null, 'TAB_QUERY_FAILED');
      return;
    }

    var tab = tabs && tabs[0];
    if (!tab) {
      callback(null, 'NO_CHATGPT_TAB');
      return;
    }

    chrome.tabs.sendMessage(tab.id, message, function (response) {
      if (chrome.runtime.lastError) {
        callback(null, 'CONTENT_SCRIPT_NOT_READY');
        return;
      }
      callback(response, '');
    });
  });
}

function updateBatchSelectionState() {
  var count = selectedBatchItems.size;
  batchSelectedCount.textContent = '已选择 ' + count + ' 条';
  startBatchExportBtn.textContent = '导出 ' + count + ' 个对话';
  startBatchExportBtn.disabled = count === 0;
}

function groupBatchConversations(items) {
  var groups = [];
  var groupsByKey = {};

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var key = item.projectKey || '__ungrouped__';
    if (!groupsByKey[key]) {
      groupsByKey[key] = {
        title: item.projectTitle || '未分组对话',
        items: []
      };
      groups.push(groupsByKey[key]);
    }
    groupsByKey[key].items.push(item);
  }

  return groups;
}

function renderBatchConversations(items) {
  selectedBatchItems.clear();
  batchList.replaceChildren();
  batchEmpty.hidden = items.length > 0;

  if (items.length === 0) {
    batchEmpty.textContent = '未读取到对话，请先完全展开 ChatGPT 对话列表后重新读取。';
    updateBatchSelectionState();
    return;
  }

  var groups = groupBatchConversations(items);
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    var section = document.createElement('div');
    section.className = 'batch-group';

    var heading = document.createElement('div');
    heading.className = 'batch-group-title';
    heading.textContent = group.title + ' ' + group.items.length;
    section.appendChild(heading);

    var options = document.createElement('div');
    options.className = 'batch-group-items';

    for (var j = 0; j < group.items.length; j++) {
      (function (item) {
        var label = document.createElement('label');
        label.className = 'batch-item';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = false;
        checkbox.dataset.id = item.id;
        checkbox.dataset.title = item.title;
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) {
            selectedBatchItems.set(item.id, {
              id: item.id,
              title: item.title
            });
            label.classList.add('batch-item-selected');
          } else {
            selectedBatchItems.delete(item.id);
            label.classList.remove('batch-item-selected');
          }
          updateBatchSelectionState();
        });

        var title = document.createElement('span');
        title.className = 'batch-item-title';
        title.textContent = item.title;

        label.appendChild(checkbox);
        label.appendChild(title);
        options.appendChild(label);
      })(group.items[j]);
    }

    section.appendChild(options);
    batchList.appendChild(section);
  }

  updateBatchSelectionState();
}

function loadBatchConversations() {
  setButtonLoading(reloadListBtn, true, '↻', '↻');
  setBatchStatus('', '');

  sendToActiveChatGPTTab({
    action: 'getBatchConversations'
  }, function (response, error) {
    setButtonLoading(reloadListBtn, false, '', '↻');

    if (error === 'NO_CHATGPT_TAB') {
      renderBatchConversations([]);
      setBatchStatus('未找到 ChatGPT 页面', 'error');
      return;
    }

    if (error) {
      setBatchStatus('读取失败，请重试', 'error');
      return;
    }

    if (response && response.status === 'success') {
      var items = response.detail && Array.isArray(response.detail.items)
        ? response.detail.items
        : [];
      renderBatchConversations(items);
      return;
    }

    renderBatchConversations([]);
    setBatchStatus('读取失败，请重试', 'error');
  });
}

function startBatchExport() {
  if (selectedBatchItems.size === 0) {
    return;
  }

  var items = Array.from(selectedBatchItems.values());
  setButtonLoading(startBatchExportBtn, true, '启动中…', '导出 ' + items.length + ' 个对话');
  setBatchStatus('', '');

  sendToActiveChatGPTTab({
    action: 'startBatchExport',
    items: items
  }, function (response, error) {
    if (error) {
      setBatchStatus('启动失败，请重试', 'error');
      updateBatchSelectionState();
      return;
    }

    if (response && response.status === 'success') {
      window.close();
      return;
    }

    setBatchStatus('启动失败，请重试', 'error');
    updateBatchSelectionState();
  });
}

function enterBatchMode() {
  mainView.hidden = true;
  batchPanel.hidden = false;
  document.body.classList.add('batch-mode');
  loadBatchConversations();
}

function exitBatchMode() {
  mainView.hidden = false;
  batchPanel.hidden = true;
  document.body.classList.remove('batch-mode');
  setBatchStatus('', '');
}

fullExportBtn.addEventListener('click', exportCurrentConversation);
selectExportBtn.addEventListener('click', enterSelectionMode);
if (conversationBatchExportBtn) {
  conversationBatchExportBtn.addEventListener('click', enterBatchMode);
}
batchExportBtn.addEventListener('click', enterBatchMode);
if (startBatchExportBtn && reloadListBtn && backBtn) {
  startBatchExportBtn.addEventListener('click', startBatchExport);
  reloadListBtn.addEventListener('click', loadBatchConversations);
  backBtn.addEventListener('click', exitBatchMode);
}

settingsLink.addEventListener('click', openSettings);
if (headerSettingsBtn) {
  headerSettingsBtn.addEventListener('click', openSettings);
}

refreshExportStatus();
