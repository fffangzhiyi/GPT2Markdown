'use strict';

(function initParser(globalScope) {
  function extractContent(message) {
    const content = message.content || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    return parts.filter(function filterStringPart(part) {
      return typeof part === 'string';
    }).join('');
  }

  function normalizeMessage(message) {
    const role = message.author && message.author.role;
    if (role !== 'user' && role !== 'assistant') {
      return null;
    }

    const normalized = {
      role,
      content: extractContent(message)
    };

    if (message.content && message.content.content_type) {
      normalized.contentType = message.content.content_type;
    }

    if (message.metadata && message.metadata.model_slug) {
      normalized.model = message.metadata.model_slug;
    }

    return normalized;
  }

  function parseConversation(apiData) {
    const data = apiData || {};
    const mapping = data.mapping || null;
    if (!mapping) {
      return {
        title: '',
        messages: []
      };
    }

    const nodes = [];
    let nodeId = data.current_node;
    while (nodeId) {
      const node = mapping[nodeId];
      if (!node) {
        break;
      }

      nodes.unshift(node);
      nodeId = node.parent;
    }

    const messages = [];
    for (const node of nodes) {
      if (!node.message) {
        continue;
      }

      const message = normalizeMessage(node.message);
      if (message && message.content.trim() !== '') {
        messages.push(message);
      }
    }

    return {
      title: data.title || '',
      messages
    };
  }

  globalScope.parseConversation = parseConversation;
})(globalThis);
