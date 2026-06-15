'use strict';

(function initBridge(globalScope) {
  var REQUEST_TYPE = 'GPT2MD_EXPORT_REQUEST';
  var RESULT_TYPE = 'GPT2MD_EXPORT_RESULT';
  var SELECTION_ENTER_TYPE = 'GPT2MD_ENTER_SELECTION';
  var SELECTION_EXIT_TYPE = 'GPT2MD_EXIT_SELECTION';
  var BATCH_LIST_REQUEST_TYPE = 'GPT2MD_GET_BATCH_CONVERSATIONS';
  var BATCH_LIST_RESULT_TYPE = 'GPT2MD_BATCH_CONVERSATIONS_RESULT';
  var BATCH_START_TYPE = 'GPT2MD_START_BATCH_EXPORT';
  var PREFETCH_TYPE = 'GPT2MD_PREFETCH';

  var PREFETCH_TTL_MS = 180000;
  var PREFETCH_THROTTLE_MS = 30000;
  var DOM_STABILIZE_MS = 1500;
  var CONVERSATION_SETTLE_MS = 3000;
  var POLL_INTERVAL_MS = 5000;

  var selectionMode = false;
  var selectedIndices = new Set();
  var observer = null;
  var actionBar = null;
  var prefetchedData = null;
  var prefetchTimestamp = 0;
  var prefetchedMessageCount = 0;
  var lastConversationId = null;
  var pollTimer = null;
  var settleTimer = null;
  var batchMode = false;
  var batchSelectedIds = new Set();
  var batchActionBar = null;
  var batchRetryItems = null;
  var batchConversationTitles = {};

  function postResult(status, detail) {
    globalScope.window.postMessage({
      type: RESULT_TYPE,
      status: status,
      detail: detail
    }, '*');
  }

  function postSelectionResult(status, detail) {
    globalScope.window.postMessage({
      type: RESULT_TYPE,
      selectionExport: true,
      status: status,
      detail: detail
    }, '*');
  }

  function isUnsupportedContentPlaceholder(message) {
    if (!message || typeof message.content !== 'string') {
      return false;
    }
    if (message.content === '[non-text content]') {
      return true;
    }
    return typeof message.contentType === 'string'
      && message.contentType
      && message.content === '[' + message.contentType + ' message]';
  }

  function hasUnsupportedContent(parsed) {
    var messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return messages.some(isUnsupportedContentPlaceholder);
  }

  function getMessageElements() {
    var elements = globalScope.document.querySelectorAll('[data-message-author-role]');
    if (elements.length > 0) {
      return Array.from(elements);
    }

    elements = globalScope.document.querySelectorAll('[data-message-id]');
    if (elements.length > 0) {
      return Array.from(elements);
    }

    elements = globalScope.document.querySelectorAll('.group');
    if (elements.length > 0) {
      return Array.from(elements);
    }

    return Array.from(globalScope.document.querySelectorAll('article'));
  }

  function getHistoryConversationRows() {
    var links = globalScope.document.querySelectorAll('a[href*="/c/"]');
    var allLinks = globalScope.document.querySelectorAll('a[href]');
    var rows = [];
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.getAttribute('href') || '';
      var match = /\/c\/([a-zA-Z0-9-]+)/.exec(href);
      if (match) {
        var id = match[1];
        if (!rows.some(function (row) { return row.id === id; })) {
          var element = link.closest('li') || link.parentElement;
          var title = (link.textContent || '').trim();
          var projectMatch = /\/g\/([^/?#]+)\/c\/[a-zA-Z0-9-]+/.exec(href);
          var projectKey = projectMatch ? projectMatch[1] : '';
          var projectTitle = projectKey ? '项目对话' : '未分组对话';

          if (projectKey) {
            var projectPath = '/g/' + projectKey;
            for (var j = 0; j < allLinks.length; j++) {
              var candidateHref = allLinks[j].getAttribute('href') || '';
              var candidatePath = candidateHref
                .replace(/^https?:\/\/[^/]+/, '')
                .split(/[?#]/)[0];
              if (
                (
                  candidatePath === projectPath
                  || candidatePath.indexOf(projectPath + '/') === 0
                )
                && candidatePath.indexOf('/c/') === -1
              ) {
                var candidateTitle = (allLinks[j].textContent || '').trim();
                if (candidateTitle) {
                  projectTitle = candidateTitle;
                  break;
                }
              }
            }
          }

          rows.push({
            id: id,
            element: element,
            link: link,
            title: title || id,
            projectKey: projectKey,
            projectTitle: projectTitle
          });
        }
      }
    }
    return rows;
  }

  function postBatchConversationList(requestId) {
    var items = getHistoryConversationRows().map(function (row) {
      return {
        id: row.id,
        title: row.title,
        projectKey: row.projectKey,
        projectTitle: row.projectTitle
      };
    });

    globalScope.window.postMessage({
      type: BATCH_LIST_RESULT_TYPE,
      requestId: requestId,
      status: 'success',
      detail: {
        items: items
      }
    }, '*');
  }

  function injectStyles() {
    if (globalScope.document.getElementById('gpt2md-styles')) {
      return;
    }

    var style = globalScope.document.createElement('style');
    style.id = 'gpt2md-styles';
    style.textContent =
      '.gpt2md-checkbox-wrapper{' +
        'position:absolute;left:-32px;top:14px;z-index:10;' +
        'display:flex;align-items:center;justify-content:center;' +
      '}' +
      '.gpt2md-checkbox{' +
        'width:16px;height:16px;cursor:pointer;' +
        'accent-color:#10a37f;margin:0;' +
      '}' +
      '.gpt2md-message-container{position:relative;}' +
      '#gpt2md-action-bar{' +
        'position:fixed;bottom:0;left:0;right:0;z-index:99999;' +
        'background:#1a1a1a;border-top:1px solid #333;' +
        'padding:12px 24px;display:flex;align-items:center;' +
        'justify-content:center;gap:12px;' +
        'font-family:system-ui,-apple-system,sans-serif;' +
      '}' +
      '.gpt2md-action-btn{' +
        'padding:6px 16px;border:1px solid #555;border-radius:6px;' +
        'background:#2a2a2a;color:#eee;font-size:13px;' +
        'cursor:pointer;font-family:inherit;' +
      '}' +
      '.gpt2md-action-btn:hover{background:#3a3a3a;}' +
      '.gpt2md-primary-btn{' +
        'background:#10a37f;border-color:#10a37f;color:#fff;' +
      '}' +
      '.gpt2md-primary-btn:hover{background:#0d8c6d;}' +
      '.gpt2md-primary-btn:disabled{opacity:0.4;cursor:not-allowed;}';

    globalScope.document.head.appendChild(style);
  }

  function injectCheckbox(element, index) {
    var container = element.closest('article') || element;

    if (container.querySelector('.gpt2md-checkbox-wrapper')) {
      return;
    }

    var computed = globalScope.getComputedStyle(container);
    if (computed.position === 'static') {
      container.style.position = 'relative';
      container.dataset.gpt2mdRestorePosition = 'true';
    }
    container.classList.add('gpt2md-message-container');

    var wrapper = globalScope.document.createElement('div');
    wrapper.className = 'gpt2md-checkbox-wrapper';

    var checkbox = globalScope.document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gpt2md-checkbox';
    checkbox.checked = true;
    checkbox.dataset.index = String(index);

    checkbox.addEventListener('change', function () {
      if (checkbox.checked) {
        selectedIndices.add(index);
      } else {
        selectedIndices.delete(index);
      }
      updateSelectedCount();
    });

    wrapper.appendChild(checkbox);
    container.appendChild(wrapper);
    selectedIndices.add(index);
  }

  function injectActionBar() {
    if (actionBar) {
      return;
    }

    actionBar = globalScope.document.createElement('div');
    actionBar.id = 'gpt2md-action-bar';

    var selectAllBtn = globalScope.document.createElement('button');
    selectAllBtn.textContent = '全选';
    selectAllBtn.className = 'gpt2md-action-btn';
    selectAllBtn.addEventListener('click', selectAllMessages);

    var deselectAllBtn = globalScope.document.createElement('button');
    deselectAllBtn.textContent = '取消全选';
    deselectAllBtn.className = 'gpt2md-action-btn';
    deselectAllBtn.addEventListener('click', deselectAllMessages);

    var exportBtn = globalScope.document.createElement('button');
    exportBtn.id = 'gpt2md-export-selected-btn';
    exportBtn.className = 'gpt2md-action-btn gpt2md-primary-btn';
    exportBtn.addEventListener('click', exportSelected);

    var cancelBtn = globalScope.document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.className = 'gpt2md-action-btn';
    cancelBtn.addEventListener('click', exitSelectionMode);

    actionBar.appendChild(selectAllBtn);
    actionBar.appendChild(deselectAllBtn);
    actionBar.appendChild(exportBtn);
    actionBar.appendChild(cancelBtn);

    globalScope.document.body.appendChild(actionBar);
    updateSelectedCount();
  }

  function injectBatchActionBar() {
    if (batchActionBar) {
      return;
    }

    batchActionBar = globalScope.document.createElement('div');
    batchActionBar.id = 'gpt2md-batch-action-bar';
    batchActionBar.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;z-index:99999;' +
      'background:#1a1a1a;border-top:1px solid #333;' +
      'padding:12px 24px;display:flex;align-items:center;' +
      'justify-content:center;gap:12px;' +
      'font-family:system-ui,-apple-system,sans-serif;';

    var exportBtn = globalScope.document.createElement('button');
    exportBtn.id = 'gpt2md-batch-export-btn';
    exportBtn.className = 'gpt2md-action-btn gpt2md-primary-btn';
    exportBtn.textContent = '准备导出...';
    exportBtn.disabled = true;
    exportBtn.addEventListener('click', exportBatch);

    var cancelBtn = globalScope.document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.className = 'gpt2md-action-btn';
    cancelBtn.addEventListener('click', exitBatchMode);

    batchActionBar.appendChild(exportBtn);
    batchActionBar.appendChild(cancelBtn);

    globalScope.document.body.appendChild(batchActionBar);
  }

  function updateSelectedCount() {
    if (!actionBar) {
      return;
    }

    var exportBtn = actionBar.querySelector('#gpt2md-export-selected-btn');
    if (!exportBtn) {
      return;
    }

    var count = selectedIndices.size;
    if (count === 0) {
      exportBtn.textContent = '至少选择一条消息';
      exportBtn.disabled = true;
    } else {
      exportBtn.textContent = '导出已选 (' + count + ' 条)';
      exportBtn.disabled = false;
    }
  }

  function selectAllMessages() {
    var elements = getMessageElements();
    for (var i = 0; i < elements.length; i++) {
      selectedIndices.add(i);
    }

    var checkboxes = globalScope.document.querySelectorAll('.gpt2md-checkbox');
    for (var j = 0; j < checkboxes.length; j++) {
      checkboxes[j].checked = true;
    }
    updateSelectedCount();
  }

  function deselectAllMessages() {
    selectedIndices.clear();
    var checkboxes = globalScope.document.querySelectorAll('.gpt2md-checkbox');
    for (var i = 0; i < checkboxes.length; i++) {
      checkboxes[i].checked = false;
    }
    updateSelectedCount();
  }

  function enterSelectionMode() {
    if (selectionMode) {
      return;
    }

    selectionMode = true;
    selectedIndices.clear();
    injectStyles();

    var elements = getMessageElements();
    for (var i = 0; i < elements.length; i++) {
      injectCheckbox(elements[i], i);
    }

    injectActionBar();

    observer = new globalScope.MutationObserver(function () {
      observer.disconnect();
      var refreshed = getMessageElements();
      for (var j = 0; j < refreshed.length; j++) {
        injectCheckbox(refreshed[j], j);
      }
      updateSelectedCount();
      observer.observe(globalScope.document.body, {
        childList: true,
        subtree: true
      });
    });

    observer.observe(globalScope.document.body, {
      childList: true,
      subtree: true
    });

    prefetchConversationData();
    globalScope.document.addEventListener('keydown', handleEscapeKey);
  }

  function startBatchExport(items) {
    if (batchMode) {
      exitBatchMode();
    }

    batchSelectedIds.clear();
    batchRetryItems = null;
    batchConversationTitles = {};

    var selectedItems = Array.isArray(items) ? items : [];
    for (var i = 0; i < selectedItems.length; i++) {
      var item = selectedItems[i];
      if (!item || !item.id || batchSelectedIds.has(item.id)) {
        continue;
      }
      batchSelectedIds.add(item.id);
      batchConversationTitles[item.id] = item.title || item.id;
    }

    if (batchSelectedIds.size === 0) {
      return;
    }

    batchMode = true;
    injectStyles();
    injectBatchActionBar();
    globalScope.document.addEventListener('keydown', handleBatchEscapeKey);
    return exportBatch();
  }

  function getCurrentConversationId() {
    var match = /\/c\/([a-zA-Z0-9-]+)/.exec(globalScope.window.location.pathname);
    return match ? match[1] : null;
  }

  function getCurrentMessageCount() {
    return globalScope.document.querySelectorAll('[data-message-author-role]').length;
  }

  function isPrefetchFresh() {
    if (!prefetchedData) {
      return false;
    }
    if ((Date.now() - prefetchTimestamp) >= PREFETCH_TTL_MS) {
      return false;
    }
    if (getCurrentMessageCount() !== prefetchedMessageCount) {
      return false;
    }
    return true;
  }

  function releasePrefetch() {
    prefetchedData = null;
    prefetchTimestamp = 0;
    prefetchedMessageCount = 0;
  }

  async function prefetchConversationData() {
    if (isPrefetchFresh()) {
      return;
    }
    var result = await globalScope.fetchConversation();
    if (result.success) {
      prefetchedData = result.data;
      prefetchTimestamp = Date.now();
      prefetchedMessageCount = getCurrentMessageCount();
    }
  }

  async function getExportData() {
    if (prefetchedData && isPrefetchFresh()) {
      var data = prefetchedData;
      releasePrefetch();
      return {
        success: true,
        data: data
      };
    }
    return globalScope.fetchConversation();
  }

  function stopPolling() {
    if (pollTimer) {
      globalScope.clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (settleTimer) {
      globalScope.clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  function startPolling() {
    stopPolling();

    function check() {
      if (!lastConversationId) {
        return;
      }

      var currentCount = getCurrentMessageCount();
      if (currentCount !== prefetchedMessageCount && prefetchedData) {
        if (settleTimer) {
          globalScope.clearTimeout(settleTimer);
        }
        settleTimer = globalScope.setTimeout(function () {
          settleTimer = null;
          var settledCount = getCurrentMessageCount();
          if (settledCount !== prefetchedMessageCount) {
            if ((Date.now() - prefetchTimestamp) >= PREFETCH_THROTTLE_MS) {
              prefetchConversationData();
            }
          }
        }, CONVERSATION_SETTLE_MS);
      }

      pollTimer = globalScope.setTimeout(check, POLL_INTERVAL_MS);
    }

    pollTimer = globalScope.setTimeout(check, POLL_INTERVAL_MS);
  }

  function onConversationUrlChange() {
    stopPolling();

    var newId = getCurrentConversationId();

    if (newId && newId !== lastConversationId) {
      releasePrefetch();
      lastConversationId = newId;

      prefetchConversationData();

      globalScope.setTimeout(function () {
        if (!isPrefetchFresh()) {
          releasePrefetch();
          prefetchConversationData();
        }
        startPolling();
      }, DOM_STABILIZE_MS);

      return;
    }

    if (!newId && lastConversationId) {
      releasePrefetch();
      lastConversationId = null;
    }
  }

  function exitSelectionMode() {
    selectionMode = false;
    releasePrefetch();
    startPolling();
    selectedIndices.clear();

    var wrappers = globalScope.document.querySelectorAll('.gpt2md-checkbox-wrapper');
    for (var i = 0; i < wrappers.length; i++) {
      wrappers[i].remove();
    }

    if (actionBar) {
      actionBar.remove();
      actionBar = null;
    }

    var styles = globalScope.document.getElementById('gpt2md-styles');
    if (styles) {
      styles.remove();
    }

    var containers = globalScope.document.querySelectorAll('.gpt2md-message-container');
    for (var j = 0; j < containers.length; j++) {
      containers[j].classList.remove('gpt2md-message-container');
      if (containers[j].dataset.gpt2mdRestorePosition) {
        containers[j].style.position = '';
        delete containers[j].dataset.gpt2mdRestorePosition;
      }
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    globalScope.document.removeEventListener('keydown', handleEscapeKey);
  }

  function handleEscapeKey(event) {
    if (event.key === 'Escape') {
      exitSelectionMode();
    }
  }

  function exitBatchMode() {
    batchMode = false;
    batchSelectedIds.clear();
    batchRetryItems = null;
    batchConversationTitles = {};

    if (batchActionBar) {
      batchActionBar.remove();
      batchActionBar = null;
    }

    var styles = globalScope.document.getElementById('gpt2md-styles');
    if (styles) {
      styles.remove();
    }

    globalScope.document.removeEventListener('keydown', handleBatchEscapeKey);
  }

  function handleBatchEscapeKey(event) {
    if (event.key === 'Escape') {
      exitBatchMode();
    }
  }

  function getBatchConversationTitle(conversationId) {
    if (batchConversationTitles[conversationId]) {
      return batchConversationTitles[conversationId];
    }

    var rows = getHistoryConversationRows();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === conversationId && rows[i].title) {
        return rows[i].title;
      }
    }

    return conversationId.slice(0, 8) + '...';
  }

  async function exportBatch() {
    if (batchSelectedIds.size === 0) {
      return;
    }

    var ids = Array.from(batchSelectedIds);
    var totalCount = ids.length;
    var successCount = 0;
    var failedItems = [];
    var exportBtn = batchActionBar.querySelector('#gpt2md-batch-export-btn');

    if (exportBtn) {
      exportBtn.disabled = true;
    }

    for (var i = 0; i < ids.length; i++) {
      var conversationId = ids[i];

      if (exportBtn) {
        exportBtn.textContent = (i + 1) + '/' + totalCount + ' 已处理';
      }

      try {
        var result = await globalScope.fetchConversationById(conversationId);
        if (!result.success) {
          failedItems.push({
            id: conversationId,
            error: result.error
          });
          continue;
        }

        var parsed = globalScope.parseConversation(result.data);
        var markdown = globalScope.generateMarkdown(parsed);

        globalScope.window.postMessage({
          type: RESULT_TYPE,
          batchExport: true,
          status: 'success',
          detail: {
            filename: globalScope.createFilename(parsed.title),
            title: parsed.title,
            markdown: markdown
          }
        }, '*');

        successCount += 1;
      } catch (error) {
        failedItems.push({
          id: conversationId,
          error: 'PARSE_ERROR'
        });
      }
    }

    if (failedItems.length > 0) {
      var failedDetails = failedItems.map(function (item) {
        return {
          id: item.id,
          title: getBatchConversationTitle(item.id),
          error: item.error
        };
      });
      var failedNames = failedDetails.map(function (detail) {
        return detail.title;
      }).join('、');

      if (exportBtn) {
        exportBtn.textContent = '重试失败 (' + failedItems.length + ' 条)';
        exportBtn.disabled = false;
        batchRetryItems = failedDetails;
        exportBtn.removeEventListener('click', exportBatch);
        exportBtn.addEventListener('click', retryFailedBatch);
      }

      globalScope.window.postMessage({
        type: RESULT_TYPE,
        batchExport: true,
        batchSummary: true,
        status: 'success',
        detail: {
          successCount: successCount,
          failedCount: failedItems.length,
          failedItems: failedDetails,
          summaryText: '成功 ' + successCount + ' 条，失败 '
            + failedItems.length + ' 条：' + failedNames
        }
      }, '*');
    } else {
      if (exportBtn) {
        exportBtn.textContent = '全部导出完成';
        exportBtn.disabled = true;
      }
      batchRetryItems = null;

      globalScope.window.postMessage({
        type: RESULT_TYPE,
        batchExport: true,
        batchSummary: true,
        status: 'success',
        detail: {
          successCount: successCount,
          failedCount: 0,
          failedItems: [],
          summaryText: '全部导出完成（' + successCount + ' 条）'
        }
      }, '*');
    }
  }

  async function retryFailedBatch() {
    if (!batchRetryItems || batchRetryItems.length === 0) {
      return;
    }

    var retryIds = batchRetryItems.map(function (item) {
      return item.id;
    });
    var totalCount = retryIds.length;
    var successCount = 0;
    var failedItems = [];
    var exportBtn = batchActionBar.querySelector('#gpt2md-batch-export-btn');

    if (exportBtn) {
      exportBtn.disabled = true;
    }

    for (var i = 0; i < retryIds.length; i++) {
      var conversationId = retryIds[i];

      if (exportBtn) {
        exportBtn.textContent = '重试 ' + (i + 1) + '/' + totalCount;
      }

      try {
        var result = await globalScope.fetchConversationById(conversationId);
        if (!result.success) {
          failedItems.push({
            id: conversationId,
            error: result.error
          });
          continue;
        }

        var parsed = globalScope.parseConversation(result.data);
        var markdown = globalScope.generateMarkdown(parsed);

        globalScope.window.postMessage({
          type: RESULT_TYPE,
          batchExport: true,
          status: 'success',
          detail: {
            filename: globalScope.createFilename(parsed.title),
            title: parsed.title,
            markdown: markdown
          }
        }, '*');

        successCount += 1;
      } catch (error) {
        failedItems.push({
          id: conversationId,
          error: 'PARSE_ERROR'
        });
      }
    }

    if (failedItems.length > 0) {
      var failedDetails = failedItems.map(function (item) {
        return {
          id: item.id,
          title: getBatchConversationTitle(item.id),
          error: item.error
        };
      });

      if (exportBtn) {
        exportBtn.textContent = '重试失败 (' + failedItems.length + ' 条)';
        exportBtn.disabled = false;
      }
      batchRetryItems = failedDetails;

      globalScope.window.postMessage({
        type: RESULT_TYPE,
        batchExport: true,
        batchSummary: true,
        status: 'success',
        detail: {
          successCount: successCount,
          failedCount: failedItems.length,
          failedItems: failedDetails,
          summaryText: '重试完成：成功 ' + successCount
            + ' 条，仍失败 ' + failedItems.length + ' 条'
        }
      }, '*');
    } else {
      if (exportBtn) {
        exportBtn.textContent = '全部导出完成';
        exportBtn.disabled = true;
      }
      batchRetryItems = null;

      globalScope.window.postMessage({
        type: RESULT_TYPE,
        batchExport: true,
        batchSummary: true,
        status: 'success',
        detail: {
          successCount: successCount,
          failedCount: 0,
          failedItems: [],
          summaryText: '重试完成：全部成功（' + successCount + ' 条）'
        }
      }, '*');
    }
  }

  async function exportSelected() {
    if (selectedIndices.size === 0) {
      return;
    }

    var tStart = globalScope.performance.now();

    var result = await getExportData();
    var tApi = globalScope.performance.now();

    if (!result.success) {
      postSelectionResult('error', {
        error: result.error
      });
      return;
    }

    var parsed = globalScope.parseConversation(result.data);
    var tParse = globalScope.performance.now();

    var filteredMessages = parsed.messages.filter(function (message, index) {
      return selectedIndices.has(index);
    });
    var filteredParsed = {
      title: parsed.title,
      messages: filteredMessages
    };
    var markdown = globalScope.generateMarkdown(filteredParsed);
    var tMarkdown = globalScope.performance.now();

    var detail = {
      filename: globalScope.createFilename(parsed.title),
      title: parsed.title,
      markdown: markdown,
      selectedCount: filteredMessages.length
    };

    if (hasUnsupportedContent(filteredParsed)) {
      detail.hasUnsupportedContent = true;
    }

    postSelectionResult('success', detail);

    globalScope.console.log(
      '[GPT2MD 选择导出]',
      'API: ' + (tApi - tStart).toFixed(0) + 'ms',
      '| Parse: ' + (tParse - tApi).toFixed(0) + 'ms',
      '| Filter+Markdown: ' + (tMarkdown - tParse).toFixed(0) + 'ms',
      '| 总计: ' + (tMarkdown - tStart).toFixed(0) + 'ms',
      '| 导出: ' + filteredMessages.length + '/' + parsed.messages.length + ' 条'
    );

    exitSelectionMode();
  }

  async function exportParsedConversation(parsed) {
    var markdown = globalScope.generateMarkdown(parsed);
    var detail = {
      filename: globalScope.createFilename(parsed.title),
      title: parsed.title,
      markdown: markdown
    };

    if (hasUnsupportedContent(parsed)) {
      detail.hasUnsupportedContent = true;
    }

    postResult('success', detail);
  }

  async function handleExportRequest() {
    var tStart = globalScope.performance.now();

    var result = await getExportData();
    var tApi = globalScope.performance.now();

    if (!result.success) {
      postResult('error', {
        error: result.error
      });
      return;
    }

    var parsed = globalScope.parseConversation(result.data);
    var tParse = globalScope.performance.now();

    await exportParsedConversation(parsed);
    var tMarkdown = globalScope.performance.now();

    globalScope.console.log(
      '[GPT2MD 全量导出]',
      'API: ' + (tApi - tStart).toFixed(0) + 'ms',
      '| Parse: ' + (tParse - tApi).toFixed(0) + 'ms',
      '| Markdown: ' + (tMarkdown - tParse).toFixed(0) + 'ms',
      '| 总计: ' + (tMarkdown - tStart).toFixed(0) + 'ms',
      '| 消息数: ' + parsed.messages.length
    );
  }

  var _origPushState = globalScope.history.pushState;
  globalScope.history.pushState = function () {
    _origPushState.apply(this, arguments);
    onConversationUrlChange();
  };

  var _origReplaceState = globalScope.history.replaceState;
  globalScope.history.replaceState = function () {
    _origReplaceState.apply(this, arguments);
    onConversationUrlChange();
  };

  globalScope.window.addEventListener('popstate', onConversationUrlChange);

  var initialId = getCurrentConversationId();
  if (initialId) {
    lastConversationId = initialId;
    prefetchConversationData();
    globalScope.setTimeout(function () {
      if (!isPrefetchFresh()) {
        releasePrefetch();
        prefetchConversationData();
      }
      startPolling();
    }, DOM_STABILIZE_MS);
  }

  globalScope.window.addEventListener('message', function (event) {
    if (!event.data || !event.data.type) {
      return;
    }

    switch (event.data.type) {
      case REQUEST_TYPE:
        return handleExportRequest();
      case SELECTION_ENTER_TYPE:
        enterSelectionMode();
        return;
      case SELECTION_EXIT_TYPE:
        exitSelectionMode();
        return;
      case PREFETCH_TYPE:
        prefetchConversationData();
        return;
      case BATCH_LIST_REQUEST_TYPE:
        postBatchConversationList(event.data.requestId);
        return;
      case BATCH_START_TYPE:
        return startBatchExport(event.data.items);
    }
  });
})(globalThis);
