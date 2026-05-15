// Botbooru browse/search UI for the Online tab.

import { BrowseView } from '../browse-view.js';
import CoreAPI from '../../core-api.js';
import { IMG_PLACEHOLDER } from '../provider-utils.js';
import {
    BOTBOORU_PAGE_SIZE,
    BOTBOORU_SORT_OPTIONS,
    BOTBOORU_TIME_WINDOWS,
    fetchCurrentUser,
    fetchPost,
    formatNumber,
    getCharacterPageUrl,
    getPreviewImageUrl,
    isCloudflareBlockError,
    isExplicitPost,
    parseCharacterUrl,
    parsePostTags,
    searchPosts,
    stripHtml,
} from './botbooru-api.js';

const {
    onElement: on,
    showToast,
    escapeHtml,
    safePurify,
    debugLog,
    getSetting,
    setSetting,
    checkCharacterForDuplicatesAsync,
    showPreImportDuplicateWarning,
    deleteCharacter,
    fetchCharacters,
    getCharacterGalleryId,
} = CoreAPI;

let botbooruPosts = [];
let botbooruOffset = 0;
let botbooruHasMore = true;
let botbooruLoading = false;
let botbooruSearch = '';
let botbooruSort = 'latest';
let botbooruTimeWindow = 'week';
let botbooruNsfw = false;
let botbooruSelectedPost = null;
let botbooruUser = null;
let botbooruLoadToken = 0;
let view;

function withEl(id, fn) {
    const el = document.getElementById(id);
    if (el) fn(el);
}

function token() {
    return getSetting('botbooruToken') || '';
}

function canShowNsfw() {
    return !!token() && botbooruNsfw;
}

