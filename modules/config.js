/**
 * Roleo - Configuration & State Module
 * Centralized state management, constants, and utilities.
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const CONSTANTS = {
  DEFAULT_AVATAR: 'icons/avatar-placeholder.svg',
  DEFAULT_ENDPOINT: 'http://localhost:1234/v1',
  FETCH_TIMEOUT_MS: 10000,
  STORAGE_KEYS: {
    PERSONAS: 'roleo_personas',
    ACTIVE_PERSONA: 'roleo_active_persona',
    CHARACTERS: 'roleo_characters',
    CHATS: 'roleo_chats',
    SIDEBAR: 'roleo_sidebar_open',
    ENDPOINT: 'roleo_endpoint',
    SELECTED_MODEL: 'roleo_selected_model',
    TEMPERATURE: 'roleo_temperature'
  },
  NON_TEXT_KEYWORDS: ['embed', 'bge', 'rerank', 'clip', 'whisper', 'tts', 'stt', 'bert', 'vision-only'],
  VALID_TAGS: ['{{char}}', '{{user}}', '{{user_pronouns}}']
};

// ─── Secure Storage ──────────────────────────────────────────────────────────
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
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('Storage save failed:', e); }
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

  // Generation
  isGenerating: false,
  abortController: null,

  // Connection
  connectionStatus: 'unknown', // 'unknown' | 'ok' | 'error'
  connectionError: null,

  // Temp
  tempCharAvatar: '',
  tempPersonaAvatar: '',
  attachedImage: null,

  // API config
  endpoint: CONSTANTS.DEFAULT_ENDPOINT,
  temperature: 0.7,

  // Render bookkeeping
  _lastRenderedChatId: null,

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
    this.temperature = Storage.get(CONSTANTS.STORAGE_KEYS.TEMPERATURE, 0.7);

    if (!this.personas.find(p => p.id === this.activePersonaId)) {
      this.activePersonaId = this.personas[0]?.id || 'p1';
    }
  },

  save() {
    Storage.set(CONSTANTS.STORAGE_KEYS.PERSONAS, this.personas);
    Storage.set(CONSTANTS.STORAGE_KEYS.ACTIVE_PERSONA, this.activePersonaId);
    Storage.set(CONSTANTS.STORAGE_KEYS.CHARACTERS, this.characters);
    Storage.set(CONSTANTS.STORAGE_KEYS.CHATS, this.chats);
    Storage.set(CONSTANTS.STORAGE_KEYS.SIDEBAR, this.sidebarOpen);
    Storage.set(CONSTANTS.STORAGE_KEYS.ENDPOINT, this.endpoint);
    Storage.set(CONSTANTS.STORAGE_KEYS.SELECTED_MODEL, this.selectedModel);
    Storage.set(CONSTANTS.STORAGE_KEYS.TEMPERATURE, this.temperature);
  },

  getActivePersona() {
    return this.personas.find(p => p.id === this.activePersonaId)
      || this.personas[0]
      || { name: 'User', pronouns: 'they/them', avatar: '', desc: '' };
  },

  getActiveCharacter() {
    const chat = this.chats.find(c => c.id === this.activeChatId);
    if (!chat) return null;
    return this.characters.find(c => c.id === chat.charId) || null;
  },

  getActiveChat() {
    return this.chats.find(c => c.id === this.activeChatId) || null;
  },

  resetGeneration() {
    this.isGenerating = false;
    this.abortController = null;
  }
};

// ─── Security ────────────────────────────────────────────────────────────────
const Security = {
  escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const parsed = url.trim().toLowerCase();
    if (parsed.startsWith('javascript:') || parsed.startsWith('data:text/html')) return '';
    return url;
  },

  isValidEndpoint(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
  },

  generateId(prefix = 'id') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
};

// ─── Template Engine ─────────────────────────────────────────────────────────
const Templates = {
  process(text, charName) {
    if (!text) return '';
    const persona = AppState.getActivePersona();
    return text
      .replace(/\{\{char\}\}/gi, charName)
      .replace(/\{\{user\}\}/gi, persona.name)
      .replace(/\{\{user_pronouns\}\}/gi, persona.pronouns || 'they/them');
  },

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
      if (CONSTANTS.VALID_TAGS.includes(lower)) valid.push(m);
      else invalid.push(m);
    });

    return { valid, invalid };
  }
};

// ─── DOM Utilities ───────────────────────────────────────────────────────────
const DOM = {
  $(selector, parent = document) { return parent.querySelector(selector); },
  $$(selector, parent = document) { return Array.from(parent.querySelectorAll(selector)); },
  show(element) { if (element) element.classList.remove('hidden'); },
  hide(element) { if (element) element.classList.add('hidden'); }
};

// ─── Modal Helpers (native <dialog>) ────────────────────────────────────────
const Modals = {
  open(id) {
    const d = document.getElementById(id);
    if (!d || d.open) return;
    d.showModal();
  },
  close(id) {
    const d = document.getElementById(id);
    if (!d || !d.open) return;
    d.close();
  },
  closeAll() {
    document.querySelectorAll('dialog.modal[open]').forEach(d => d.close());
  }
};

// ─── Toast Notifications ─────────────────────────────────────────────────────
const Toast = {
  show(message, type = 'info', duration = 4500) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none';
      document.body.appendChild(container);
    }

    const palette = {
      info:    'bg-[#18181b] border-[#27272a] text-zinc-200',
      success: 'bg-emerald-950/90 border-emerald-800/60 text-emerald-200',
      error:   'bg-red-950/90 border-red-800/60 text-red-200',
      warn:    'bg-amber-950/90 border-amber-800/60 text-amber-200'
    };
    const toast = document.createElement('div');
    toast.className = `toast-item pointer-events-auto px-3.5 py-2.5 rounded-xl border text-xs shadow-2xl backdrop-blur-sm max-w-sm break-words ${palette[type] || palette.info}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'opacity .2s ease, transform .2s ease';
      setTimeout(() => toast.remove(), 240);
    }, duration);
  },

  info(m, d)    { this.show(m, 'info', d); },
  success(m, d) { this.show(m, 'success', d); },
  error(m, d)   { this.show(m, 'error', d ?? 6500); },
  warn(m, d)    { this.show(m, 'warn', d); }
};
