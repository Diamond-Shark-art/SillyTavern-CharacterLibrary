// Botbooru Provider - support for browsing, linking, auth, and importing
// characters from botbooru.com.

import { ProviderBase } from '../provider-interface.js';
import CoreAPI from '../../core-api.js';
import { assignGalleryId, importFromPng } from '../provider-utils.js';
import botbooruBrowseView from './botbooru-browse.js';
import {
    buildCharacterCardFromPost,
    ensureBotbooruExtension,
    fetchCardJson,
    fetchCardPngBuffer,
    fetchCurrentUser,
    fetchPost,
    getCharacterPageUrl,
    getPreviewImageUrl,
    normalizePostId,
    parseCharacterUrl,
    searchPosts,
    slugify,
    stripHtml,
} from './botbooru-api.js';

let api = null;

class BotbooruProvider extends ProviderBase {
    // ── Identity ────────────────────────────────────────────

    get id() { return 'botbooru'; }
    get name() { return 'Botbooru'; }
    get icon() { return 'fa-solid fa-box-archive'; }
    get iconUrl() { return 'https://botbooru.com/favicon.ico?v=2'; }
    get browseView() { return botbooruBrowseView; }

    get linkStatFields() {
        return {
            stat1: { icon: 'fa-solid fa-download', label: 'Downloads' },
            stat2: { icon: 'fa-solid fa-heart', label: 'Favorites' },
            stat3: { icon: 'fa-solid fa-coins', label: 'Tokens' },
        };
    }

    // ── Lifecycle ───────────────────────────────────────────

    async init(coreAPI) {
        super.init(coreAPI);
        api = coreAPI;
    }

    async activate(container, options = {}) {
        botbooruBrowseView.activate(container, options);
    }

    deactivate() {
        botbooruBrowseView.deactivate();
    }

    // ── View ────────────────────────────────────────────────

    renderFilterBar() { return botbooruBrowseView.renderFilterBar(); }
    renderView() { return botbooruBrowseView.renderView(); }
    renderModals() { return botbooruBrowseView.renderModals(); }

    // ── Character Linking ───────────────────────────────────

    getLinkInfo(char) {
        if (!char) return null;
        const extensions = char.data?.extensions || char.extensions;
        const bb = extensions?.botbooru;
        if (!bb) return null;
        const id = normalizePostId(bb.id || bb.postId || bb.post_id || bb.fullPath);
        if (!id) return null;
        return {
            providerId: 'botbooru',
            id,
            fullPath: id,
            linkedAt: bb.linkedAt || null,
        };
    }

    setLinkInfo(char, linkInfo) {
        if (!char) return;
        if (!char.data) char.data = {};
        if (!char.data.extensions) char.data.extensions = {};

        if (linkInfo) {
            const existing = char.data.extensions.botbooru || {};
            char.data.extensions.botbooru = {
                id: normalizePostId(linkInfo.id || linkInfo.fullPath),
                linkedAt: linkInfo.linkedAt || existing.linkedAt || new Date().toISOString(),
                pageName: linkInfo.pageName || existing.pageName || null,
                filename: linkInfo.filename || existing.filename || null,
                tagline: linkInfo.tagline || existing.tagline || '',
            };
        } else {
            delete char.data.extensions.botbooru;
        }
    }

    getCharacterUrl(linkInfo) {
        const id = normalizePostId(linkInfo?.id || linkInfo?.fullPath);
        return id ? getCharacterPageUrl(id) : null;
    }

    openLinkUI(char) {
        CoreAPI.openProviderLinkModal?.(char);
    }

    get supportsInAppPreview() { return true; }

    async buildPreviewObject(_char, linkInfo) {
        const id = normalizePostId(linkInfo?.id || linkInfo?.fullPath);
        if (!id) return null;
        try {
            return await fetchPost(id, api?.getSetting?.('botbooruToken'));
        } catch {
            return { id, character_name: linkInfo.pageName || `Botbooru #${id}` };
        }
    }

    openPreview(previewChar) {
        botbooruBrowseView.openPreview(previewChar);
    }

    // ── Remote Data ─────────────────────────────────────────

    async fetchMetadata(fullPath) {
        const id = normalizePostId(fullPath);
        if (!id) return null;
        return fetchPost(id, api?.getSetting?.('botbooruToken'));
    }

    async fetchRemoteCard(linkInfo) {
        const id = normalizePostId(linkInfo?.id || linkInfo?.fullPath);
        if (!id) return null;
        const token = api?.getSetting?.('botbooruToken');
        let post = null;
        try { post = await fetchPost(id, token); } catch (_) { /* fallback below */ }

        try {
            const card = await fetchCardJson(id, token, 'original');
            return ensureBotbooruExtension(card, post || { id });
        } catch (e) {
            if (post) return buildCharacterCardFromPost(post);
            console.warn('[BotbooruProvider] fetchRemoteCard failed:', e.message);
            return null;
        }
    }

