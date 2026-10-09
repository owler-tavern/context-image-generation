import { buildFocusedMessageContent, normalizeFocusText } from './rp-selection.js';

const OMIT_CONTENT = new Set([
    'scene_plan', 'tracker', 'true_thoughts', 'visuals', 'status', 'threads',
    'plotlines', 'horae', 'horaeevent', 'momentum', 'momentum_route',
    'director_choices', 'parallel', 'script', 'style', 'template', 'noscript',
    'iframe', 'object', 'svg', 'canvas', 'pre', 'code',
    'think', 'thinking', 'analysis', 'reasoning', 'ooc', 'metadata',
    'character_status', 'scene_status', 'stats',
]);
const normalizeName = (name) => name.toLowerCase().replace(/[-_:.\s]/gu, '');
const CODE_TAGS = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'svg', 'canvas', 'pre', 'code']);
const METADATA_NAMES = new Set([...OMIT_CONTENT].filter((name) => !CODE_TAGS.has(name)).map(normalizeName));
const NARRATIVE_NAMES = new Set(['prose', 'narration', 'narrative', 'story', 'scene']);
const BLOCK_TAGS = new Set(['prose', 'p', 'div', 'br', 'hr', 'li', 'ul', 'ol', 'blockquote', 'section', 'article', 'details', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
const HTML_TOKEN_SOURCE = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-z][\w:.-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'">])*)?\s*\/?>/iu.source;
const BRACKET_TOKEN_SOURCE = /\[\/?[a-z][\w:.-]*(?:[=| ][^\]\n]*)?\]/iu.source;

function decodeEntities(text) {
    return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, name) => {
        if (!name.startsWith('#')) return ENTITIES[name] ?? entity;
        const value = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
            ? String.fromCodePoint(value) : '�';
    });
}

