'use strict';

(function initBridge(globalScope) {
  const REQUEST_TYPE = 'GPT2MD_EXPORT_REQUEST';
  const RESULT_TYPE = 'GPT2MD_EXPORT_RESULT';

  function postResult(status, detail) {
    globalScope.window.postMessage({
      type: RESULT_TYPE,
      status,
      detail
    }, '*');
  }

  function showDomFallbackDialog(errorCode) {
    return new Promise((resolve) => {
      const overlay = globalScope.document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';

      const dialog = globalScope.document.createElement('div');
      dialog.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.2);text-align:center;font-family:-apple-system,system-ui,sans-serif;';

      const errorMessages = {
        UNAUTHORIZED: '请先登录 ChatGPT',
        NETWORK_ERROR: 'API 请求失败（网络错误）',
        TIMEOUT: 'API 请求超时',
        RATE_LIMITED: 'API 请求过于频繁',
        PARSE_ERROR: 'API 返回数据解析失败'
      };
      const errorMessage = errorMessages[errorCode] || 'API 请求失败';

      dialog.innerHTML = '<div style="font-size:20px;margin-bottom:8px;">⚠️</div>'
        + '<div style="font-size:16px;font-weight:600;color:#333;margin-bottom:8px;">API 导出失败</div>'
        + '<div style="font-size:14px;color:#666;margin-bottom:16px;">' + errorMessage + '</div>'
        + '<div style="font-size:14px;color:#888;margin-bottom:20px;">可尝试使用 DOM 解析降级导出当前对话</div>'
        + '<div style="display:flex;gap:12px;justify-content:center;">'
        + '<button id="gpt2md-dom-cancel" style="padding:8px 20px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#333;cursor:pointer;font-size:14px;">取消</button>'
        + '<button id="gpt2md-dom-confirm" style="padding:8px 20px;border:none;border-radius:8px;background:#10a37f;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">使用 DOM 导出</button>'
        + '</div>';

      overlay.appendChild(dialog);
      globalScope.document.body.appendChild(overlay);

      globalScope.document.getElementById('gpt2md-dom-confirm').addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });

      globalScope.document.getElementById('gpt2md-dom-cancel').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
    });
  }

  async function exportParsedConversation(parsed, folderName) {
    const markdown = globalScope.generateMarkdown(parsed);
    const downloadResult = await globalScope.downloadMarkdown(markdown, parsed.title, folderName);
    if (!downloadResult.success) {
      postResult('error', {
        error: downloadResult.error
      });
      return;
    }

    postResult('success', {
      filename: downloadResult.filename,
      title: parsed.title
    });
  }

  async function handleExportRequest(event) {
    if (!event.data || event.data.type !== REQUEST_TYPE) {
      return;
    }

    const result = await globalScope.fetchConversation();
    if (!result.success) {
      const shouldUseDom = await showDomFallbackDialog(result.error);
      if (!shouldUseDom) {
        postResult('error', {
          error: 'CANCELLED'
        });
        return;
      }

      const domResult = await globalScope.domParseConversation();
      if (!domResult.success) {
        postResult('error', {
          error: domResult.error
        });
        return;
      }

      await exportParsedConversation(domResult.data, event.data.folderName);
      return;
    }

    const parsed = globalScope.parseConversation(result.data);
    await exportParsedConversation(parsed, event.data.folderName);
  }

  globalScope.window.addEventListener('message', handleExportRequest);
})(globalThis);
