// Botbooru API utilities - shared by the Botbooru provider and browse view.

import { fetchWithProxy, formatNumber, slugify, stripHtml } from '../provider-utils.js';

export { fetchWithProxy, formatNumber, slugify, stripHtml };

export const BOTBOORU_SITE_BASE = 'https://botbooru.com';
export const BOTBOORU_PAGE_SIZE = 24;

export const BOTBOORU_SORT_OPTIONS = {
    latest: 'Latest',
    random: 'Randomized',
    favorites: 'Favorited',
    views: 'Viewed',
    downloads: 'Downloaded',
    curated: 'Curated',
};

export const BOTBOORU_TIME_WINDOWS = {
    week: '1 Week',
    month: '1 Month',
    all: 'All Time',
};

function makeUrl(path, params) {
    const url = new URL(path, BOTBOORU_SITE_BASE);
    if (params) {
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
    }
    return url.href;
}

function authHeaders(token, extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

export function normalizePostId(value) {
    const match = String(value || '').match(/\d+/);
    return match ? match[0] : null;
}

export function parseCharacterUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        if (!/^(www\.)?botbooru\.com$/i.test(u.hostname)) return null;
        const match = u.pathname.match(/^\/(?:character|post)\/(\d+)/i)
            || u.pathname.match(/^\/download\/(?:png|json)\/(\d+)/i);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

export function getCharacterPageUrl(postId) {
    return `${BOTBOORU_SITE_BASE}/character/${encodeURIComponent(postId)}`;
}

export function getDownloadPngUrl(postId, tagSource = 'original') {
    return makeUrl(`/download/png/${encodeURIComponent(postId)}`, tagSource ? { tag_source: tagSource } : null);
}

export function getDownloadJsonUrl(postId, tagSource = 'original') {
    return makeUrl(`/download/json/${encodeURIComponent(postId)}`, tagSource ? { tag_source: tagSource } : null);
}

export function getImageUrl(filename) {
    return filename ? `${BOTBOORU_SITE_BASE}/images/${encodeURIComponent(filename)}` : '';
}

export function getPreviewImageUrl(post, maxEdge = 480) {
    const filename = post?.filename;
    if (!filename) return '/img/ai4.png';
    return `${BOTBOORU_SITE_BASE}/images/preview/${maxEdge}/${encodeURIComponent(filename)}`;
}

export function parsePostTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.map(tag => {
        if (!tag) return null;
        if (typeof tag === 'string') return tag;
        const name = tag.name || tag.tag || '';
        const category = tag.category || '';
        if (!name) return null;
        return category && !String(name).includes(':') ? `${category}:${name}` : String(name);
    }).filter(Boolean);
}

export function isExplicitPost(post) {
    return parsePostTags(post?.tags).some(tag => {
        const lower = tag.toLowerCase();
        return lower === 'nsfw' || lower === 'nsfl' || lower === 'meta:nsfw' || lower === 'meta:nsfl';
    });
}

export async function loginBotbooru(username, password) {
    const body = new URLSearchParams({ username, password });
    const response = await fetchWithProxy(`${BOTBOORU_SITE_BASE}/auth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body,
    });
    const data = await response.json();
    if (!data?.access_token) throw new Error('Botbooru did not return an access token');
    return data;
}

export async function fetchCurrentUser(token) {
    if (!token) return null;
    const response = await fetchWithProxy(`${BOTBOORU_SITE_BASE}/auth/me`, {
        headers: authHeaders(token),
    });
    return response.json();
}

export async function searchPosts(opts = {}) {
    const {
        query = '',
        sort = 'latest',
        limit = BOTBOORU_PAGE_SIZE,
        offset = 0,
        includeNsfw = false,
        minTokens = null,
        timeWindow = 'week',
        hideAi = false,
        token = null,
    } = opts;

    const params = {
        sort,
        q: query,
        limit,
        offset,
    };
    if (!includeNsfw) params.sfw_only = 'true';
    if (minTokens !== null && minTokens !== '') params.min_tokens = minTokens;
    if (['favorites', 'views', 'downloads', 'curated'].includes(sort)) {
        params.time_window = ['month', 'all'].includes(timeWindow) ? timeWindow : 'week';
    }
    if (hideAi) params.hide_ai = 'true';

    const response = await fetchWithProxy(makeUrl('/posts/', params), {
        headers: authHeaders(token),
    });
    return response.json();
}

export async function fetchPost(postId, token) {
    const id = normalizePostId(postId);
    if (!id) throw new Error('Invalid Botbooru post id');
    const response = await fetchWithProxy(`${BOTBOORU_SITE_BASE}/post/${encodeURIComponent(id)}`, {
        headers: authHeaders(token),
    });
    return response.json();
}

export async function fetchCardJson(postId, token, tagSource = 'original') {
    const response = await fetchWithProxy(getDownloadJsonUrl(postId, tagSource), {
        headers: authHeaders(token),
    });
    return response.json();
}

export async function fetchCardPngBuffer(postId, token, tagSource = 'original') {
    const response = await fetchWithProxy(getDownloadPngUrl(postId, tagSource), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.arrayBuffer();
}

export function buildCharacterCardFromPost(post) {
    const tags = parsePostTags(post?.embedded_card_tags?.length ? post.embedded_card_tags : post?.tags);
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: post?.character_name || post?.meta_name || 'Unnamed',
            description: post?.description || '',
            personality: post?.personality || '',
            scenario: post?.scenario || '',
            first_mes: post?.first_mes || '',
            mes_example: post?.mes_example || '',
            system_prompt: post?.system_prompt || '',
            post_history_instructions: post?.post_history_instructions || '',
            creator_notes: post?.creator_notes || '',
            creator: post?.uploader_name || '',
            character_version: '',
            tags,
            alternate_greetings: Array.isArray(post?.alternate_greetings) ? post.alternate_greetings.filter(Boolean) : [],
            extensions: {
                botbooru: {
                    id: post?.id || null,
                    filename: post?.filename || null,
                    tagline: post?.tagline || '',
                    linkedAt: new Date().toISOString(),
                    pageName: post?.meta_name || post?.character_name || null,
                },
            },
        },
    };
}

export function ensureBotbooruExtension(card, post) {
    if (!card) return card;
    if (!card.spec) {
        card = { spec: 'chara_card_v2', spec_version: '2.0', data: card.data || card };
    }
    if (!card.data) card.data = {};
    if (!card.data.extensions) card.data.extensions = {};
    card.data.extensions.botbooru = {
        ...(card.data.extensions.botbooru || {}),
        id: post?.id || card.data.extensions.botbooru?.id || null,
        filename: post?.filename || card.data.extensions.botbooru?.filename || null,
        tagline: post?.tagline || card.data.extensions.botbooru?.tagline || '',
        linkedAt: card.data.extensions.botbooru?.linkedAt || new Date().toISOString(),
        pageName: post?.meta_name || post?.character_name || card.data.name || null,
    };
    return card;
}