function removeFencedCode(text) {
    const lines = [];
    let fence = null;
    for (const line of text.split('\n')) {
        if (fence) {
            const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/u.exec(line)?.[1];
            if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = null;
        } else {
            const opening = /^[ \t]*(`{3,}|~{3,})[^\n]*$/u.exec(line)?.[1];
            if (opening) {
                fence = opening;
                lines.push('');
            } else lines.push(line);
        }
    }
    return lines.join('\n');
}

function parseAttributes(attributes) {
    // Consume each complete quoted value so words inside title/style/etc.
    // cannot be mistaken for attribute names.
    return [...attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)]
        .map((attribute) => [attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '']);
}

function isMetadataName(name) {
    const normalized = normalizeName(name);
    return METADATA_NAMES.has(normalized)
        || METADATA_NAMES.has(normalized.replace(/(?:container|panel|block|wrapper)$/u, ''));
}

function shouldOmitElement(name, attributes, followingText) {
    if (OMIT_CONTENT.has(name) || isMetadataName(name)) return true;
    for (const [attribute, value] of parseAttributes(attributes)) {
        if (attribute === 'hidden' || attribute === 'aria-hidden' && value.trim().toLowerCase() === 'true') return true;
        if (['id', 'class', 'data-type', 'data-role'].includes(attribute) && value.split(/\s+/u).some(isMetadataName)) return true;
    }
    if (name === 'details') {
        const summary = /^\s*<summary(?:\s+(?:"[^"]*"|'[^']*'|[^'">])*)?\s*>([\s\S]*?)<\/summary\s*>/iu.exec(followingText)?.[1];
        if (summary && isMetadataName(decodeEntities(summary.replace(new RegExp(HTML_TOKEN_SOURCE, 'giu'), '')).trim())) return true;
    }
    return false;
}

/** Extract narrative without rendering HTML or modifying the stored chat. */
export function extractSceneText(value) {
    const source = removeFencedCode(String(value ?? '').replace(/\r\n?/gu, '\n'))
        .replace(/\[PARALLEL(?:\|[^\]\n]*)?\][\s\S]*?(?:\[\/PARALLEL\]|$)/giu, '\n');
    // Recognize tags with quoted attributes, so a '>' in an attribute is not
    // treated as the end of the tag. Ordinary '<' comparisons remain text.
    const tokens = [...source.matchAll(new RegExp(`${HTML_TOKEN_SOURCE}|${BRACKET_TOKEN_SOURCE}`, 'giu'))];
    const bracketOpenings = new Map();
    const pairedBrackets = new Set();
    for (const token of tokens) {
        const match = /^\[(\/?)([a-z][\w:.-]*)/iu.exec(token[0]);
        if (!match) continue;
        const name = match[2].toLowerCase();
        if (!isMetadataName(name) && !NARRATIVE_NAMES.has(name)) continue;
        const openings = bracketOpenings.get(name) || [];
        if (match[1]) {
            const opening = openings.pop();
            if (opening !== undefined) {
                pairedBrackets.add(opening);
                pairedBrackets.add(token.index);
            }
        } else openings.push(token.index);
        bracketOpenings.set(name, openings);
    }
    const allText = [];
    const omitted = [];
    let cursor = 0;
    const append = (text) => {
        if (omitted.length) return;
        allText.push(text);
    };
    for (const token of tokens) {
        append(source.slice(cursor, token.index));
        cursor = token.index + token[0].length;
        const tag = /^[<\[](\/?)([\w:.-]+)/u.exec(token[0]);
        if (!tag) continue;
        const closing = Boolean(tag[1]);
        const name = tag[2].toLowerCase();
        const bracket = token[0][0] === '[';
        const key = `${bracket ? 'bracket' : 'html'}:${name}`;
        // Unpaired labels and ordinary bracketed dialogue are not block
        // boundaries. Preserve them instead of guessing where narration ends.
        if (bracket && !pairedBrackets.has(token.index)) {
            append(token[0]);
            continue;
        }
        if (closing) {
            const index = omitted.lastIndexOf(key);
            if (index !== -1) {
                omitted.splice(index);
                append('\n');
                continue;
            }
            if (omitted.length) continue;
            if (BLOCK_TAGS.has(name) || NARRATIVE_NAMES.has(name)) append('\n');
        } else {
            const selfClosing = !bracket && (/\/\s*>$/u.test(token[0]) || VOID_TAGS.has(name));
            if (shouldOmitElement(name, token[0].slice(tag[0].length, -1), source.slice(cursor))) {
                append('\n');
                if (!selfClosing) omitted.push(key);
                continue;
            }
            if (omitted.length) {
                if (!selfClosing) omitted.push(key);
                continue;
            }
            if (BLOCK_TAGS.has(name) || NARRATIVE_NAMES.has(name)) append('\n');
        }
    }
    append(source.slice(cursor));
    // Decode after stripping tags: escaped literal markup remains story text.
    return decodeEntities(allText.join(''))
        .replace(/[\t \u00a0]+/gu, ' ').replace(/ *\n */gu, '\n')
        .replace(/\n{3,}/gu, '\n\n').trim();
}

/** Clean all scene sources before focus/context assembly and cast inference. */
export function buildScenePrompt({ sourceMessage, focusText = null, nearbyMessages = [], sender = '', useStoryContext = false } = {}) {
    const source = extractSceneText(sourceMessage);
    if (!source) throw new Error('No scene text remains after removing trackers and markup.');
    const nearby = nearbyMessages.map((message) => ({ ...message, text: extractSceneText(message.text) })).filter((message) => message.text);
    const focus = normalizeFocusText(focusText);
    const normalizedSource = source.replace(/\s+/gu, ' ');
    const acceptedFocus = focus && (normalizedSource.includes(focus) || normalizedSource.replace(/[*_~`]/gu, '').includes(focus)) ? focus : null;
    const storyContext = useStoryContext && nearby.length
        ? `[Story Context - Generate an image for the final message]:\n\n${nearby.map((message) => `[${message.isUser ? '{{user}}' : '{{char}}'} (${message.name})]: ${message.text}`).join('\n\n')}`
        : undefined;
    return {
        sourceMessage: source,
        focusText: acceptedFocus,
        nearbyMessages: nearby,
        messageContent: buildFocusedMessageContent({ sourceMessage: source, focusText: acceptedFocus, sender, storyContext }),
    };
}
