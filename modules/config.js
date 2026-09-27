/**
 * Roleo - Configuration & State Module
 * Centralized state management, constants, and security utilities.
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const CONSTANTS = {
  DEFAULT_AVATAR: 'icons/avatar-placeholder.svg',
  DEFAULT_ENDPOINT: 'http://localhost:1234/v1',
  STORAGE_KEYS: {
    PERSONAS: 'roleo_personas',
    ACTIVE_PERSONA: 'roleo_active_persona',
    CHARACTERS: 'roleo_characters',
    CHATS: 'roleo_chats',
    SIDEBAR: 'roleo_sidebar_open',
    ENDPOINT: 'roleo_endpoint',
    SELECTED_MODEL: 'roleo_selected_model'
  },
  NON_TEXT_KEYWORDS: ['embed', 'bge', 'rerank', 'clip', 'whisper', 'tts', 'stt', 'bert', 'vision-only'],
  VALID_TAGS: ['{{char}}', '{{user}}', '{{user_pronouns}}']
};

// ─── Secure Storage Wrapper ──────────────────────────────────────────────────
const Storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage save failed:', e);
    }
  }
};

// ─── Application State ───────────────────────────────────────────────────────
const AppState = {
  // Core data
  models: [],
  selectedModel: '',
  personas: [],
  activePersonaId: '',
  characters: [],
  chats: [],
  activeChatId: null,

  // UI state
  editingCharId: null,
  editingPersonaId: null,
  editingMsgId: null,
  activeRightTab: 'recents',
  sidebarOpen: true,

  // Generation state
  isGenerating: false,
  abortController: null,

  // Temp data
  tempCharAvatar: '',
  tempPersonaAvatar: '',
  attachedImage: null,

  // API config
  endpoint: CONSTANTS.DEFAULT_ENDPOINT,

  /**
   * Load all persisted state from storage.
   */
  load() {
    this.personas = Storage.get(CONSTANTS.STORAGE_KEYS.PERSONAS, [
      { id: 'p1', name: 'User', pronouns: 'they/them', avatar: '', desc: 'Default roleplay persona.' }
    ]);
    this.activePersonaId = Storage.get(CONSTANTS.STORAGE_KEYS.ACTIVE_PERSONA, 'p1');
    this.characters = Storage.get(CONSTANTS.STORAGE_KEYS.CHARACTERS, []);
    this.chats = Storage.get(CONSTANTS.STORAGE_KEYS.CHATS, []);
    this.sidebarOpen = Storage.get(CONSTANTS.STORAGE_KEYS.SIDEBAR, true);
    this.endpoint = Storage.get(CONSTANTS.STORAGE_KEYS.ENDPOINT, CONSTANTS.DEFAULT_ENDPOINT);
    this.selectedModel = Storage.get(CONSTANTS.STORAGE_KEYS.SELECTED_MODEL, '');

    // Ensure active persona still exists
    if (!this.personas.find(p => p.id === this.activePersonaId)) {
      this.activePersonaId = this.personas[0]?.id || 'p1';
    }
  },

  /**
   * Persist all mutable state to storage.
   */
  save() {
    Storage.set(CONSTANTS.STORAGE_KEYS.PERSONAS, this.personas);
    Storage.set(CONSTANTS.STORAGE_KEYS.ACTIVE_PERSONA, this.activePersonaId);
    Storage.set(CONSTANTS.STORAGE_KEYS.CHARACTERS, this.characters);
    Storage.set(CONSTANTS.STORAGE_KEYS.CHATS, this.chats);
    Storage.set(CONSTANTS.STORAGE_KEYS.SIDEBAR, this.sidebarOpen);
    Storage.set(CONSTANTS.STORAGE_KEYS.ENDPOINT, this.endpoint);
    Storage.set(CONSTANTS.STORAGE_KEYS.SELECTED_MODEL, this.selectedModel);
  },

  /**
   * Get the currently active persona object.
   */
  getActivePersona() {
    return this.personas.find(p => p.id === this.activePersonaId) || this.personas[0] || { name: 'User', pronouns: 'they/them', avatar: '', desc: '' };
  },

  /**
   * Get the character associated with the active chat.
   */
  getActiveCharacter() {
    const chat = this.chats.find(c => c.id === this.activeChatId);
    if (!chat) return null;
    return this.characters.find(c => c.id === chat.charId) || null;
  },

  /**
   * Get the active chat object.
   */
  getActiveChat() {
    return this.chats.find(c => c.id === this.activeChatId) || null;
  },

  /**
   * Reset generation state safely.
   */
  resetGeneration() {
    this.isGenerating = false;
    this.abortController = null;
  }
};

// ─── Security Utilities ──────────────────────────────────────────────────────
const Security = {
  /**
   * Escape HTML entities to prevent XSS.
   */
  escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Sanitize a URL to prevent javascript: protocol injection.
   */
  sanitizeUrl(url) {
    if (!url) return '';
    const parsed = url.trim().toLowerCase();
    if (parsed.startsWith('javascript:') || parsed.startsWith('data:text/html')) {
      return '';
    }
    return url;
  },

  /**
   * Validate that a string is a safe HTTP(S) endpoint URL.
   */
  isValidEndpoint(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  },

  /**
   * Generate a cryptographically-random ID (fallback to Date-based).
   */
  generateId(prefix = 'id') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
};

// ─── Template Engine ─────────────────────────────────────────────────────────
const Templates = {
  /**
   * Replace dynamic tags in text with persona/character values.
   */
  process(text, charName) {
    if (!text) return '';
    const persona = AppState.getActivePersona();
    return text
      .replace(/\{\{char\}\}/gi, charName)
      .replace(/\{\{user\}\}/gi, persona.name)
      .replace(/\{\{user_pronouns\}\}/gi, persona.pronouns || 'they/them');
  },

  /**
   * Validate dynamic tags and return status info.
   */
  validate(text) {
    if (!text) return { valid: [], invalid: [] };
    const matches = text.match(/\{\{[^}]+\}\}/g) || [];
    const valid = [];
    const invalid = [];
    const seen = new Set();

    matches.forEach(m => {
      const lower = m.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      if (CONSTANTS.VALID_TAGS.includes(lower)) {
        valid.push(m);
      } else {
        invalid.push(m);
      }
    });

    return { valid, invalid };
  }
};

// ─── DOM Utilities ───────────────────────────────────────────────────────────
const DOM = {
  $(selector, parent = document) {
    return parent.querySelector(selector);
  },

  $$(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
  },

  on(element, event, handler, options = {}) {
    if (!element) return () => {};
    element.addEventListener(event, handler, options);
    return () => element.removeEventListener(event, handler);
  },

  toggleClass(element, className, force) {
    if (!element) return;
    element.classList.toggle(className, force);
  },

  show(element) {
    if (element) element.classList.remove('hidden');
  },

  hide(element) {
    if (element) element.classList.add('hidden');
  }
};
