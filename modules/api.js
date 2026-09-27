/**
 * Roleo - API Module
 * Handles all communication with the LM Studio / OpenAI-compatible endpoint.
 */

const API = {
  /**
   * Build the full API URL for a given path.
   */
  url(path) {
    const base = (AppState.endpoint || 'http://localhost:1234/v1').replace(/\/$/, '');
    return `${base}${path}`;
  },

  /**
   * Fetch available models from the endpoint.
   */
  async fetchModels() {
    try {
      const res = await fetch(this.url('/models'), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawModels = data.data || [];

      // Filter out non-text-generation models
      return rawModels.filter(m => {
        const id = (m.id || '').toLowerCase();
        const type = (m.type || m.object || '').toLowerCase();
        if (type.includes('embedding')) return false;
        return !CONSTANTS.NON_TEXT_KEYWORDS.some(kw => id.includes(kw));
      });
    } catch (err) {
      console.warn('Failed to fetch models:', err.message);
      return [];
    }
  },

  /**
   * Send a chat completion request with streaming support.
   * @param {Array} messages - Array of {role, content} messages
   * @param {Object} options - { temperature, onDelta, onError, onDone, signal }
   */
  async streamChat(messages, options = {}) {
    const {
      temperature = 0.7,
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

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      }

      onDone();
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError(err);
      }
    }
  },

  /**
   * Build the system prompt for a character + persona combo.
   */
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

  /**
   * Convert internal message format to API message format.
   */
  buildAPIMessages(chat, char) {
    const messages = [{ role: 'system', content: this.buildSystemPrompt(char) }];

    for (const msg of chat.messages) {
      const text = msg.variants[msg.activeVariant];
      if (!text && !msg.image) continue;

      if (msg.sender === 'user') {
        if (msg.image) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: text || '' },
              { type: 'image_url', image_url: { url: msg.image } }
            ]
          });
        } else {
          messages.push({ role: 'user', content: text });
        }
      } else {
        messages.push({ role: 'assistant', content: text });
      }
    }

    return messages;
  },

  /**
   * Generate AI response for the active chat.
   */
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

    const apiMessages = this.buildAPIMessages(chat, char);

    await this.streamChat(apiMessages, {
      temperature: 0.7,
      signal: AppState.abortController.signal,
      onDelta: (delta) => {
        aiMsg.variants[0] += delta;
        onUpdate();
      },
      onError: () => {
        aiMsg.variants[0] += "\n\n*[Error communicating with server]*";
        onUpdate();
      },
      onDone: () => {
        AppState.resetGeneration();
        AppState.save();
        onUpdate();
      }
    });
  },

  /**
   * Regenerate the last AI message with a new variant.
   */
  async regenerateResponse(chat, char, msgIndex, onUpdate) {
    const msg = chat.messages[msgIndex];
    const persona = AppState.getActivePersona();

    const systemPrompt = `Roleplay context:\nCharacter: ${char.name}\nDescription: ${char.description || ''}\nUser Persona: ${persona.name} (${persona.pronouns || ''})`;

    const apiMessages = [{ role: 'system', content: systemPrompt }];
    for (let i = 0; i < msgIndex; i++) {
      const m = chat.messages[i];
      apiMessages.push({ role: m.sender, content: m.variants[m.activeVariant] });
    }

    msg.variants.push('');
    msg.activeVariant = msg.variants.length - 1;
    onUpdate();

    AppState.isGenerating = true;
    AppState.abortController = new AbortController();

    await this.streamChat(apiMessages, {
      temperature: 0.85,
      signal: AppState.abortController.signal,
      onDelta: (delta) => {
        msg.variants[msg.activeVariant] += delta;
        onUpdate();
      },
      onError: () => {
        msg.variants[msg.activeVariant] += "\n\n*[Failed to regenerate]*";
        onUpdate();
      },
      onDone: () => {
        AppState.resetGeneration();
        AppState.save();
        onUpdate();
      }
    });
  },

  /**
   * Enhance user message text with AI.
   */
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
      onDone: () => {
        AppState.resetGeneration();
      },
      onError: () => {
        AppState.resetGeneration();
      }
    });
  },

  /**
   * Create a message from AI on behalf of the user.
   */
  async createUserMessage(chat, char, onDelta) {
    const persona = AppState.getActivePersona();
    const contextText = chat.messages.slice(-4).map(m => `${m.sender}: ${m.variants[m.activeVariant]}`).join('\n');

    AppState.isGenerating = true;
    AppState.abortController = new AbortController();

    await this.streamChat([
      { role: 'system', content: `Write the next roleplay response/action on behalf of the user persona (${persona.name}, pronouns: ${persona.pronouns || 'they/them'}) talking to ${char.name}. Output ONLY the action/dialogue text, no meta text.` },
      { role: 'user', content: `Recent context:\n${contextText}` }
    ], {
      temperature: 0.8,
      signal: AppState.abortController.signal,
      onDelta,
      onDone: () => {
        AppState.resetGeneration();
      },
      onError: () => {
        AppState.resetGeneration();
      }
    });
  }
};