'use strict';

(function initDownload(globalScope) {
  const DEFAULT_FOLDER_NAME = 'chatgpt-inbox';
  const ILLEGAL_FILENAME_CHARACTERS = /[\/\\:*?"<>|]/g;

  function padNumber(value) {
    return String(value).padStart(2, '0');
  }

  function formatDate(date) {
    return [
      date.getFullYear(),
      padNumber(date.getMonth() + 1),
      padNumber(date.getDate())
    ].join('-');
  }

  function createSafeTitle(title) {
    const baseTitle = title === null ? 'Untitled' : String(title);
    const safeTitle = baseTitle
      .slice(0, 50)
      .replace(ILLEGAL_FILENAME_CHARACTERS, '')
      .trim();

    if (!safeTitle) {
      return 'Untitled-' + globalScope.Date.now();
    }

    return safeTitle;
  }

  function createFilename(title) {
    return formatDate(new globalScope.Date()) + '-' + createSafeTitle(title) + '.md';
  }

  async function downloadMarkdown(markdown, title, folderName = DEFAULT_FOLDER_NAME) {
    if (markdown === null || markdown === undefined || markdown === '') {
      return {
        success: false,
        error: 'NO_CONTENT'
      };
    }

    const safeFilename = createFilename(title);

    try {
      const blob = new globalScope.Blob([markdown], {
        type: 'text/markdown;charset=utf-8'
      });
      const blobUrl = globalScope.URL.createObjectURL(blob);
      const link = globalScope.document.createElement('a');
      link.href = blobUrl;
      link.download = folderName + '/' + safeFilename;
      link.style.display = 'none';
      globalScope.document.body.appendChild(link);
      link.click();
      globalScope.document.body.removeChild(link);
      globalScope.URL.revokeObjectURL(blobUrl);

      return {
        success: true,
        filename: safeFilename
      };
    } catch (error) {
      return {
        success: false,
        error: 'DOWNLOAD_FAILED'
      };
    }
  }

  globalScope.downloadMarkdown = downloadMarkdown;
})(globalThis);
