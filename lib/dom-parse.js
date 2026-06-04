'use strict';

(function initDomParse(globalScope) {
  function getMessageContent(element) {
    const contentElement = element.querySelector('[data-message-content]')
      || element.querySelector('.markdown')
      || element.querySelector('div > p');
    return (contentElement ? contentElement.textContent : element.textContent || '').trim();
  }

  function domParseConversation() {
    if (!globalScope.document) {
      return {
        success: false,
        error: 'DOM_PARSE_FAILED'
      };
    }

    const titleElement = globalScope.document.querySelector('h1');
    const messageElements = globalScope.document.querySelectorAll('article[data-message-author-role]');
    const messages = [];

    for (const element of messageElements) {
      const role = element.getAttribute('data-message-author-role');
      const content = getMessageContent(element);
      if ((role === 'user' || role === 'assistant') && content) {
        messages.push({
          role,
          content
        });
      }
    }

    if (messages.length === 0) {
      return {
        success: false,
        error: 'DOM_PARSE_FAILED'
      };
    }

    return {
      success: true,
      data: {
        title: titleElement ? titleElement.textContent.trim() : '',
        messages
      }
    };
  }

  globalScope.domParseConversation = domParseConversation;
})(globalThis);
