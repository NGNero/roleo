/**
 * Roleo - UI Module
 * All DOM rendering, event binding, and UI state management.
 */

const UI = {
  // ─── Init ──────────────────────────────────────────────────────────────────
  init() {
    this.bindEvents();
    this.applySidebarState();
    this.checkModelLoadedState();
    this.updateEnhanceButtonState();
    this.renderTemperatureUI();

    const endpointInput = DOM.$('#endpoint-input');
    if (endpointInput && AppState.endpoint) endpointInput.value = AppState.endpoint;
  },

  // ─── Sidebar ───────────────────────────────────────────────────────────────
  toggleSidebar() {
    AppState.sidebarOpen = !AppState.sidebarOpen;
    this.applySidebarState();
    AppState.save();
  },

  applySidebarState() {
    const sidebar = DOM.$('#left-sidebar');
    const expandBtn = DOM.$('#btn-expand-sidebar');
    if (!sidebar) return;

    if (AppState.sidebarOpen) {
      sidebar.classList.remove('hidden');
      expandBtn?.classList.add('hidden');
    } else {
      sidebar.classList.add('hidden');
      expandBtn?.classList.remove('hidden');
    }
  },

  // ─── Models ────────────────────────────────────────────────────────────────
  async fetchAndRenderModels({ silent = false } = {}) {
    const select = DOM.$('#model-select');
    if (!select) return;

    select.innerHTML = '<option value="">Loading models...</option>';
    AppState.models = await API.fetchModels();

    select.innerHTML = '';

    if (AppState.models.length === 0) {
      select.innerHTML = '<option value="">No models found / Offline</option>';
      AppState.selectedModel = '';
      AppState.connectionStatus = 'error';
      AppState.connectionError = API.lastError || { message: 'No models returned.', hint: '' };

      if (API.lastError && !silent) {
        Toast.error(`${API.lastError.message}${API.lastError.hint ? ' — ' + API.lastError.hint : ''}`);
      }
    } else {
      AppState.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        if (m.id === AppState.selectedModel) opt.selected = true;
        select.appendChild(opt);
      });
      if (!AppState.selectedModel || !AppState.models.find(m => m.id === AppState.selectedModel)) {
        AppState.selectedModel = AppState.models[0].id;
      }
      AppState.connectionStatus = 'ok';
      AppState.connectionError = null;
    }

    this.checkModelLoadedState();
    this.renderConnectionStatus();
    AppState.save();
  },

  renderConnectionStatus() {
    const box = DOM.$('#model-status');
    if (!box) return;

    if (AppState.connectionStatus === 'unknown') { DOM.hide(box); return; }
    DOM.show(box);

    if (AppState.connectionStatus === 'ok') {
      box.className = 'text-[11px] p-2.5 rounded-xl border border-emerald-800/50 bg-emerald-950/30 text-emerald-300';
      box.textContent = `✓ Connected — ${AppState.models.length} model${AppState.models.length === 1 ? '' : 's'} available.`;
      return;
    }

    const err = AppState.connectionError;
    box.className = 'text-[11px] p-2.5 rounded-xl border border-red-800/50 bg-red-950/30 text-red-300 space-y-1';
    box.innerHTML = '';

    const line1 = document.createElement('div');
    line1.className = 'font-semibold';
    line1.textContent = '✕ ' + (err?.message || 'Connection failed.');
    box.appendChild(line1);

    if (err?.hint) {
      const line2 = document.createElement('div');
      line2.className = 'text-[10px] text-red-200/80 leading-snug';
      line2.textContent = err.hint;
      box.appendChild(line2);
    }
  },

  checkModelLoadedState() {
    const isLoaded = !!AppState.selectedModel;
    const msgInput = DOM.$('#message-input');
    const sendBtn = DOM.$('#btn-send-message');
    const plusBtn = DOM.$('#btn-plus-actions');
    const warning = DOM.$('#model-warning-text');

    if (msgInput) {
      msgInput.disabled = !isLoaded;
      msgInput.placeholder = isLoaded ? 'Message...' : 'Select a loaded model to start chatting...';
    }
    if (sendBtn) sendBtn.disabled = !isLoaded && !AppState.isGenerating;
    if (plusBtn) plusBtn.disabled = !isLoaded;
    if (warning) warning.classList.toggle('hidden', isLoaded);
  },

  // ─── Temperature ───────────────────────────────────────────────────────────
  renderTemperatureUI() {
    const slider = DOM.$('#temperature-slider');
    const label = DOM.$('#temperature-value');
    if (!slider || !label) return;
    slider.value = String(AppState.temperature);
    label.textContent = Number(AppState.temperature).toFixed(2);
  },

  // ─── Character List ────────────────────────────────────────────────────────
  renderCharacters() {
    const list = DOM.$('#character-list');
    if (!list) return;

    const filter = DOM.$('#search-input')?.value.toLowerCase() || '';
    list.innerHTML = '';

    const filtered = AppState.characters.filter(c =>
      c.name.toLowerCase().includes(filter) ||
      (c.tagline && c.tagline.toLowerCase().includes(filter))
    );

    if (filtered.length === 0) {
      list.innerHTML = `<p class="text-xs text-zinc-500 px-2 py-4 text-center">${
        AppState.characters.length === 0 ? 'No characters yet. Click “+ Char”.' : 'No matches.'
      }</p>`;
      return;
    }

    filtered.forEach(c => {
      const el = document.createElement('div');
      el.className = 'flex items-center space-x-3 p-2 rounded-xl hover:bg-[#202023] cursor-pointer transition group relative';
      el.onclick = () => Chat.createNew(c.id);

      const avatar = document.createElement('img');
      avatar.src = Security.sanitizeUrl(c.avatar) || CONSTANTS.DEFAULT_AVATAR;
      avatar.alt = Security.escapeHtml(c.name);
      avatar.className = 'w-8 h-8 rounded-full border border-[#27272a] object-cover shrink-0';
      avatar.onerror = () => { avatar.src = CONSTANTS.DEFAULT_AVATAR; };

      const textWrapper = document.createElement('div');
      textWrapper.className = 'overflow-hidden flex-1 pr-6';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'text-zinc-200 text-xs font-semibold truncate group-hover:text-white';
      nameDiv.textContent = c.name;

      const taglineDiv = document.createElement('div');
      taglineDiv.className = 'text-[10px] text-zinc-500 truncate';
      taglineDiv.textContent = c.tagline || 'No tagline';

      textWrapper.appendChild(nameDiv);
      textWrapper.appendChild(taglineDiv);

      const delBtn = document.createElement('button');
      delBtn.className = 'opacity-0 group-hover:opacity-100 absolute right-2 text-zinc-500 hover:text-red-400 p-1 transition';
      delBtn.title = 'Delete Character';
      delBtn.ariaLabel = 'Delete Character';
      delBtn.textContent = '✕';
      delBtn.onclick = (e) => { e.stopPropagation(); Chat.deleteCharacter(c.id); };

      el.appendChild(avatar);
      el.appendChild(textWrapper);
      el.appendChild(delBtn);
      list.appendChild(el);
    });
  },

  // ─── Chat View ─────────────────────────────────────────────────────────────
  renderActiveChat() {
    const emptyState = DOM.$('#empty-state');
    const chatView = DOM.$('#chat-view');
    const headerName = DOM.$('#header-char-name');

    if (!AppState.activeChatId) {
      DOM.show(emptyState);
      DOM.hide(chatView);
      if (headerName) headerName.textContent = 'Roleo';
      this.renderRightSidebar(null);
      return;
    }

    const chat = AppState.getActiveChat();
    const char = AppState.getActiveCharacter();

    if (!chat || !char) {
      AppState.activeChatId = null;
      this.renderActiveChat();
      return;
    }

    // Clear stale edit state when switching chats
    if (AppState._lastRenderedChatId !== chat.id) {
      AppState.editingMsgId = null;
    }

    if (headerName) headerName.textContent = char.name;
    DOM.hide(emptyState);
    DOM.show(chatView);

    this.renderRightSidebar(char);
    this.renderMessages();
  },

  renderMessages() {
    const container = DOM.$('#messages-container');
    if (!container) return;

    const chat = AppState.getActiveChat();
    if (!chat) { container.innerHTML = ''; return; }

    // Scroll bookkeeping
    const wasNearBottom =
      (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
    const isNewChat = AppState._lastRenderedChatId !== chat.id;

    container.innerHTML = '';

    const char = AppState.getActiveCharacter();
    const persona = AppState.getActivePersona();

    // Header card
    const headerCard = document.createElement('div');
    headerCard.className = 'flex flex-col items-center text-center my-6 space-y-2';

    const headerImg = document.createElement('img');
    headerImg.src = Security.sanitizeUrl(char.avatar) || CONSTANTS.DEFAULT_AVATAR;
    headerImg.alt = Security.escapeHtml(char.name);
    headerImg.className = 'w-20 h-20 rounded-full border-2 border-[#27272a] object-cover shadow-lg';
    headerImg.onerror = () => { headerImg.src = CONSTANTS.DEFAULT_AVATAR; };

    const headerTitle = document.createElement('h2');
    headerTitle.className = 'text-white font-bold text-lg tracking-tight';
    headerTitle.textContent = char.name;

    const headerTagline = document.createElement('p');
    headerTagline.className = 'text-xs text-zinc-400 max-w-md line-clamp-2';
    headerTagline.textContent = char.tagline || '';

    headerCard.append(headerImg, headerTitle, headerTagline);
    container.appendChild(headerCard);

    // Messages
    chat.messages.forEach((msg, index) => {
      const isUser = msg.sender === 'user';
      const currentText = msg.variants[msg.activeVariant] || '';
      const isLastMessage = index === chat.messages.length - 1;
      const isGreeting = index === 0;
      const isEditing = AppState.editingMsgId === msg.id;

      const msgDiv = document.createElement('div');
      msgDiv.className = `group flex space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : 'flex-row'}`;

      const avatarUrl = isUser ? persona.avatar : char.avatar;
      const senderName = isUser ? persona.name : char.name;

      const avatarImg = document.createElement('img');
      avatarImg.src = Security.sanitizeUrl(avatarUrl) || CONSTANTS.DEFAULT_AVATAR;
      avatarImg.alt = Security.escapeHtml(senderName);
      avatarImg.className = 'w-8 h-8 rounded-full object-cover border border-[#27272a] shrink-0 mt-1';
      avatarImg.onerror = () => { avatarImg.src = CONSTANTS.DEFAULT_AVATAR; };

      const bodyWrapper = document.createElement('div');
      bodyWrapper.className = `max-w-[85%] space-y-1 ${isUser ? 'items-end flex flex-col' : 'items-start flex flex-col'}`;

      const senderHeader = document.createElement('div');
      senderHeader.className = 'flex items-center space-x-2 text-[11px] text-zinc-500';

      const senderSpan = document.createElement('span');
      senderSpan.className = 'font-medium text-zinc-300';
      senderSpan.textContent = senderName;
      senderHeader.appendChild(senderSpan);

      const msgBox = document.createElement('div');
      msgBox.className = `w-fit max-w-full p-3.5 rounded-2xl ${
        isUser ? 'bg-[#27272a] text-white border-[#3f3f46]' : 'bg-[#1a1a1e] text-zinc-200 border-[#27272a]'
      } border text-sm leading-relaxed shadow-sm markdown-body min-w-[140px] transition-all duration-150 ${
        isEditing ? 'border-indigo-500/50 bg-[#161619]' : ''
      }`;

      if (msg.image) {
        const msgImg = document.createElement('img');
        msgImg.src = Security.sanitizeUrl(msg.image);
        msgImg.alt = 'Attached image';
        msgImg.className = 'max-h-48 rounded-xl mb-2 border border-[#27272a] object-cover';
        msgBox.appendChild(msgImg);
      }

      if (isEditing) {
        this.renderEditMode(msgBox, msg);
      } else {
        const contentDiv = document.createElement('div');
        if (typeof marked !== 'undefined') {
          try {
            const rawHtml = marked.parse(currentText || '', { async: false });
            contentDiv.innerHTML = this.sanitizeHtml(rawHtml);
          } catch {
            contentDiv.textContent = currentText;
          }
        } else {
          contentDiv.textContent = currentText;
        }
        msgBox.appendChild(contentDiv);
      }

      // Action bar
      const actionBar = document.createElement('div');
      actionBar.className = `opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 flex items-center space-x-2 text-xs text-zinc-500 pt-1 ${isUser ? 'justify-end' : 'justify-start'}`;

      const hasMultipleVariants = !isUser && msg.variants.length > 1;

      if (hasMultipleVariants && !isEditing) {
        const variantBox = document.createElement('div');
        variantBox.className = 'flex items-center space-x-1 mr-1 bg-[#202023] px-2 py-0.5 rounded-lg border border-[#27272a]';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'hover:text-white px-0.5 disabled:opacity-30';
        prevBtn.textContent = '❮';
        prevBtn.title = 'Previous variant';
        prevBtn.disabled = msg.activeVariant === 0;
        prevBtn.onclick = () => Chat.switchVariant(msg.id, -1);

        const varSpan = document.createElement('span');
        varSpan.className = 'text-[10px] select-none';
        varSpan.textContent = `${msg.activeVariant + 1}/${msg.variants.length}`;

        const nextBtn = document.createElement('button');
        nextBtn.className = 'hover:text-white px-0.5';
        nextBtn.textContent = '❯';

        if (msg.activeVariant === msg.variants.length - 1) {
          if (isLastMessage) {
            nextBtn.title = 'Regenerate another variant';
            nextBtn.onclick = () => Chat.regenerate(msg.id);
          } else {
            nextBtn.title = 'No further variants';
            nextBtn.disabled = true;
            nextBtn.classList.add('opacity-30');
          }
        } else {
          nextBtn.title = 'Next variant';
          nextBtn.onclick = () => Chat.switchVariant(msg.id, 1);
        }

        variantBox.append(prevBtn, varSpan, nextBtn);
        actionBar.appendChild(variantBox);
      }

      if (!isEditing) {
        actionBar.appendChild(this.createActionBtn('Copy message', 'icon-copy', () => Chat.copyMessage(currentText)));
        actionBar.appendChild(this.createActionBtn('Edit message', 'icon-edit', () => Chat.startEdit(msg.id)));

        if (!isGreeting) {
          actionBar.appendChild(this.createActionBtn('Delete message', 'icon-trash', () => Chat.deleteMessage(msg.id)));
        }
        if (!isLastMessage) {
          actionBar.appendChild(this.createActionBtn('Rewind to here', 'icon-rewind', () => Chat.rewindTo(msg.id)));
        }
        if (!isUser && isLastMessage && !isGreeting && !AppState.isGenerating && !hasMultipleVariants) {
          actionBar.appendChild(this.createActionBtn('Regenerate message', 'icon-refresh', () => Chat.regenerate(msg.id)));
        }
      }

      bodyWrapper.append(senderHeader, msgBox, actionBar);
      msgDiv.append(avatarImg, bodyWrapper);
      container.appendChild(msgDiv);
    });

    if (isNewChat || wasNearBottom) container.scrollTop = container.scrollHeight;
    AppState._lastRenderedChatId = chat.id;
  },

  renderEditMode(container, msg) {
    const editContainer = document.createElement('div');
    editContainer.className = 'space-y-3 w-full min-w-[280px] md:min-w-[360px]';

    const textarea = document.createElement('textarea');
    textarea.className = 'w-full bg-[#111113] text-white border border-[#3f3f46] rounded-xl p-3 text-sm focus:outline-none focus:border-zinc-400 resize-y min-h-[90px] custom-scrollbar leading-relaxed';
    textarea.value = msg.variants[msg.activeVariant];

    const actions = document.createElement('div');
    actions.className = 'flex justify-end space-x-2';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1.5 rounded-lg bg-[#27272a] hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium transition';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => { AppState.editingMsgId = null; this.renderMessages(); };

    const saveBtn = document.createElement('button');
    saveBtn.className = 'px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition shadow-md';
    saveBtn.textContent = 'Save';

    const saveAction = () => {
      const val = textarea.value.trim();
      if (val) {
        msg.variants[msg.activeVariant] = val;
        AppState.save();
      }
      AppState.editingMsgId = null;
      this.renderMessages();
    };
    saveBtn.onclick = saveAction;

    textarea.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveAction(); }
      else if (e.key === 'Escape') { AppState.editingMsgId = null; this.renderMessages(); }
    };

    actions.append(cancelBtn, saveBtn);
    editContainer.append(textarea, actions);
    container.appendChild(editContainer);

    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.value.length;
    }, 0);
  },

  createActionBtn(title, iconClass, onClick) {
    const btn = document.createElement('button');
    btn.className = 'hover:text-white p-1';
    btn.title = title;
    btn.ariaLabel = title;
    btn.onclick = onClick;
    btn.innerHTML = `<span class="icon ${iconClass} w-3 h-3 bg-current block"></span>`;
    return btn;
  },

  sanitizeHtml(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const allowedTags = new Set([
      'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
      'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ]);
    const allowedAttrs = new Set(['href', 'title']);

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      if (!allowedTags.has(tag)) {
        node.parentNode.replaceChild(document.createTextNode(node.textContent), node);
        return;
      }

      Array.from(node.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (!allowedAttrs.has(name)) {
          node.removeAttribute(attr.name);
        } else if (name === 'href') {
          const val = attr.value.trim().toLowerCase();
          if (val.startsWith('javascript:') || val.startsWith('data:text/html')) {
            node.removeAttribute(attr.name);
          } else {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
          }
        }
      });

      Array.from(node.childNodes).forEach(walk);
    };

    Array.from(doc.body.childNodes).forEach(walk);
    return doc.body.innerHTML;
  },

  // ─── Right Sidebar ─────────────────────────────────────────────────────────
  renderRightSidebar(char) {
    const avatarImg = DOM.$('#char-card-avatar');
    const nameEl = DOM.$('#char-card-name');
    const taglineEl = DOM.$('#char-card-tagline');
    if (!avatarImg || !nameEl || !taglineEl) return;

    if (!char) {
      avatarImg.src = CONSTANTS.DEFAULT_AVATAR;
      nameEl.textContent = 'Select Character';
      taglineEl.textContent = 'No character loaded.';
      return;
    }

    avatarImg.src = Security.sanitizeUrl(char.avatar) || CONSTANTS.DEFAULT_AVATAR;
    avatarImg.onerror = () => { avatarImg.src = CONSTANTS.DEFAULT_AVATAR; };
    nameEl.textContent = char.name;
    taglineEl.textContent = char.tagline || 'No tagline set.';

    if (AppState.activeRightTab === 'recents') this.renderRecentChats();
  },

  renderRecentChats() {
    const list = DOM.$('#recent-chats-list');
    if (!list) return;
    list.innerHTML = '';

    const activeChat = AppState.getActiveChat();
    if (!activeChat) {
      list.innerHTML = `<p class="text-xs text-zinc-500 py-2">Select or create a character chat.</p>`;
      return;
    }

    const charChats = AppState.chats.filter(c => c.charId === activeChat.charId);
    if (charChats.length === 0) {
      list.innerHTML = `<p class="text-xs text-zinc-500 py-2">No active chats.</p>`;
      return;
    }

    charChats.forEach(chat => {
      const isActive = chat.id === AppState.activeChatId;
      const el = document.createElement('div');
      el.className = `p-2.5 rounded-xl cursor-pointer text-xs transition flex items-center justify-between border ${isActive ? 'bg-[#202023] text-white border-[#3f3f46]' : 'text-zinc-400 border-transparent hover:bg-[#202023]'}`;
      el.onclick = () => {
        AppState.activeChatId = chat.id;
        AppState._lastRenderedChatId = null;
        this.renderActiveChat();
      };

      const titleSpan = document.createElement('span');
      titleSpan.className = 'truncate font-medium';
      titleSpan.textContent = chat.title || 'Chat Session';

      const delBtn = document.createElement('button');
      delBtn.className = 'text-zinc-500 hover:text-red-400 ml-2 p-0.5';
      delBtn.title = 'Delete Chat';
      delBtn.ariaLabel = 'Delete Chat';
      delBtn.textContent = '✕';
      delBtn.onclick = (e) => { e.stopPropagation(); Chat.deleteChat(chat.id); };

      el.append(titleSpan, delBtn);
      list.appendChild(el);
    });
  },

  // ─── Persona Tab ───────────────────────────────────────────────────────────
  renderPersonas() {
    const select = DOM.$('#persona-select');
    if (!select) return;
    select.innerHTML = '';

    AppState.personas.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name}${p.pronouns ? ` (${p.pronouns})` : ''}`;
      if (p.id === AppState.activePersonaId) opt.selected = true;
      select.appendChild(opt);
    });

    this.renderPersonaTabDetails();
  },

  renderPersonaTabDetails() {
    const card = DOM.$('#persona-details-card');
    if (!card) return;

    const persona = AppState.getActivePersona();
    if (!persona) {
      card.innerHTML = `<p class="text-zinc-500 text-xs">No active persona.</p>`;
      return;
    }

    card.innerHTML = `
      <div class="flex items-center space-x-3">
        <img src="${Security.sanitizeUrl(persona.avatar) || CONSTANTS.DEFAULT_AVATAR}" alt="" class="w-10 h-10 rounded-full object-cover border border-[#27272a]">
        <div class="overflow-hidden">
          <div class="font-bold text-white truncate">${Security.escapeHtml(persona.name)}</div>
          <div class="text-[10px] text-zinc-400">${persona.pronouns ? `Persona • ${Security.escapeHtml(persona.pronouns)}` : 'User Persona'}</div>
        </div>
      </div>
      <p class="text-zinc-300 text-[11px] leading-relaxed pt-1 break-words">${Security.escapeHtml(persona.desc || 'No description provided.')}</p>
    `;
  },

  // ─── Tabs ──────────────────────────────────────────────────────────────────
  switchRightTab(tabName) {
    AppState.activeRightTab = tabName;
    ['recents', 'persona', 'customize', 'model'].forEach(t => {
      const btn = DOM.$(`#tab-btn-${t}`);
      const content = DOM.$(`#tab-content-${t}`);
      if (t === tabName) {
        btn?.classList.add('active');
        DOM.show(content);
      } else {
        btn?.classList.remove('active');
        DOM.hide(content);
      }
    });

    if (tabName === 'recents') this.renderRecentChats();
    if (tabName === 'persona') this.renderPersonaTabDetails();
    if (tabName === 'model') this.renderConnectionStatus();
  },

  // ─── Character Modal ───────────────────────────────────────────────────────
  openCharModal(charId = null) {
    AppState.editingCharId = charId;
    AppState.tempCharAvatar = '';

    const errorBox = DOM.$('#char-modal-error');
    DOM.hide(errorBox);

    const fileInput = DOM.$('#input-char-avatar-file');
    if (fileInput) fileInput.value = '';

    const title = DOM.$('#char-modal-title');
    const saveLabel = DOM.$('#char-save-label');
    const preview = DOM.$('#preview-char-avatar');
    const hint = DOM.$('#char-avatar-hint');

    const fields = {
      name: DOM.$('#input-char-name'),
      tagline: DOM.$('#input-char-tagline'),
      desc: DOM.$('#input-char-desc'),
      firstMsg: DOM.$('#input-char-firstmsg'),
      dialogues: DOM.$('#input-char-dialogues')
    };

    if (charId) {
      const char = AppState.characters.find(c => c.id === charId);
      if (!char) return;

      title.textContent = 'Edit Character';
      saveLabel.textContent = 'Save Changes';
      fields.name.value = char.name || '';
      fields.tagline.value = char.tagline || '';
      fields.desc.value = char.description || '';
      fields.firstMsg.value = char.firstMsg || '';
      fields.dialogues.value = char.dialogues || '';

      this.updateTagBadges(char.description || '', 'tag-badge-desc');
      this.updateTagBadges(char.firstMsg || '', 'tag-badge-firstmsg');

      if (char.avatar) {
        AppState.tempCharAvatar = char.avatar;
        preview.src = char.avatar;
        preview.classList.remove('hidden');
        hint.classList.add('hidden');
      } else {
        preview.classList.add('hidden');
        hint.classList.remove('hidden');
      }
    } else {
      title.textContent = 'Create Character';
      saveLabel.textContent = 'Create Character';
      fields.name.value = '';
      fields.tagline.value = '';
      fields.desc.value = '';
      fields.firstMsg.value = '';
      fields.dialogues.value = '';
      DOM.$('#tag-badge-desc').innerHTML = '';
      DOM.$('#tag-badge-firstmsg').innerHTML = '';
      preview.classList.add('hidden');
      hint.classList.remove('hidden');
    }

    this.updateTaglineCount();
    this.updateCharPreview();
    Modals.open('char-modal');
    setTimeout(() => fields.name.focus(), 50);
  },

  updateTaglineCount() {
    const input = DOM.$('#input-char-tagline');
    const counter = DOM.$('#char-tagline-count');
    if (!input || !counter) return;
    counter.textContent = `${input.value.length}/80`;
  },

  updateCharPreview() {
    const name = DOM.$('#input-char-name')?.value.trim();
    const tagline = DOM.$('#input-char-tagline')?.value.trim();
    const previewName = DOM.$('#char-preview-name');
    const previewTagline = DOM.$('#char-preview-tagline');
    const previewAvatar = DOM.$('#char-preview-avatar');
    const hint = DOM.$('#char-avatar-hint');

    if (previewName) previewName.textContent = name || 'New Character';
    if (previewTagline) previewTagline.textContent = tagline || 'A brief tagline will appear here.';
    if (previewAvatar) {
      const src = Security.sanitizeUrl(AppState.tempCharAvatar) || CONSTANTS.DEFAULT_AVATAR;
      previewAvatar.src = src;
      previewAvatar.onerror = () => { previewAvatar.src = CONSTANTS.DEFAULT_AVATAR; };
    }
    if (hint) hint.classList.toggle('hidden', !!AppState.tempCharAvatar);
  },

  // ─── Persona Modal ─────────────────────────────────────────────────────────
  openPersonaModal(personaId = null) {
    AppState.editingPersonaId = personaId;
    AppState.tempPersonaAvatar = '';

    const fileInput = DOM.$('#input-persona-avatar-file');
    if (fileInput) fileInput.value = '';

    const title = DOM.$('#persona-modal-title');
    const preview = DOM.$('#preview-persona-avatar');
    const hint = DOM.$('#persona-avatar-hint');

    if (personaId) {
      const persona = AppState.personas.find(p => p.id === personaId);
      if (!persona) return;
      title.textContent = 'Edit User Persona';
      DOM.$('#input-persona-name').value = persona.name;
      DOM.$('#input-persona-pronouns').value = persona.pronouns || '';
      DOM.$('#input-persona-desc').value = persona.desc || '';
      if (persona.avatar) {
        AppState.tempPersonaAvatar = persona.avatar;
        preview.src = persona.avatar;
        preview.classList.remove('hidden');
        hint.classList.add('hidden');
      } else {
        preview.classList.add('hidden');
        hint.classList.remove('hidden');
      }
    } else {
      title.textContent = 'New User Persona';
      DOM.$('#input-persona-name').value = '';
      DOM.$('#input-persona-pronouns').value = '';
      DOM.$('#input-persona-desc').value = '';
      preview.classList.add('hidden');
      hint.classList.remove('hidden');
    }

    Modals.open('persona-modal');
    setTimeout(() => DOM.$('#input-persona-name').focus(), 50);
  },

  // ─── Tag Badges ────────────────────────────────────────────────────────────
  updateTagBadges(text, badgeId) {
    const container = DOM.$(`#${badgeId}`);
    if (!container) return;
    container.innerHTML = '';

    const { valid, invalid } = Templates.validate(text);

    valid.forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 font-mono text-[10px]';
      badge.textContent = `✓ ${tag}`;
      container.appendChild(badge);
    });

    invalid.forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-400 font-mono text-[10px]';
      badge.textContent = `⚠ ${tag}`;
      container.appendChild(badge);
    });
  },

  // ─── Input & Popover ───────────────────────────────────────────────────────
  adjustInputHeight() {
    const input = DOM.$('#message-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 128) + 'px';
  },

  updateEnhanceButtonState() {
    const input = DOM.$('#message-input');
    const enhanceBtn = DOM.$('#pop-enhance-ai');
    if (!input || !enhanceBtn) return;

    const hasText = input.value.trim().length > 0;
    enhanceBtn.disabled = !hasText;
    if (hasText) {
      enhanceBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      enhanceBtn.classList.add('hover:text-white', 'hover:bg-[#27272a]');
      enhanceBtn.title = 'Enhance current message with AI';
    } else {
      enhanceBtn.classList.add('opacity-50', 'cursor-not-allowed');
      enhanceBtn.classList.remove('hover:text-white', 'hover:bg-[#27272a]');
      enhanceBtn.title = 'Type a message first to enhance with AI';
    }
  },

  setGeneratingState(generating) {
    AppState.isGenerating = generating;
    const sendBtn = DOM.$('#btn-send-message');
    const sendIcon = DOM.$('#send-btn-icon');
    if (!sendBtn || !sendIcon) return;

    if (generating) {
      sendBtn.disabled = false;
      sendBtn.title = 'Stop Generating';
      sendBtn.ariaLabel = 'Stop Generating';
      sendBtn.classList.remove('bg-white', 'text-black', 'hover:bg-zinc-200');
      sendBtn.classList.add('bg-red-600', 'text-white', 'hover:bg-red-500');
      sendIcon.className = 'icon icon-stop w-3.5 h-3.5 bg-white';
    } else {
      sendBtn.title = 'Send';
      sendBtn.ariaLabel = 'Send';
      sendBtn.classList.remove('bg-red-600', 'text-white', 'hover:bg-red-500');
      sendBtn.classList.add('bg-white', 'text-black', 'hover:bg-zinc-200');
      sendIcon.className = 'icon icon-send w-3.5 h-3.5 bg-black';
      this.checkModelLoadedState();
    }
  },

  clearImagePreview() {
    AppState.attachedImage = null;
    const imgInput = DOM.$('#image-input');
    if (imgInput) imgInput.value = '';
    DOM.hide(DOM.$('#image-preview'));
  },

  // ─── Event Binding ─────────────────────────────────────────────────────────
  bindEvents() {
    // Sidebar
    DOM.$('#btn-toggle-sidebar')?.addEventListener('click', () => this.toggleSidebar());
    DOM.$('#btn-expand-sidebar')?.addEventListener('click', () => this.toggleSidebar());

    // Search
    DOM.$('#search-input')?.addEventListener('input', () => this.renderCharacters());

    // Character creation / editing
    DOM.$('#btn-create-char')?.addEventListener('click', () => this.openCharModal());
    DOM.$('#btn-empty-create')?.addEventListener('click', () => this.openCharModal());
    DOM.$('#btn-edit-char')?.addEventListener('click', () => {
      const chat = AppState.getActiveChat();
      if (chat) this.openCharModal(chat.charId);
    });
    DOM.$('#btn-delete-char')?.addEventListener('click', () => {
      const chat = AppState.getActiveChat();
      if (chat) Chat.deleteCharacter(chat.charId);
    });

    // Export / import
    DOM.$('#btn-export-char')?.addEventListener('click', () => Chat.exportCharacter());
    DOM.$('#input-import-char')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) Chat.importCharacter(file);
      e.target.value = '';
    });
    DOM.$('#btn-export-chat')?.addEventListener('click', () => Chat.exportChat());

    // Modal save buttons
    DOM.$('#btn-save-char')?.addEventListener('click', () => Chat.saveCharacter());
    DOM.$('#btn-save-persona')?.addEventListener('click', () => Chat.savePersona());

    // Generic [data-dialog-close] handler
    document.querySelectorAll('[data-dialog-close]').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('dialog')?.close());
    });

    // Backdrop click closes dialogs
    ['char-modal', 'persona-modal'].forEach(id => {
      const d = document.getElementById(id);
      if (!d) return;
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    });

    // Ctrl/Cmd+Enter in char modal → save
    document.getElementById('char-modal')?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        Chat.saveCharacter();
      }
    });
    document.getElementById('persona-modal')?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        Chat.savePersona();
      }
    });

    // Char modal live updates
    DOM.$('#input-char-name')?.addEventListener('input', () => this.updateCharPreview());
    DOM.$('#input-char-tagline')?.addEventListener('input', () => {
      this.updateTaglineCount();
      this.updateCharPreview();
    });
    DOM.$('#input-char-desc')?.addEventListener('input', (e) => {
      this.updateTagBadges(e.target.value, 'tag-badge-desc');
    });
    DOM.$('#input-char-firstmsg')?.addEventListener('input', (e) => {
      this.updateTagBadges(e.target.value, 'tag-badge-firstmsg');
    });

    // Avatar file pickers + drag-and-drop
    this.bindAvatarDrop('char');
    this.bindAvatarDrop('persona');

    // Persona management
    DOM.$('#btn-open-persona-modal')?.addEventListener('click', () => this.openPersonaModal());
    DOM.$('#btn-edit-active-persona')?.addEventListener('click', () => this.openPersonaModal(AppState.activePersonaId));
    DOM.$('#btn-delete-active-persona')?.addEventListener('click', () => Chat.deleteActivePersona());

    DOM.$('#persona-select')?.addEventListener('change', (e) => {
      AppState.activePersonaId = e.target.value;
      AppState.save();
      this.renderPersonaTabDetails();
      this.renderMessages();
    });

    // New chat
    DOM.$('#btn-new-chat')?.addEventListener('click', () => {
      const chat = AppState.getActiveChat();
      if (chat) Chat.createNew(chat.charId);
    });

    // Model
    DOM.$('#model-select')?.addEventListener('change', (e) => {
      AppState.selectedModel = e.target.value;
      this.checkModelLoadedState();
      AppState.save();
    });
    DOM.$('#btn-fetch-models')?.addEventListener('click', () => this.fetchAndRenderModels());

    // Endpoint
    DOM.$('#endpoint-input')?.addEventListener('change', (e) => {
      const url = e.target.value.trim();
      if (Security.isValidEndpoint(url)) {
        AppState.endpoint = url.replace(/\/$/, '');
        AppState.save();
        this.fetchAndRenderModels();
      } else {
        Toast.error('Invalid endpoint URL. Please enter a full http(s):// URL.');
      }
    });

    // Temperature
    DOM.$('#temperature-slider')?.addEventListener('input', (e) => {
      AppState.temperature = parseFloat(e.target.value);
      const label = DOM.$('#temperature-value');
      if (label) label.textContent = AppState.temperature.toFixed(2);
    });
    DOM.$('#temperature-slider')?.addEventListener('change', () => AppState.save());

    // Message input
    const msgInput = DOM.$('#message-input');
    msgInput?.addEventListener('input', () => {
      this.adjustInputHeight();
      this.updateEnhanceButtonState();
    });
    DOM.$('#btn-send-message')?.addEventListener('click', () => Chat.sendMessage());
    msgInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        Chat.sendMessage();
      }
    });

    // Popover
    const plusBtn = DOM.$('#btn-plus-actions');
    const popover = DOM.$('#plus-popover');

    plusBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.updateEnhanceButtonState();
      popover?.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (popover && !popover.classList.contains('hidden') &&
          !popover.contains(e.target) &&
          e.target !== plusBtn && !plusBtn?.contains(e.target)) {
        popover.classList.add('hidden');
      }
    });

    DOM.$('#pop-add-image')?.addEventListener('click', () => {
      popover?.classList.add('hidden');
      DOM.$('#image-input')?.click();
    });
    DOM.$('#pop-enhance-ai')?.addEventListener('click', () => {
      if (DOM.$('#pop-enhance-ai')?.disabled) return;
      popover?.classList.add('hidden');
      Chat.enhanceMessage();
    });
    DOM.$('#pop-create-ai')?.addEventListener('click', () => {
      popover?.classList.add('hidden');
      Chat.createMessageWithAI();
    });

    // Chat image attachment
    DOM.$('#image-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        Toast.warn('Image is large (>5MB). It may slow down the request.');
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        AppState.attachedImage = evt.target.result;
        DOM.$('#preview-img-element').src = AppState.attachedImage;
        DOM.show(DOM.$('#image-preview'));
      };
      reader.readAsDataURL(file);
    });

    DOM.$('#btn-remove-image')?.addEventListener('click', () => this.clearImagePreview());
  },

  /**
   * Bind drag-and-drop + click-to-pick on an avatar drop zone.
   * `kind` is either 'char' or 'persona'.
   */
  bindAvatarDrop(kind) {
    const drop = DOM.$(`#${kind}-avatar-drop`);
    const input = DOM.$(`#input-${kind}-avatar-file`);
    const preview = DOM.$(`#preview-${kind}-avatar`);
    if (!drop || !input || !preview) return;

    const handleFile = (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (kind === 'char') {
          AppState.tempCharAvatar = evt.target.result;
          this.updateCharPreview();
        } else {
          AppState.tempPersonaAvatar = evt.target.result;
        }
        preview.src = evt.target.result;
        preview.classList.remove('hidden');
        DOM.$(`#${kind}-avatar-hint`)?.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    };

    input.addEventListener('change', (e) => handleFile(e.target.files?.[0]));

    ['dragenter', 'dragover'].forEach(evt =>
      drop.addEventListener(evt, (e) => {
        e.preventDefault();
        drop.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach(evt =>
      drop.addEventListener(evt, (e) => {
        e.preventDefault();
        drop.classList.remove('dragover');
      })
    );
    drop.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));
  }
};
