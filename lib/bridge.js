'use strict';

(function initBridge(globalScope) {
  var REQUEST_TYPE = 'GPT2MD_EXPORT_REQUEST';
  var RESULT_TYPE = 'GPT2MD_EXPORT_RESULT';
  var SELECTION_ENTER_TYPE = 'GPT2MD_ENTER_SELECTION';
  var SELECTION_EXIT_TYPE = 'GPT2MD_EXIT_SELECTION';
  var BATCH_ENTER_TYPE = 'GPT2MD_ENTER_BATCH';

  var selectionMode = false;
  var selectedIndices = new Set();
  var observer = null;
  var actionBar = null;

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

    globalScope.document.addEventListener('keydown', handleEscapeKey);
  }

  function exitSelectionMode() {
    selectionMode = false;
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

  async function exportSelected() {
    if (selectedIndices.size === 0) {
      return;
    }

    var result = await globalScope.fetchConversation();
    if (!result.success) {
      postSelectionResult('error', {
        error: result.error
      });
      return;
    }

    var parsed = globalScope.parseConversation(result.data);
    var filteredMessages = parsed.messages.filter(function (message, index) {
      return selectedIndices.has(index);
    });
    var filteredParsed = {
      title: parsed.title,
      messages: filteredMessages
    };
    var markdown = globalScope.generateMarkdown(filteredParsed);
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
    var result = await globalScope.fetchConversation();
    if (!result.success) {
      postResult('error', {
        error: result.error
      });
      return;
    }

    var parsed = globalScope.parseConversation(result.data);
    await exportParsedConversation(parsed);
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
      case BATCH_ENTER_TYPE:
        return;
    }
  });
})(globalThis);
