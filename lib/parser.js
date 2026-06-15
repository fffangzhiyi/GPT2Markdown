'use strict';

(function initParser(globalScope) {
  function extractContent(message) {
    const content = message.content || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const strings = parts.filter(function filterStringPart(part) {
      return typeof part === 'string';
    });

    if (strings.length > 0) {
      return strings.join('');
    }

    if (parts.length > 0) {
      const contentType = content.content_type;
      if (typeof contentType === 'string' && contentType) {
        return '[' + contentType + ' message]';
      }

      return '[non-text content]';
    }

    return '';
  }

  function getReferenceMarker(reference, content) {
    if (typeof reference.matched_text === 'string' && reference.matched_text) {
      return reference.matched_text;
    }

    const startIndex = Number.isInteger(reference.start_ix)
      ? reference.start_ix
      : reference.start_idx;
    const endIndex = Number.isInteger(reference.end_ix)
      ? reference.end_ix
      : reference.end_idx;
    if (
      Number.isInteger(startIndex)
      && Number.isInteger(endIndex)
      && startIndex >= 0
      && endIndex > startIndex
    ) {
      return content.slice(startIndex, endIndex);
    }

    return '';
  }

  function deriveTitleFromUrl(url) {
    try {
      const pathname = new globalScope.URL(url).pathname;
      const segments = pathname.split('/').filter(function filterSegment(segment) {
        return segment;
      });
      if (segments.length === 0) {
        return '';
      }

      const meaningful = segments.filter(function filterMeaningfulSegment(segment) {
        return !/^(blob|main|tree|master|docs|wiki|site|src|lib|api|v\d+)$/i.test(segment);
      });

      if (meaningful.length > 0) {
        const last = meaningful[meaningful.length - 1];
        return last.replace(/\.[^.]+$/, '');
      }

      return segments[segments.length - 1];
    } catch (error) {
      return '';
    }
  }

  function normalizeReferenceTitle(title, url) {
    const commonDomains = /^(GitHub|GitLab|Twitter|X|Reddit|Hacker News|Product Hunt|arXiv|Stack Overflow|Medium|YouTube|Google|Wikipedia|npm|PyPI|NPM|pypi\.org|github\.com|gitlab\.com|stackoverflow\.com)$/i;

    if (typeof title === 'string' && title.trim()) {
      const normalized = title.trim();
      const escapedLink = normalized.match(
        /^\(\\?\[([\s\S]+?)\\?\]\(https?:\/\/[\s\S]+\)\)$/i
      );
      const cleanTitle = escapedLink ? escapedLink[1].trim() : normalized;

      if (commonDomains.test(cleanTitle) && typeof url === 'string') {
        const derived = deriveTitleFromUrl(url);
        if (derived) {
          return cleanTitle + ' · ' + derived;
        }
      }

      return cleanTitle;
    }

    if (typeof url === 'string') {
      const fallback = deriveTitleFromUrl(url);
      if (fallback) {
        return fallback;
      }
    }

    return '来源';
  }

  function addReference(references, seen, marker, title, url) {
    if (
      !marker
      || typeof url !== 'string'
      || !/^https?:\/\//i.test(url)
    ) {
      return;
    }

    const key = marker + '\n' + url;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    references.push({
      marker,
      title: normalizeReferenceTitle(title, url),
      url
    });
  }

  function extractReferences(message, content) {
    const metadata = message.metadata || {};
    const references = [];
    const seen = new Set();
    const citations = Array.isArray(metadata.citations) ? metadata.citations : [];

    for (const citation of citations) {
      const citationMetadata = citation.metadata || {};
      const marker = getReferenceMarker(citation, content);
      addReference(
        references,
        seen,
        marker,
        citation.title || citationMetadata.title,
        citationMetadata.url || citation.url
      );
    }

    const contentReferences = Array.isArray(metadata.content_references)
      ? metadata.content_references
      : [];
    for (const reference of contentReferences) {
      const marker = getReferenceMarker(reference, content);
      const title = reference.title || reference.alt;
      const urls = [];

      if (typeof reference.url === 'string') {
        urls.push(reference.url);
      }
      if (Array.isArray(reference.safe_urls)) {
        urls.push.apply(urls, reference.safe_urls);
      }
      if (Array.isArray(reference.refs)) {
        for (const nestedReference of reference.refs) {
          if (nestedReference && typeof nestedReference.url === 'string') {
            urls.push(nestedReference.url);
          }
        }
      }

      for (const url of urls) {
        addReference(references, seen, marker, title, url);
      }
    }

    return references;
  }

  function normalizeMessage(message) {
    const role = message.author && message.author.role;
    if (role !== 'user' && role !== 'assistant') {
      return null;
    }

    const content = extractContent(message);
    const normalized = {
      role,
      content
    };

    if (message.content && message.content.content_type) {
      normalized.contentType = message.content.content_type;
    }

    if (message.metadata && message.metadata.model_slug) {
      normalized.model = message.metadata.model_slug;
    }

    const references = extractReferences(message, content);
    if (references.length > 0) {
      normalized.references = references;
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