    getComparableFields() {
        return [
            {
                path: 'extensions.botbooru.tagline',
                label: 'Botbooru Tagline',
                icon: 'fa-solid fa-quote-left',
                optional: true,
                group: 'tagline',
                groupLabel: 'Tagline',
            },
        ];
    }

    // ── Authentication ──────────────────────────────────────

    get hasAuth() { return true; }

    get isAuthenticated() {
        return !!api?.getSetting?.('botbooruToken');
    }

    openAuthUI() {
        window.openBotbooruLoginModal?.();
    }

    getAuthHeaders() {
        const token = api?.getSetting?.('botbooruToken');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async validateAuth() {
        const token = api?.getSetting?.('botbooruToken');
        if (!token) return false;
        try {
            await fetchCurrentUser(token);
            return true;
        } catch {
            return false;
        }
    }

    // ── URL Handling ────────────────────────────────────────

    canHandleUrl(url) {
        return !!parseCharacterUrl(url);
    }

    parseUrl(url) {
        return parseCharacterUrl(url);
    }

    // ── Settings ────────────────────────────────────────────

    getSettings() {
        return [
            {
                key: 'botbooruToken',
                label: 'Botbooru Token',
                type: 'password',
                defaultValue: null,
                hint: 'Stored after logging in from the Botbooru provider.',
                section: 'Authentication',
            },
        ];
    }

    // ── Bulk Linking ────────────────────────────────────────

    get supportsBulkLink() { return true; }

    openBulkLinkUI() {
        CoreAPI.openBulkAutoLinkModal?.();
    }

    async searchForBulkLink(name, _creator) {
        if (!name) return [];
        try {
            const data = await searchPosts({
                query: name,
                sort: 'latest',
                limit: 15,
                includeNsfw: false,
                token: api?.getSetting?.('botbooruToken'),
            });
            return (data?.posts || []).map(post => this._normalizeSearchResult(post));
        } catch (e) {
            console.error('[BotbooruProvider] searchForBulkLink error:', e);
            return [];
        }
    }

    getResultAvatarUrl(result) {
        return result.avatarUrl || '';
    }

    // ── Import Pipeline ─────────────────────────────────────

    get supportsImport() { return true; }

    async importCharacter(postId, hitData, options = {}) {
        const id = normalizePostId(postId);
        if (!id) return { success: false, error: 'Invalid Botbooru post id' };

        const token = api?.getSetting?.('botbooruToken');
        try {
            let post = hitData?.id ? hitData : null;
            if (!post) post = await fetchPost(id, token);

            let characterCard = null;
            try {
                characterCard = await fetchCardJson(id, token, 'original');
            } catch (e) {
                console.warn('[BotbooruProvider] JSON download failed, building from post API:', e.message);
                characterCard = buildCharacterCardFromPost(post);
            }
            characterCard = ensureBotbooruExtension(characterCard, post);
            assignGalleryId(characterCard, options, api);

            let imageBuffer = null;
            try {
                imageBuffer = await fetchCardPngBuffer(id, token, 'original');
            } catch (e) {
                console.warn('[BotbooruProvider] PNG download failed:', e.message);
            }

            const characterName = characterCard?.data?.name || post?.character_name || post?.meta_name || `Botbooru ${id}`;
            return await importFromPng({
                characterCard,
                imageBuffer,
                fileName: `botbooru_${slugify(characterName)}.png`,
                characterName,
                hasGallery: false,
                providerCharId: id,
                fullPath: id,
                avatarUrl: getPreviewImageUrl(post, 480),
                api,
            });
        } catch (error) {
            console.error(`[BotbooruProvider] importCharacter failed for ${id}:`, error);
            return { success: false, error: error.message };
        }
    }

    get supportsGallery() { return false; }

    async searchForImportMatch(name, creator, localChar) {
        if (!name) return null;
        try {
            const results = await this.searchForBulkLink(name, creator || '');
            if (!results.length) return null;
            const normalizedName = name.toLowerCase().trim();
            const exact = results.find(r => (r.name || '').toLowerCase().trim() === normalizedName);
            const match = exact || results[0];
            return { id: match.id, fullPath: match.fullPath, hasGallery: false };
        } catch (e) {
            console.error('[BotbooruProvider] searchForImportMatch:', e);
            return null;
        }
    }

    _normalizeSearchResult(post) {
        return {
            id: normalizePostId(post?.id),
            fullPath: String(post?.id || ''),
            name: post?.meta_name || post?.character_name || 'Unnamed',
            avatarUrl: getPreviewImageUrl(post, 480),
            rating: 0,
            starCount: post?.favorite_count || 0,
            description: stripHtml(post?.description_excerpt || post?.creator_notes_excerpt || post?.tagline || ''),
            tagline: post?.tagline || '',
            nTokens: post?.token_count || 0,
        };
    }
}

const botbooruProvider = new BotbooruProvider();

export default botbooruProvider;
