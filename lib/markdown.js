'use strict';

(function initMarkdown(globalScope) {
  const CHATGPT_CITATION_PATTERN = /\uE200cite\uE202[^\uE201]*\uE201/g;

  function padNumber(value) {
    return String(value).padStart(2, '0');
  }

  function formatExportTime(date) {
    return [
      date.getFullYear(),
      padNumber(date.getMonth() + 1),
      padNumber(date.getDate())
    ].join('-') + ' ' + [
      padNumber(date.getHours()),
      padNumber(date.getMinutes())
    ].join(':');
  }

  function renderHeader(title) {
    return '# ' + title + '\n\n> 导出时间: ' + formatExportTime(new globalScope.Date()) + ' | 来源: ChatGPT\n\n';
  }

  function normalizeMathInText(text) {
    return text
      .replace(/\\\[\s*/g, function replaceDisplayMathStart() {
        return '$$\n';
      })
      .replace(/\s*\\\]/g, function replaceDisplayMathEnd() {
        return '\n$$';
      })
      .replace(/\\\(\s*/g, '$')
      .replace(/\s*\\\)/g, '$');
  }

  function escapeMarkdownLabel(label) {
    return String(label)
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
  }

  function escapeMarkdownUrl(url) {
    return String(url)
      .replace(/ /g, '%20')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
  }

  function normalizeReferenceTitle(title) {
    const normalized = typeof title === 'string' && title.trim()
      ? title.trim()
      : '来源';
    const escapedLink = normalized.match(
      /^\(\\?\[([\s\S]+?)\\?\]\(https?:\/\/[\s\S]+\)\)$/i
    );

    return escapedLink ? escapedLink[1].trim() : normalized;
  }

  function createReferenceReplacements(references) {
    const groups = [];
    const groupsByMarker = new Map();
    const items = Array.isArray(references) ? references : [];

    for (const reference of items) {
      if (
        !reference
        || typeof reference.marker !== 'string'
        || !reference.marker
        || typeof reference.url !== 'string'
        || !/^https?:\/\//i.test(reference.url)
      ) {
        continue;
      }

      let group = groupsByMarker.get(reference.marker);
      if (!group) {
        group = {
          marker: reference.marker,
          references: [],
          urls: new Set()
        };
        groupsByMarker.set(reference.marker, group);
        groups.push(group);
      }

      if (group.urls.has(reference.url)) {
        continue;
      }
      group.urls.add(reference.url);
      group.references.push(reference);
    }

    return groups.map((group) => {
      const links = group.references.map((reference, index) => {
        const baseTitle = normalizeReferenceTitle(reference.title);
        const title = index === 0 ? baseTitle : baseTitle + ' ' + (index + 1);
        return '[' + escapeMarkdownLabel(title) + ']('
          + escapeMarkdownUrl(reference.url) + ')';
      });

      return {
        marker: group.marker,
        markdown: links.join(' ')
      };
    });
  }

  function normalizeReferencesInText(text, replacements) {
    let normalized = text;
    for (const replacement of replacements) {
      normalized = normalized.split(replacement.marker).join(replacement.markdown);
    }
    return normalized.replace(CHATGPT_CITATION_PATTERN, '');
  }

  function normalizeContent(content, references) {
    const lines = String(content).split('\n');
    let inCodeFence = false;
    const referenceReplacements = createReferenceReplacements(references);

    return lines.map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      if (inCodeFence) {
        return line;
      }

      return normalizeReferencesInText(
        normalizeMathInText(line),
        referenceReplacements
      );
    }).join('\n');
  }

  function renderMessage(message) {
    const content = normalizeContent(message.content, message.references);

    if (message.role === 'user') {
      return '## 你\n\n' + content + '\n\n';
    }

    if (message.role === 'assistant') {
      return '## ChatGPT\n\n' + content + '\n\n';
    }

    return '';
  }

  function generateMarkdown(parsedData) {
    if (!parsedData) {
      return '';
    }

    const title = parsedData.title || 'Untitled Conversation';
    let markdown = renderHeader(title);

    if (!Array.isArray(parsedData.messages)) {
      return markdown;
    }

    for (const message of parsedData.messages) {
      markdown += renderMessage(message);
    }

    return markdown;
  }

  globalScope.generateMarkdown = generateMarkdown;
})(globalThis);
