/**
 * Roleo - API Module
 * Handles all communication with the LM Studio / OpenAI-compatible endpoint.
 */

const API = {
  lastError: null,

  url(path) {
    const base = (AppState.endpoint || CONSTANTS.DEFAULT_ENDPOINT).replace(/\/$/, '');
    return `${base}${path}`;
  },

  /**
   * Turn a raw fetch error into a structured, user-facing diagnostic.
   */
  diagnoseError(err, url) {
    if (err.name === 'AbortError') {
      return {
        type: 'timeout',
        message: `Connection to ${url} timed out.`,
        hint: 'Is your local server actually running and listening on this port?'
      };
    }
    if (err instanceof TypeError) {
      const isHttpsPage = window.location.protocol === 'https:';
      const isHttpEndpoint = url.startsWith('http://');
      const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url);

      if (isHttpsPage && isHttpEndpoint && !isLocalhost) {
        return {
          type: 'mixed-content',
          message: 'Mixed content blocked: this page is HTTPS but the endpoint is HTTP.',
          hint: 'Browsers only allow HTTPS pages to reach http://localhost or http://127.0.0.1. Use those, or serve this page over HTTP.'
        };
      }
      if (isHttpsPage && isHttpEndpoint && isLocalhost) {
        return {
          type: 'pna-cors',
          message: 'Browser blocked the request to localhost (private network access / CORS).',
          hint: 'In LM Studio: enable "CORS" and "Serve on Local Network" in the server settings. Chrome also requires the server to reply to preflight with "Access-Control-Allow-Private-Network: true".'
        };
      }
      return {
        type: 'network',
        message: `Could not reach ${url}.`,
        hint: 'Check that (1) the server is running, (2) CORS is enabled, (3) the endpoint URL is correct.'
      };
    }
    return { type: 'unknown', message: err.message || String(err), hint: '' };
  },

  /**
   * Fetch models. Returns an array (possibly empty). Diagnostics land in `API.lastError`.
   */
  async fetchModels() {
    this.lastError = null;
    const url = this.url('/models');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
        mode: 'cors'
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      const rawModels = Array.isArray(data.data) ? data.data : [];

      return rawModels.filter(m => {
        const id = (m.id || '').toLowerCase();
        const type = (m.type || m.object || '').toLowerCase();
        if (type.includes('embedding')) return false;
        return !CONSTANTS.NON_TEXT_KEYWORDS.some(kw => id.includes(kw));
      });
    } catch (err) {
      this.lastError = this.diagnoseError(err, url);
      console.warn('[Roleo] Model fetch failed:', this.lastError.type, this.lastError.message);
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  },

  /**
   * Streaming chat completion.
   */
  async streamChat(messages, options = {}) {
    const {
      temperature = AppState.temperature ?? 0.7,
      onDelta = () => {},
      onError = () => {},
      onDone = () => {},
      signal
    } = options;

    try {
      const res = await fetch(this.url('/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AppState.selectedModel || 'local-model',
          messages,
          temperature,
          stream: true
        }),
        signal
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) onDelta(delta);
            } catch { /* skip malformed SSE */ }
          }
        }
      }

      onDone();
    } catch (err) {
      if (err.name === 'AbortError') return;
      onError(err);
    }
  },

  buildSystemPrompt(char) {
    const persona = AppState.getActivePersona();
    const description = Templates.process(char.description || '', char.name);
    const dialogues = Templates.process(char.dialogues || '', char.name);

    return `Roleplay Assistant context:
Character: ${char.name}
Description: ${description}
Example Dialogues: ${dialogues}

User Persona: ${persona.name}
Pronouns: ${persona.pronouns || 'unspecified'}
User Details: ${persona.desc || ''}
Write responses as ${char.name}. Stay strictly in character.`;
  },

  toApiMessage(msg) {
    const text = msg.variants[msg.activeVariant] || '';
    if (msg.sender === 'user' && msg.image) {
      return {
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: msg.image } }
        ]
      };
    }
    return { role: msg.sender, content: text };
  },

  buildAPIMessages(chat, char) {
    const messages = [{ role: 'system', content: this.buildSystemPrompt(char) }];
    for (const msg of chat.messages) {
      const text = msg.variants[msg.activeVariant];
      if (!text && !msg.image) continue;
      messages.push(this.toApiMessage(msg));
    }
    return messages;
  },

  async generateResponse(chat, char, onUpdate) {
    // Collapse variant branches before generating
    chat.messages.forEach(m => {
      if (m.variants.length > 1) {
        m.variants = [m.variants[m.activeVariant]];
        m.activeVariant = 0;
      }
    });

    const aiMsg = {
      id: Security.generateId('msg'),
      sender: 'assistant',
      variants: [''],
      activeVariant: 0
    };
    chat.messages.push(aiMsg);
    onUpdate();

    AppState.isGenerating = true;
    AppState.abortController = new AbortController();

    await this.streamChat(this.buildAPIMessages(chat, char), {
      temperature: AppState.temperature,
      signal: AppState.abortController.signal,
      onDelta: (delta) => {
        aiMsg.variants[0] += delta;
        onUpdate();
      },
      onError: (err) => {
        const diag = this.diagnoseError(err, this.url('/chat/completions'));
        aiMsg.variants[0] += `\n\n*[Error: ${diag.message}]*`;
        Toast.error(diag.message + (diag.hint ? ' — ' + diag.hint : ''));
        AppState.resetGeneration();
        AppState.save();
        onUpdate();
      },
      onDone: () => {
        AppState.resetGeneration();
        AppState.save();
        onUpdate();
      }
    });
  },

  async regenerateResponse(chat, char, msgIndex, onUpdate) {
    const msg = chat.messages[msgIndex];

    const apiMessages = [{ role: 'system', content: this.buildSystemPrompt(char) }];
    for (let i = 0; i < msgIndex; i++) {
      const m = chat.messages[i];
      const text = m.variants[m.activeVariant];
      if (!text && !m.image) continue;
      apiMessages.push(this.toApiMessage(m));
    }

    msg.variants.push('');
    msg.activeVariant = msg.variants.length - 1;
    onUpdate();

    AppState.isGenerating = true;
    AppState.abortController = new AbortController();

    await this.streamChat(apiMessages, {
      temperature: Math.min(1.5, AppState.temperature + 0.15),
      signal: AppState.abortController.signal,
      onDelta: (delta) => {
        msg.variants[msg.activeVariant] += delta;
        onUpdate();
      },
      onError: (err) => {
        const diag = this.diagnoseError(err, this.url('/chat/completions'));
        msg.variants[msg.activeVariant] += `\n\n*[Error: ${diag.message}]*`;
        Toast.error(diag.message + (diag.hint ? ' — ' + diag.hint : ''));
        AppState.resetGeneration();
        AppState.save();
        onUpdate();
      },
      onDone: () => {
        AppState.resetGeneration();
        AppState.save();
        onUpdate();
      }
    });
  },

  async enhanceMessage(text, onDelta) {
    AppState.isGenerating = true;
    AppState.abortController = new AbortController();

    await this.streamChat([
      { role: 'system', content: 'You are a helpful roleplay writing assistant. Expand and enhance the user text for a roleplay setting. Maintain original meaning, but make it descriptive and engaging. Output ONLY the enhanced response, with no conversational preamble or quotes.' },
      { role: 'user', content: text }
    ], {
      temperature: 0.7,
      signal: AppState.abortController.signal,
      onDelta,
      onDone: () => AppState.resetGeneration(),
      onError: () => AppState.resetGeneration()
    });
  },

  async createUserMessage(chat, char, onDelta) {
    const persona = AppState.getActivePersona();
    const contextText = chat.messages
      .slice(-4)
      .map(m => `${m.sender}: ${m.variants[m.activeVariant]}`)
      .join('\n');

    AppState.isGenerating = true;
    AppState.abortController = new AbortController();

    await this.streamChat([
      { role: 'system', content: `Write the next roleplay response/action on behalf of the user persona (${persona.name}, pronouns: ${persona.pronouns || 'they/them'}) talking to ${char.name}. Output ONLY the action/dialogue text, no meta text.` },
      { role: 'user', content: `Recent context:\n${contextText}` }
    ], {
      temperature: 0.8,
      signal: AppState.abortController.signal,
      onDelta,
      onDone: () => AppState.resetGeneration(),
      onError: () => AppState.resetGeneration()
    });
  }
};
