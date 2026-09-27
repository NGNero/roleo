/**
 * Roleo - AI Roleplay Studio
 * Main application orchestrator. Imports modules and wires everything together.
 */

// ─── Chat Operations ─────────────────────────────────────────────────────────
const Chat = {
  /**
   * Create a new chat session for a character.
   */
  createNew(charId) {
    const char = AppState.characters.find(c => c.id === charId);
    if (!char) return;

    const newChat = {
      id: Security.generateId('chat'),
      charId: char.id,
      title: `Chat with ${char.name}`,
      messages: []
    };

    if (char.firstMsg) {
      newChat.messages.push({
        id: Security.generateId('msg'),
        sender: 'assistant',
        variants: [Templates.process(char.firstMsg, char.name)],
        activeVariant: 0
      });
    }

    AppState.chats.push(newChat);
    AppState.activeChatId = newChat.id;
    AppState.save();
    UI.renderRecentChats();
    UI.renderActiveChat();
  },

  /**
   * Send a user message and trigger AI response.
   */
  async sendMessage() {
    if (AppState.isGenerating) {
      if (AppState.abortController) {
        AppState.abortController.abort();
        AppState.abortController = null;
      }
      UI.setGeneratingState(false);
      return;
    }

    if (!AppState.selectedModel) return;

    const input = DOM.$('#message-input');
    const text = input.value.trim();
    if (!text) return;

    const chat = AppState.getActiveChat();
    if (!chat) return;

    const char = AppState.getActiveCharacter();

    // Add user message
    chat.messages.push({
      id: Security.generateId('msg'),
      sender: 'user',
      variants: [text],
      activeVariant: 0,
      image: AppState.attachedImage
    });

    input.value = '';
    UI.adjustInputHeight();
    UI.updateEnhanceButtonState();
    UI.clearImagePreview();
    UI.renderMessages();

    await API.generateResponse(chat, char, () => UI.renderMessages());
  },

  /**
   * Regenerate the last AI message.
   */
  async regenerate(msgId) {
    if (AppState.isGenerating || !AppState.selectedModel) return;

    const chat = AppState.getActiveChat();
    if (!chat) return;

    const msgIndex = chat.messages.findIndex(m => m.id === msgId);
    if (msgIndex <= 0 || msgIndex !== chat.messages.length - 1) return;

    const char = AppState.getActiveCharacter();
    await API.regenerateResponse(chat, char, msgIndex, () => UI.renderMessages());
  },

  /**
   * Switch between message variants.
   */
  switchVariant(msgId, step) {
    const chat = AppState.getActiveChat();
    if (!chat) return;
    const msg = chat.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.activeVariant = Math.max(0, Math.min(msg.variants.length - 1, msg.activeVariant + step));
    AppState.save();
    UI.renderMessages();
  },

  /**
   * Delete a message from the chat.
   */
  deleteMessage(msgId) {
    const chat = AppState.getActiveChat();
    if (!chat) return;

    const index = chat.messages.findIndex(m => m.id === msgId);
    if (index === 0) return; // Protect greeting

    chat.messages = chat.messages.filter(m => m.id !== msgId);
    AppState.save();
    UI.renderMessages();
  },

  /**
   * Rewind chat to a specific message (truncate after it).
   */
  rewindTo(msgId) {
    const chat = AppState.getActiveChat();
    if (!chat) return;

    const msgIndex = chat.messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) return;

    chat.messages = chat.messages.slice(0, msgIndex + 1);
    AppState.save();
    UI.renderMessages();
  },

  /**
   * Start inline editing of a message.
   */
  startEdit(msgId) {
    AppState.editingMsgId = msgId;
    UI.renderMessages();
  },

  /**
   * Copy message text to clipboard.
   */
  async copyMessage(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  },

  /**
   * Enhance the current user message with AI.
   */
  async enhanceMessage() {
    const input = DOM.$('#message-input');
    const text = input.value.trim();
    if (!text || !AppState.selectedModel) return;

    const originalText = input.value;
    input.value = '';
    input.disabled = true;
    UI.setGeneratingState(true);

    try {
      await API.enhanceMessage(text, (delta) => {
        input.value += delta;
        UI.adjustInputHeight();
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        input.value = originalText;
      }
    } finally {
      input.disabled = false;
      UI.setGeneratingState(false);
      UI.adjustInputHeight();
      UI.updateEnhanceButtonState();
    }
  },

  /**
   * Have AI write a message on behalf of the user.
   */
  async createMessageWithAI() {
    if (!AppState.selectedModel) return;

    const chat = AppState.getActiveChat();
    if (!chat) return;

    const char = AppState.getActiveCharacter();
    const input = DOM.$('#message-input');

    input.value = '';
    input.disabled = true;
    UI.setGeneratingState(true);

    try {
      await API.createUserMessage(chat, char, (delta) => {
        input.value += delta;
        UI.adjustInputHeight();
      });
    } catch (err) {
      if (err.name !== 'AbortError') input.value = '';
    } finally {
      input.disabled = false;
      UI.setGeneratingState(false);
      UI.adjustInputHeight();
      UI.updateEnhanceButtonState();
    }
  },

  // ─── Character CRUD ────────────────────────────────────────────────────────

  saveCharacter() {
    const name = DOM.$('#input-char-name').value.trim();
    const tagline = DOM.$('#input-char-tagline').value.trim();
    const description = DOM.$('#input-char-desc').value.trim();
    const firstMsg = DOM.$('#input-char-firstmsg').value.trim();
    const dialogues = DOM.$('#input-char-dialogues').value.trim();

    const errorBox = DOM.$('#char-modal-error');

    if (!name || !tagline || !description || !firstMsg) {
      errorBox.textContent = 'Please fill out all required fields (Name, Tagline, Description, and First Message Greeting).';
      DOM.show(errorBox);
      return;
    }

    DOM.hide(errorBox);

    const data = {
      name,
      tagline,
      avatar: AppState.tempCharAvatar,
      description,
      firstMsg,
      dialogues
    };

    if (AppState.editingCharId) {
      const idx = AppState.characters.findIndex(c => c.id === AppState.editingCharId);
      if (idx !== -1) {
        AppState.characters[idx] = { ...AppState.characters[idx], ...data };
      }
    } else {
      const newChar = { id: Security.generateId('c'), ...data };
      AppState.characters.push(newChar);
      this.createNew(newChar.id);
    }

    AppState.save();
    UI.renderCharacters();
    UI.renderActiveChat();
    DOM.hide(DOM.$('#char-modal'));
  },

  deleteCharacter(charId) {
    if (!confirm('Are you sure you want to delete this character and all its chats?')) return;

    AppState.characters = AppState.characters.filter(c => c.id !== charId);
    AppState.chats = AppState.chats.filter(c => c.charId !== charId);

    if (AppState.activeChatId && !AppState.chats.some(c => c.id === AppState.activeChatId)) {
      AppState.activeChatId = null;
    }

    AppState.save();
    UI.renderCharacters();
    UI.renderActiveChat();
  },

  // ─── Persona CRUD ──────────────────────────────────────────────────────────

  savePersona() {
    const name = DOM.$('#input-persona-name').value.trim();
    if (!name) return;

    const data = {
      name,
      pronouns: DOM.$('#input-persona-pronouns').value.trim(),
      avatar: AppState.tempPersonaAvatar,
      desc: DOM.$('#input-persona-desc').value.trim()
    };

    if (AppState.editingPersonaId) {
      const idx = AppState.personas.findIndex(p => p.id === AppState.editingPersonaId);
      if (idx !== -1) {
        AppState.personas[idx] = { ...AppState.personas[idx], ...data };
      }
    } else {
      const newPersona = { id: Security.generateId('p'), ...data };
      AppState.personas.push(newPersona);
      AppState.activePersonaId = newPersona.id;
    }

    AppState.save();
    UI.renderPersonas();
    DOM.hide(DOM.$('#persona-modal'));
  },

  deleteActivePersona() {
    if (AppState.personas.length <= 1) {
      alert('You must have at least one persona.');
      return;
    }
    if (!confirm('Are you sure you want to delete this persona?')) return;

    AppState.personas = AppState.personas.filter(p => p.id !== AppState.activePersonaId);
    AppState.activePersonaId = AppState.personas[0].id;
    AppState.save();
    UI.renderPersonas();
  },

  // ─── Chat Session Management ───────────────────────────────────────────────

  deleteChat(chatId) {
    const deletedChat = AppState.chats.find(c => c.id === chatId);
    AppState.chats = AppState.chats.filter(c => c.id !== chatId);

    if (AppState.activeChatId === chatId) {
      const remaining = AppState.chats.filter(c => c.charId === deletedChat?.charId);
      AppState.activeChatId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }

    AppState.save();
    UI.renderRecentChats();
    UI.renderActiveChat();
  }
};

// ─── Global Helpers (for inline onclick handlers in HTML) ────────────────────
function switchRightTab(tabName) { UI.switchRightTab(tabName); }
function insertTagInto(elementId, tagText) {
  const el = DOM.$(`#${elementId}`);
  if (!el) return;
  const start = el.selectionStart || el.value.length;
  const end = el.selectionEnd || el.value.length;
  el.value = el.value.substring(0, start) + tagText + el.value.substring(end);
  el.selectionStart = el.selectionEnd = start + tagText.length;
  el.focus();
  if (elementId === 'input-char-desc') UI.updateTagBadges(el.value, 'tag-badge-desc');
  if (elementId === 'input-char-firstmsg') UI.updateTagBadges(el.value, 'tag-badge-firstmsg');
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  AppState.load();
  UI.init();
  UI.fetchAndRenderModels();
  UI.renderPersonas();
  UI.renderCharacters();
  UI.switchRightTab('recents');
  UI.renderActiveChat();
});