function createBotbooruCard(post) {
    const id = post.id;
    const name = post.meta_name || post.character_name || 'Unknown';
    const desc = stripHtml(post.tagline || post.description_excerpt || post.creator_notes_excerpt || '');
    const avatarUrl = getPreviewImageUrl(post, 480);
    const tags = parsePostTags(post.tags).slice(0, 3);
    const inLibrary = id != null && view._lookup.byProviderId.has(String(id));
    const creator = post.uploader_name || '';
    const possibleMatch = !inLibrary && view.isCharPossibleMatch(name, creator);
    const explicit = isExplicitPost(post);

    const badges = [];
    if (inLibrary) {
        badges.push('<span class="browse-feature-badge in-library" title="In Your Library"><i class="fa-solid fa-check"></i></span>');
    } else if (possibleMatch) {
        badges.push('<span class="browse-feature-badge possible-library" title="Possible Match in Library"><i class="fa-solid fa-check"></i></span>');
    }
    if (post.has_lorebook) badges.push('<span class="browse-feature-badge" title="Has Lorebook"><i class="fa-solid fa-book"></i></span>');
    if (post.is_fork) badges.push('<span class="browse-feature-badge" title="Fork of another post"><i class="fa-solid fa-code-fork"></i></span>');
    if (post.fork_count) badges.push('<span class="browse-feature-badge" title="Has forks"><i class="fa-solid fa-code-branch"></i></span>');

    const cardClass = inLibrary ? 'browse-card in-library' : possibleMatch ? 'browse-card possible-library' : 'browse-card';

    return `
        <div class="${cardClass}" data-botbooru-id="${escapeHtml(String(id || ''))}" ${desc ? `title="${escapeHtml(desc)}"` : ''}>
            <div class="browse-card-image">
                <img data-src="${escapeHtml(avatarUrl)}" src="${IMG_PLACEHOLDER}" alt="${escapeHtml(name)}" decoding="async" fetchpriority="low" onerror="this.dataset.failed='1';this.src='/img/ai4.png'">
                ${explicit ? '<span class="browse-nsfw-badge">NSFW</span>' : ''}
                ${badges.length > 0 ? `<div class="browse-feature-badges">${badges.join('')}</div>` : ''}
            </div>
            <div class="browse-card-body">
                <div class="browse-card-name">${escapeHtml(name)}</div>
                ${creator ? `<span class="browse-card-creator-link">${escapeHtml(creator)}</span>` : ''}
                <div class="browse-card-tags">
                    ${tags.map(t => `<span class="browse-card-tag" title="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}
                </div>
            </div>
            <div class="browse-card-footer">
                <span class="browse-card-stat" title="Tokens"><i class="fa-solid fa-font"></i> ${formatNumber(post.token_count || 0)}</span>
                <span class="browse-card-stat" title="Downloads"><i class="fa-solid fa-download"></i> ${formatNumber(post.downloads || 0)}</span>
                <span class="browse-card-stat" title="Favorites"><i class="fa-solid fa-heart"></i> ${formatNumber(post.favorite_count || 0)}</span>
            </div>
        </div>`;
}

function renderBotbooruGrid(append = false) {
    const grid = document.getElementById('botbooruGrid');
    const empty = document.getElementById('botbooruEmpty');
    if (!grid) return;

    if (!botbooruPosts.length) {
        grid.innerHTML = '';
        empty?.classList.remove('hidden');
    } else {
        empty?.classList.add('hidden');
        const html = botbooruPosts.map(createBotbooruCard).join('');
        grid.innerHTML = html;
        botbooruBrowseView.observeImages(grid);
    }

    botbooruBrowseView.updateLoadMoreVisibility('botbooruLoadMore', botbooruHasMore, botbooruPosts.length > 0);
}

async function loadBotbooruPosts({ reset = false } = {}) {
    if (botbooruLoading) return;
    botbooruLoading = true;
    const loadToken = ++botbooruLoadToken;

    const grid = document.getElementById('botbooruGrid');
    if (reset) {
        botbooruOffset = 0;
        botbooruPosts = [];
        botbooruHasMore = true;
        if (grid) grid.innerHTML = '<div class="browse-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading Botbooru...</div>';
    }

    try {
        const data = await searchPosts({
            query: botbooruSearch,
            sort: botbooruSort,
            limit: BOTBOORU_PAGE_SIZE,
            offset: botbooruOffset,
            includeNsfw: canShowNsfw(),
            timeWindow: botbooruTimeWindow,
            token: token(),
        });
        if (loadToken !== botbooruLoadToken) return;
        const posts = Array.isArray(data?.posts) ? data.posts : [];
        botbooruPosts = reset ? posts : [...botbooruPosts, ...posts];
        botbooruOffset += posts.length;
        botbooruHasMore = posts.length >= BOTBOORU_PAGE_SIZE && botbooruOffset < (data?.total || Infinity);
        renderBotbooruGrid();
    } catch (err) {
        console.error('[Botbooru] load failed:', err);
        if (grid) {
            const blocked = isCloudflareBlockError(err);
            grid.innerHTML = blocked
                ? `<div class="browse-error botbooru-blocked">
                    <i class="fa-solid fa-shield-halved"></i>
                    <div>
                        <strong>Botbooru is blocking extension requests.</strong>
                        <p>${escapeHtml(err.message)}</p>
                        <a class="action-btn secondary" href="https://botbooru.com/" target="_blank" rel="noopener">
                            <i class="fa-solid fa-up-right-from-square"></i> Open Botbooru
                        </a>
                    </div>
                </div>`
                : `<div class="browse-error">Failed to load Botbooru: ${escapeHtml(err.message || 'Unknown error')}</div>`;
        }
    } finally {
        botbooruLoading = false;
    }
}

async function openBotbooruPreview(postOrId) {
    const id = typeof postOrId === 'object' ? postOrId.id : postOrId;
    if (!id) return;

    let post = typeof postOrId === 'object' ? postOrId : null;
    try {
        post = await fetchPost(id, token());
    } catch (err) {
        if (!post) {
            showToast?.(`Could not load Botbooru character: ${err.message}`, 'error');
            return;
        }
    }
    botbooruSelectedPost = post;

    const name = post.meta_name || post.character_name || 'Unknown';
    const avatar = getPreviewImageUrl(post, 720);
    const tags = parsePostTags(post.tags);
    const modal = document.getElementById('botbooruCharModal');
    if (!modal) return;

    withEl('botbooruCharAvatar', el => { el.src = avatar; el.alt = name; });
    withEl('botbooruCharName', el => { el.textContent = name; });
    withEl('botbooruCharCreator', el => { el.textContent = post.uploader_name || 'Unknown'; });
    withEl('botbooruCharDate', el => { el.textContent = post.created_at ? new Date(post.created_at).toLocaleDateString() : 'Unknown'; });
    withEl('botbooruCharDownloads', el => { el.textContent = formatNumber(post.downloads || 0); });
    withEl('botbooruCharFavorites', el => { el.textContent = formatNumber(post.favorite_count || 0); });
    withEl('botbooruCharTokens', el => { el.textContent = formatNumber(post.token_count || 0); });
    withEl('botbooruCharTags', el => {
        el.innerHTML = tags.map(t => `<span class="browse-tag">${escapeHtml(t)}</span>`).join('');
    });
    withEl('botbooruCharDescription', el => {
        const text = post.description || post.creator_notes || post.tagline || '';
        el.innerHTML = text ? safePurify(formatText(text)) : '<em>No description available.</em>';
    });
    withEl('botbooruOpenInBrowserBtn', el => { el.href = getCharacterPageUrl(post.id); });

    modal.classList.remove('hidden');
}

function formatText(text) {
    const escaped = escapeHtml(String(text || ''));
    return escaped.replace(/\n/g, '<br>');
}

function searchOrOpenBotbooru(inputValue) {
    const raw = String(inputValue || '').trim();
    const id = parseCharacterUrl(raw);
    if (id) {
        openBotbooruPreview(id);
        return;
    }
    botbooruSearch = raw;
    loadBotbooruPosts({ reset: true });
}

async function importSelectedBotbooruPost() {
    if (!botbooruSelectedPost) return;
    const provider = botbooruBrowseView.provider;
    const post = botbooruSelectedPost;
    const importBtn = document.getElementById('botbooruImportBtn');
    const originalHtml = importBtn?.innerHTML;
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importing...';
    }

    let existingChar = null;
    try {
        const charName = post.character_name || post.meta_name || '';
        const duplicateMatches = await checkCharacterForDuplicatesAsync?.({
            name: charName,
            creator: post.uploader_name || '',
            fullPath: String(post.id),
            description: post.description || post.description_excerpt || '',
            first_mes: post.first_mes || '',
            personality: post.personality || '',
            scenario: post.scenario || '',
        });
        if (duplicateMatches && duplicateMatches.length > 0) {
            const proceed = await showPreImportDuplicateWarning?.({
                name: charName,
                creator: post.uploader_name || '',
                fullPath: String(post.id),
                avatarUrl: getPreviewImageUrl(post, 480),
            }, duplicateMatches);
            if (proceed?.choice === 'skip') return;
            if (proceed?.choice === 'replace') {
                existingChar = duplicateMatches[0].char || null;
            }
        }
        const inheritedGalleryId = existingChar ? getCharacterGalleryId?.(existingChar) : null;
        if (existingChar) {
            if (importBtn) importBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Replacing...';
            try { await deleteCharacter(existingChar, false); } catch (_) { /* best-effort replacement cleanup */ }
        }

        const result = await provider.importCharacter(String(post.id), post, {
            inheritedGalleryId,
        });
        if (!result?.success) throw new Error(result?.error || 'Import failed');
        await fetchCharacters?.();
        botbooruBrowseView.buildLocalLibraryLookup();
        renderBotbooruGrid();
        showToast?.(`Imported ${result.characterName || post.character_name || 'character'} from Botbooru`, 'success');
        document.getElementById('botbooruCharModal')?.classList.add('hidden');
    } catch (err) {
        showToast?.(`Botbooru import failed: ${err.message}`, 'error');
    } finally {
        if (importBtn) {
            importBtn.disabled = false;
            importBtn.innerHTML = originalHtml;
        }
    }
}

function updateAuthUi() {
    const authed = !!token();
    withEl('botbooruLoginBtn', el => {
        el.innerHTML = authed
            ? '<i class="fa-solid fa-user-check"></i> <span>Logged in</span>'
            : '<i class="fa-solid fa-right-to-bracket"></i> <span>Login</span>';
        el.classList.toggle('active', authed);
    });
    withEl('botbooruAuthStatus', el => {
        el.textContent = authed
            ? `Logged in${botbooruUser?.username ? ` as ${botbooruUser.username}` : ''}`
            : 'Not logged in';
    });
}

async function validateSavedToken() {
    if (!token()) {
        botbooruUser = null;
        updateAuthUi();
        return;
    }
    try {
        botbooruUser = await fetchCurrentUser(token());
    } catch (err) {
        console.warn('[Botbooru] saved token validation failed:', err.message);
        botbooruUser = null;
    }
    updateAuthUi();
}

class BotbooruBrowseView extends BrowseView {
    constructor() {
        super(null);
        view = this;
    }

    init() {
        super.init();

        on('botbooruSearchBtn', 'click', () => {
            searchOrOpenBotbooru(document.getElementById('botbooruSearchInput')?.value || '');
        });
        on('botbooruSearchInput', 'keydown', e => {
            if (e.key === 'Enter') {
                searchOrOpenBotbooru(e.currentTarget.value);
            }
        });
        on('botbooruClearSearchBtn', 'click', () => {
            const input = document.getElementById('botbooruSearchInput');
            if (input) input.value = '';
            botbooruSearch = '';
            loadBotbooruPosts({ reset: true });
        });
        on('botbooruSortSelect', 'change', e => {
            botbooruSort = e.currentTarget.value || 'latest';
            document.getElementById('botbooruTimeSelect')?.classList.toggle('hidden', !['favorites', 'views', 'downloads', 'curated'].includes(botbooruSort));
            loadBotbooruPosts({ reset: true });
        });
        on('botbooruTimeSelect', 'change', e => {
            botbooruTimeWindow = e.currentTarget.value || 'week';
            loadBotbooruPosts({ reset: true });
        });
        on('botbooruNsfwToggle', 'click', e => {
            if (!token()) {
                showToast?.('Login to Botbooru before browsing NSFW content.', 'warning');
                window.openBotbooruLoginModal?.();
                return;
            }
            botbooruNsfw = !botbooruNsfw;
            e.currentTarget.classList.toggle('active', botbooruNsfw);
            loadBotbooruPosts({ reset: true });
        });
        on('botbooruRefreshBtn', 'click', () => loadBotbooruPosts({ reset: true }));
        on('botbooruLoadMoreBtn', 'click', () => loadBotbooruPosts());
        on('botbooruGrid', 'click', e => {
            const card = e.target.closest('[data-botbooru-id]');
            if (!card) return;
            openBotbooruPreview(card.dataset.botbooruId);
        });
        on('botbooruCharClose', 'click', () => document.getElementById('botbooruCharModal')?.classList.add('hidden'));
        on('botbooruCharModal', 'click', e => {
            if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
        });
        on('botbooruImportBtn', 'click', importSelectedBotbooruPost);
        on('botbooruLoginBtn', 'click', () => window.openBotbooruLoginModal?.());
        on('botbooruLoginClose', 'click', () => document.getElementById('botbooruLoginModal')?.classList.add('hidden'));
        on('botbooruLoginModal', 'click', e => {
            if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
        });
        on('botbooruLogoutBtn', 'click', () => {
            setSetting('botbooruToken', null);
            botbooruUser = null;
            botbooruNsfw = false;
            updateAuthUi();
            loadBotbooruPosts({ reset: true });
        });
        on('botbooruLoginForm', 'submit', async e => {
            e.preventDefault();
            const status = document.getElementById('botbooruLoginStatus');
            const pastedToken = document.getElementById('botbooruTokenInput')?.value?.trim();
            if (!pastedToken) return;
            if (status) status.textContent = 'Checking token...';
            try {
                botbooruUser = await fetchCurrentUser(pastedToken);
                setSetting('botbooruToken', pastedToken);
                if (status) status.textContent = 'Token accepted.';
                withEl('botbooruTokenInput', el => { el.value = ''; });
                document.getElementById('botbooruLoginModal')?.classList.add('hidden');
                updateAuthUi();
                loadBotbooruPosts({ reset: true });
            } catch (err) {
                if (status) {
                    status.textContent = isCloudflareBlockError(err)
                        ? 'Botbooru is blocking token checks right now. Try again later.'
                        : 'Token rejected. Copy the value named "token" from Botbooru local storage.';
                }
            }
        });

        window.openBotbooruLoginModal = () => {
            updateAuthUi();
            document.getElementById('botbooruLoginModal')?.classList.remove('hidden');
        };
        window.registerOverlay?.({ id: 'botbooruLoginModal', tier: 6, close: () => document.getElementById('botbooruLoginModal')?.classList.add('hidden') });

        validateSavedToken();
    }

    async activate(container, options = {}) {
        super.activate(container, options);
        this.buildLocalLibraryLookup();
        if (options.defaults?.sort) {
            botbooruSort = options.defaults.sort;
            const sortEl = document.getElementById('botbooruSortSelect');
            if (sortEl) sortEl.value = botbooruSort;
        }
        document.getElementById('botbooruTimeSelect')?.classList.toggle('hidden', !['favorites', 'views', 'downloads', 'curated'].includes(botbooruSort));
        if (!botbooruPosts.length || options.domRecreated) {
            await loadBotbooruPosts({ reset: true });
        } else {
            renderBotbooruGrid();
        }
    }

    deactivate() {
        super.deactivate();
    }

    renderFilterBar() {
        const sortOptions = Object.entries(BOTBOORU_SORT_OPTIONS)
            .map(([value, label]) => `<option value="${value}" ${value === botbooruSort ? 'selected' : ''}>${label}</option>`)
            .join('');
        const timeOptions = Object.entries(BOTBOORU_TIME_WINDOWS)
            .map(([value, label]) => `<option value="${value}" ${value === botbooruTimeWindow ? 'selected' : ''}>${label}</option>`)
            .join('');
        return `
            <div class="browse-sort-container">
                <select id="botbooruSortSelect" class="glass-select" title="Sort Botbooru">
                    ${sortOptions}
                </select>
                <select id="botbooruTimeSelect" class="glass-select hidden" title="Time window">
                    ${timeOptions}
                </select>
            </div>
            <button id="botbooruNsfwToggle" class="glass-btn nsfw-toggle" title="Toggle NSFW content">
                <i class="fa-solid fa-eye"></i> <span>NSFW</span>
            </button>
            <button id="botbooruLoginBtn" class="glass-btn" title="Login to Botbooru">
                <i class="fa-solid fa-key"></i> <span>Token</span>
            </button>
            <button id="botbooruRefreshBtn" class="glass-btn icon-only" title="Refresh">
                <i class="fa-solid fa-sync"></i>
            </button>`;
    }

    renderView() {
        return `
            <div class="browse-section botbooru-section">
                <div class="browse-search-row">
                    <div class="browse-search-box">
                        <i class="fa-solid fa-search"></i>
                        <input type="search" id="botbooruSearchInput" placeholder="Search Botbooru or paste a Botbooru URL..." autocomplete="one-time-code">
                        <button id="botbooruClearSearchBtn" class="browse-search-clear" title="Clear search"><i class="fa-solid fa-times"></i></button>
                        <button id="botbooruSearchBtn" class="browse-search-submit"><i class="fa-solid fa-search"></i></button>
                    </div>
                </div>
                <div id="botbooruAuthStatus" class="botbooru-auth-status">Not logged in</div>
                <div id="botbooruEmpty" class="browse-empty hidden">No Botbooru characters found.</div>
                <div id="botbooruGrid" class="browse-grid"></div>
                <div class="browse-load-more" id="botbooruLoadMore" style="display: none;">
                    <button id="botbooruLoadMoreBtn" class="glass-btn">
                        <i class="fa-solid fa-chevron-down"></i> Load more
                    </button>
                </div>
            </div>`;
    }

    renderModals() {
        return `
            <div id="botbooruCharModal" class="modal-overlay hidden">
                <div class="browse-char-modal-content">
                    <div class="browse-char-header">
                        <img id="botbooruCharAvatar" src="/img/ai4.png" alt="" class="browse-char-avatar">
                        <div class="browse-char-title">
                            <h2 id="botbooruCharName">Character Name</h2>
                            <div class="browse-char-creator">by <span id="botbooruCharCreator">Unknown</span></div>
                        </div>
                        <div class="browse-char-actions">
                            <a id="botbooruOpenInBrowserBtn" href="#" target="_blank" class="action-btn secondary" title="Open on Botbooru">
                                <i class="fa-solid fa-up-right-from-square"></i> Open
                            </a>
                            <button id="botbooruImportBtn" class="action-btn primary" title="Download to SillyTavern">
                                <i class="fa-solid fa-download"></i> Import
                            </button>
                            <button class="close-btn" id="botbooruCharClose">&times;</button>
                        </div>
                    </div>
                    <div class="browse-char-stats">
                        <div class="browse-stat"><i class="fa-solid fa-download"></i><span id="botbooruCharDownloads">0</span> downloads</div>
                        <div class="browse-stat"><i class="fa-solid fa-heart"></i><span id="botbooruCharFavorites">0</span> favorites</div>
                        <div class="browse-stat"><i class="fa-solid fa-font"></i><span id="botbooruCharTokens">0</span> tokens</div>
                        <div class="browse-stat"><i class="fa-solid fa-calendar"></i><span id="botbooruCharDate">Unknown</span></div>
                    </div>
                    <div class="browse-char-tags" id="botbooruCharTags"></div>
                    <div class="browse-char-section">
                        <h3 class="browse-section-title"><i class="fa-solid fa-scroll"></i> Description</h3>
                        <div id="botbooruCharDescription" class="scrolling-text"></div>
                    </div>
                </div>
            </div>
            <div id="botbooruLoginModal" class="modal-overlay hidden">
                <div class="botbooru-login-modal">
                    <div class="modal-header">
                        <h3><i class="fa-solid fa-key"></i> Botbooru Token</h3>
                        <button id="botbooruLoginClose" class="close-btn">&times;</button>
                    </div>
                    <form id="botbooruLoginForm" class="botbooru-login-form">
                        <label>Token
                            <input id="botbooruTokenInput" type="password" autocomplete="off" class="glass-input">
                        </label>
                        <div class="botbooru-login-help">Paste the value named <code>token</code> from Botbooru local storage.</div>
                        <div id="botbooruLoginStatus" class="botbooru-login-status"></div>
                        <div class="botbooru-login-actions">
                            <button type="submit" class="action-btn primary"><i class="fa-solid fa-key"></i> Save token</button>
                            <button type="button" id="botbooruLogoutBtn" class="action-btn secondary"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>
                        </div>
                    </form>
                </div>
            </div>`;
    }

    _extractProviderIds(char, idSet) {
        const ext = char.data?.extensions?.botbooru || char.extensions?.botbooru;
        if (ext?.id != null) idSet.add(String(ext.id));
    }

    get previewModalId() { return 'botbooruCharModal'; }

    get mobileFilterIds() {
        return {
            sort: 'botbooruSortSelect',
            tags: null,
            filters: null,
            nsfw: 'botbooruNsfwToggle',
            refresh: 'botbooruRefreshBtn',
        };
    }

    getSettingsConfig() {
        return {
            browseSortOptions: Object.entries(BOTBOORU_SORT_OPTIONS).map(([value, label]) => ({ value, label })),
            followingSortOptions: [],
            viewModes: [],
        };
    }

    canLoadMore() {
        return botbooruHasMore && !botbooruLoading;
    }

    loadMore() {
        return loadBotbooruPosts();
    }

    refreshInLibraryBadges() {
        super.refreshInLibraryBadges(card => {
            const id = card.dataset.botbooruId;
            return id && this._lookup.byProviderId.has(String(id));
        }, ['botbooruGrid']);
    }

    openPreview(post) {
        openBotbooruPreview(post);
    }
}

const botbooruBrowseView = new BotbooruBrowseView();

export default botbooruBrowseView;
