/**
 * Roleo - AI Roleplay Studio
 * Main application orchestrator.
 */

// ─── Chat Operations ─────────────────────────────────────────────────────────
const Chat = {
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
    AppState.editingMsgId = null;
    AppState.save();
    UI.renderRecentChats();
    UI.renderActiveChat();
  },

  async sendMessage() {
    // Stop button behavior when generating
    if (AppState.isGenerating) {
      AppState.abortController?.abort();
      AppState.resetGeneration();
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
    if (!char) return;

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

  async regenerate(msgId) {
    if (AppState.isGenerating || !AppState.selectedModel) return;

    const chat = AppState.getActiveChat();
    if (!chat) return;

    const msgIndex = chat.messages.findIndex(m => m.id === msgId);
    if (msgIndex <= 0 || msgIndex !== chat.messages.length - 1) return;

    const char = AppState.getActiveCharacter();
    if (!char) return;
    await API.regenerateResponse(chat, char, msgIndex, () => UI.renderMessages());
  },

  switchVariant(msgId, step) {
    const chat = AppState.getActiveChat();
    if (!chat) return;
    const msg = chat.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.activeVariant = Math.max(0, Math.min(msg.variants.length - 1, msg.activeVariant + step));
    AppState.save();
    UI.renderMessages();
  },

  deleteMessage(msgId) {
    const chat = AppState.getActiveChat();
    if (!chat) return;
    const index = chat.messages.findIndex(m => m.id === msgId);
    if (index === 0) return; // Protect greeting
    chat.messages = chat.messages.filter(m => m.id !== msgId);
    AppState.save();
    UI.renderMessages();
  },

  rewindTo(msgId) {
    const chat = AppState.getActiveChat();
    if (!chat) return;
    const msgIndex = chat.messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) return;
    chat.messages = chat.messages.slice(0, msgIndex + 1);
    AppState.save();
    UI.renderMessages();
  },

  startEdit(msgId) {
    AppState.editingMsgId = msgId;
    UI.renderMessages();
  },

  async copyMessage(text) {
    try {
      await navigator.clipboard.writeText(text);
      Toast.success('Copied to clipboard.');
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
      Toast.error('Clipboard access denied by the browser.');
    }
  },

  async enhanceMessage() {
    if (AppState.isGenerating) {
      Toast.warn('Please wait for the current generation to finish.');
      return;
    }
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
      if (err.name !== 'AbortError') input.value = originalText;
    } finally {
      input.disabled = false;
      UI.setGeneratingState(false);
      UI.adjustInputHeight();
      UI.updateEnhanceButtonState();
    }
  },

  async createMessageWithAI() {
    if (AppState.isGenerating) {
      Toast.warn('Please wait for the current generation to finish.');
      return;
    }
    if (!AppState.selectedModel) return;

    const chat = AppState.getActiveChat();
    if (!chat) return;
    const char = AppState.getActiveCharacter();
    if (!char) return;

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

    // Inline validation with helpful messages
    const missing = [];
    if (!name) missing.push('Name');
    if (!tagline) missing.push('Tagline');
    if (!description) missing.push('Description');
    if (!firstMsg) missing.push('Greeting');

    if (missing.length > 0) {
      errorBox.textContent = `Please fill out: ${missing.join(', ')}.`;
      DOM.show(errorBox);
      // Focus the first missing field
      if (!name) DOM.$('#input-char-name').focus();
      else if (!tagline) DOM.$('#input-char-tagline').focus();
      else if (!description) DOM.$('#input-char-desc').focus();
      else DOM.$('#input-char-firstmsg').focus();
      return;
    }

    DOM.hide(errorBox);

    const data = { name, tagline, avatar: AppState.tempCharAvatar, description, firstMsg, dialogues };

    if (AppState.editingCharId) {
      const idx = AppState.characters.findIndex(c => c.id === AppState.editingCharId);
      if (idx !== -1) AppState.characters[idx] = { ...AppState.characters[idx], ...data };
    } else {
      const newChar = { id: Security.generateId('c'), ...data };
      AppState.characters.push(newChar);
      this.createNew(newChar.id);
    }

    AppState.save();
    UI.renderCharacters();
    UI.renderActiveChat();
    Modals.close('char-modal');
    Toast.success(AppState.editingCharId ? 'Character updated.' : 'Character created.');
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
    Toast.success('Character deleted.');
  },

  exportCharacter() {
    const char = AppState.getActiveCharacter();
    if (!char) { Toast.error('No active character to export.'); return; }

    const data = {
      _roleo_export: 1,
      _version: 1,
      name: char.name,
      tagline: char.tagline || '',
      avatar: char.avatar || '',
      description: char.description || '',
      firstMsg: char.firstMsg || '',
      dialogues: char.dialogues || ''
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${char.name.replace(/[^\w.-]+/g, '_') || 'character'}.roleo.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    Toast.success('Character exported.');
  },

  importCharacter(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !data.name || !data.firstMsg) throw new Error('Missing required fields.');

        const newChar = {
          id: Security.generateId('c'),
          name: String(data.name),
          tagline: String(data.tagline || ''),
          avatar: typeof data.avatar === 'string' ? data.avatar : '',
          description: String(data.description || ''),
          firstMsg: String(data.firstMsg),
          dialogues: String(data.dialogues || '')
        };
        AppState.characters.push(newChar);
        AppState.save();
        UI.renderCharacters();
        Toast.success(`Imported "${newChar.name}".`);
      } catch (err) {
        Toast.error('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  },

  exportChat() {
    const chat = AppState.getActiveChat();
    const char = AppState.getActiveCharacter();
    if (!chat || !char) { Toast.error('No active chat to export.'); return; }

    const lines = [`# ${chat.title || 'Chat'}`, `Character: ${char.name}`, `Date: ${new Date().toLocaleString()}`, ''];
    chat.messages.forEach(m => {
      const text = m.variants[m.activeVariant] || '';
      const name = m.sender === 'user' ? AppState.getActivePersona().name : char.name;
      lines.push(`**${name}:** ${text}`);
      lines.push('');
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(chat.title || 'chat').replace(/[^\w.-]+/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    Toast.success('Chat exported as Markdown.');
  },

  // ─── Persona CRUD ──────────────────────────────────────────────────────────

  savePersona() {
    const name = DOM.$('#input-persona-name').value.trim();
    if (!name) { Toast.warn('Please give your persona a name.'); return; }

    const data = {
      name,
      pronouns: DOM.$('#input-persona-pronouns').value.trim(),
      avatar: AppState.tempPersonaAvatar,
      desc: DOM.$('#input-persona-desc').value.trim()
    };

    if (AppState.editingPersonaId) {
      const idx = AppState.personas.findIndex(p => p.id === AppState.editingPersonaId);
      if (idx !== -1) AppState.personas[idx] = { ...AppState.personas[idx], ...data };
    } else {
      const newPersona = { id: Security.generateId('p'), ...data };
      AppState.personas.push(newPersona);
      AppState.activePersonaId = newPersona.id;
    }

    AppState.save();
    UI.renderPersonas();
    Modals.close('persona-modal');
    Toast.success('Persona saved.');
  },

  deleteActivePersona() {
    if (AppState.personas.length <= 1) {
      Toast.warn('You must have at least one persona.');
      return;
    }
    if (!confirm('Are you sure you want to delete this persona?')) return;

    AppState.personas = AppState.personas.filter(p => p.id !== AppState.activePersonaId);
    AppState.activePersonaId = AppState.personas[0].id;
    AppState.save();
    UI.renderPersonas();
    Toast.success('Persona deleted.');
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

// ─── Global helpers (for inline onclick handlers) ────────────────────────────
function switchRightTab(tabName) { UI.switchRightTab(tabName); }

function insertTagInto(elementId, tagText) {
  const el = DOM.$(`#${elementId}`);
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
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
  UI.fetchAndRenderModels({ silent: true }); // no error toast on first load
  UI.renderPersonas();
  UI.renderCharacters();
  UI.switchRightTab('recents');
  UI.renderActiveChat();
});
