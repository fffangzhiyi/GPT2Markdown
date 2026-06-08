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

  globalScope.createFilename = createFilename;
  globalScope.DEFAULT_FOLDER_NAME = DEFAULT_FOLDER_NAME;
})(globalThis);
