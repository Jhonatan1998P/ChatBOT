// js/app.js

/**
 * @class ChatApp
 * @description Manages the entire chat application's UI, state, and logic,
 * with enhanced rendering for sender labels and superimposed action buttons.
 */
class ChatApp {
    /**
     * Initializes the application.
     */
    constructor() {
        this.apiKey = null;
        this._getDOMElements();
        this._initLibraries();
        this._initState();
        this._bindEventListeners();
        this._init();
    }

    /**
     * Caches all necessary DOM elements for performance and convenience.
     */
    _getDOMElements() {
        this.dom = {
            appContainer: document.getElementById('app-container'),
            chatLog: document.getElementById('chat-log'),
            chatForm: document.getElementById('chat-form'),
            userInput: document.getElementById('user-input'),
            submitButton: document.querySelector('#chat-form button'),
            chatList: document.getElementById('chat-list'),
            newChatButton: document.getElementById('new-chat-button'),
            chatTitle: document.getElementById('chat-title'),
            tokenCount: document.getElementById('token-count'),
            typingIndicator: document.getElementById('typing-indicator'),
            menuToggleButton: document.getElementById('menu-toggle-button'),
            sidebar: document.getElementById('sidebar'),
            sidebarOverlay: document.getElementById('sidebar-overlay'),
            systemPrompt: {
                container: document.getElementById('system-prompt-container'),
                toggleButton: document.getElementById('toggle-system-prompt-button'),
                input: document.getElementById('system-prompt-input'),
                saveButton: document.getElementById('save-system-prompt-button'),
            },
            settings: {
                modal: document.getElementById('settings-modal'),
                openButton: document.getElementById('settings-button'),
                closeButton: document.getElementById('close-settings-button'),
                fontSizeOptions: document.getElementById('font-size-options'),
                maxTokens: {
                    slider: document.getElementById('max-tokens-slider'),
                    value: document.getElementById('max-tokens-value'),
                },
                showThoughtsToggle: document.getElementById('show-thoughts-toggle'),
            },
        };
    }
    
    _initLibraries() {
        marked.setOptions({
            highlight: (code, lang) => {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            },
            langPrefix: 'hljs language-',
            gfm: true,
            breaks: true,
        });
    }

    _initState() {
        const savedState = JSON.parse(localStorage.getItem('chatAppState'));
        const defaultState = {
            chats: {},
            activeChatId: null,
            settings: {
                fontSize: 'text-base',
                maxTokens: 2048,
                showThoughts: false,
            },
        };
        this.state = { ...defaultState, ...savedState };
        this.state.settings = { ...defaultState.settings, ...(savedState?.settings || {}) };
    }

    _bindEventListeners() {
        this.dom.chatForm.addEventListener('submit', this._handleFormSubmit.bind(this));
        this.dom.userInput.addEventListener('input', this._autoResizeTextarea.bind(this));
        this.dom.userInput.addEventListener('keydown', this._handleTextareaKeydown.bind(this));
        this.dom.newChatButton.addEventListener('click', this._createNewChat.bind(this));
        this.dom.chatList.addEventListener('click', this._handleSidebarActions.bind(this));
        this.dom.menuToggleButton.addEventListener('click', this._toggleSidebar.bind(this));
        this.dom.sidebarOverlay.addEventListener('click', this._toggleSidebar.bind(this));
        
        this.dom.chatLog.addEventListener('click', this._handleMessageActions.bind(this));

        this.dom.systemPrompt.toggleButton.addEventListener('click', this._toggleSystemPrompt.bind(this));
        this.dom.systemPrompt.saveButton.addEventListener('click', this._saveSystemPrompt.bind(this));

        this.dom.settings.openButton.addEventListener('click', () => this._toggleSettingsModal(true));
        this.dom.settings.closeButton.addEventListener('click', () => this._toggleSettingsModal(false));
        this.dom.settings.modal.addEventListener('click', (e) => {
            if (e.target === this.dom.settings.modal) this._toggleSettingsModal(false);
        });
        
        this.dom.settings.fontSizeOptions.addEventListener('click', this._handleFontSizeChange.bind(this));
        this.dom.settings.maxTokens.slider.addEventListener('input', this._handleMaxTokensChange.bind(this));
        this.dom.settings.showThoughtsToggle.addEventListener('change', this._handleShowThoughtsChange.bind(this));
    }

    _init() {
        this._getApiKey();
        if (Object.keys(this.state.chats).length === 0) {
            this._createNewChat();
        } else {
            this._setActiveChat(this.state.activeChatId);
        }
        this._renderChatList();
        this._applySettings();
        this._updateSubmitButtonState();
    }

    _getApiKey() {
        this.apiKey = import.meta.env.VITE_HUGGING_FACE_API_KEY || localStorage.getItem('hf_api_key_local');
        
        // Si estamos en local y no hay clave, la pedimos.
        if (!this.apiKey && window.location.hostname === 'localhost') {
            this.apiKey = prompt('DEVELOPMENT: Introduce tu API Key de Hugging Face (se guardará localmente):');
            if (this.apiKey) {
                localStorage.setItem('hf_api_key_local', this.apiKey);
            }
        }

        if (!this.apiKey) {
            console.error("API Key no encontrada. Asegúrate de configurarla en las variables de entorno de Vercel.");
        }
    }
    
    _saveState() {
        localStorage.setItem('chatAppState', JSON.stringify(this.state));
    }

    // --- Core Chat Logic ---

    async _handleFormSubmit(e) {
        e.preventDefault();
        const userInput = this.dom.userInput.value.trim();
        if (!userInput || !this.apiKey) {
            if (!this.apiKey) alert('La API Key no está configurada. Por favor, recarga la página.');
            return;
        }

        const activeChat = this.state.chats[this.state.activeChatId];
        if (activeChat) {
            activeChat.systemPrompt = this.dom.systemPrompt.input.value;
        }

        this._addMessageToState('user', userInput);
        this._renderChatContent();

        this.dom.userInput.value = '';
        this._autoResizeTextarea();
        this._updateSubmitButtonState();

        this._setTypingIndicator(true);
        const messageWrapper = this._createAssistantMessagePlaceholder();

        try {
            const payload = this._prepareApiPayload();
            const response = await this._queryAI(payload);

            if (response && response.body) {
                const finalResponse = await this._processStream(response.body, messageWrapper);
                this._addMessageToState('assistant', finalResponse, false);
            } else {
                messageWrapper.querySelector('.message-body-content').innerHTML = "Error: No se recibió una respuesta válida de la API.";
                this._addMessageToState('assistant', "Error en la respuesta.", false);
            }
        } catch (error) {
            console.error("Error during AI query or streaming:", error);
            messageWrapper.querySelector('.message-body-content').innerHTML = `Lo siento, ha ocurrido un error: ${error.message}`;
            this._addMessageToState('assistant', `Error: ${error.message}`, false);
        } finally {
            this._setTypingIndicator(false);
            this._saveState();
        }
    }

    _prepareApiPayload() {
        const activeChat = this.state.chats[this.state.activeChatId];
        const messages = [{ role: 'system', content: activeChat.systemPrompt }];
        messages.push(...activeChat.messages.map(({ role, content }) => ({ role, content })));
        return messages;
    }

    async _queryAI(messages) {
        try {
            const response = await fetch(
                "https://router.huggingface.co/v1/chat/completions", {
                    headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
                    method: "POST",
                    body: JSON.stringify({ 
                        model: "openai/gpt-oss-120b:novita", 
                        messages, 
                        max_tokens: this.state.settings.maxTokens,
                        stream: true 
                    })
                }
            );
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`);
            }
            return response;
        } catch (error) {
            console.error("Error al contactar la API:", error);
            throw error;
        }
    }

    async _processStream(stream, messageWrapper) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";
        const targetElement = messageWrapper.querySelector('.message-body-content');

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data.trim() === '[DONE]') break;
                    try {
                        const json = JSON.parse(data);
                        const content = json.choices[0]?.delta?.content;
                        if (content) {
                            fullResponse += content;
                            targetElement.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse + '▋'));
                            this.dom.chatLog.scrollTop = this.dom.chatLog.scrollHeight;
                        }
                    } catch (e) { console.error("Error parsing stream JSON:", e, "Data:", data); }
                }
            }
        }
        
        targetElement.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        this._enhanceContent(targetElement);
        this._updateTokenCount();
        return fullResponse;
    }

    _addMessageToState(role, content, render = true) {
        const activeChat = this.state.chats[this.state.activeChatId];
        if (!activeChat) return;
        
        activeChat.messages.push({ role, content });
        
        if (activeChat.messages.length === 1 && role === 'user') {
            activeChat.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
            this._renderChatList();
        }
        
        if (render) this._renderChatContent();
    }
    
    _createNewChat() {
        const newChatId = `chat_${Date.now()}`;
        this.state.chats[newChatId] = { id: newChatId, title: 'Nuevo Chat', messages: [], systemPrompt: 'Eres un asistente servicial y profesional.' };
        this._setActiveChat(newChatId);
        this._renderChatList();
        this._saveState();
    }
    
    _deleteChat(chatIdToDelete) {
        if (!this.state.chats[chatIdToDelete]) return;

        if (!confirm('¿Estás seguro de que quieres borrar este chat? Esta acción no se puede deshacer.')) {
            return;
        }

        const wasActive = this.state.activeChatId === chatIdToDelete;
        delete this.state.chats[chatIdToDelete];

        if (wasActive) {
            const remainingChatIds = Object.keys(this.state.chats);
            if (remainingChatIds.length > 0) {
                remainingChatIds.sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));
                this._setActiveChat(remainingChatIds[0]);
            } else {
                this._createNewChat();
            }
        }
        
        this._renderChatList();
        this._saveState();
    }

    _setActiveChat(chatId) {
        if (!chatId || !this.state.chats[chatId]) {
            const chatIds = Object.keys(this.state.chats);
            this.state.activeChatId = chatIds.length > 0 ? chatIds.sort((a,b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]))[0] : null;
        } else {
            this.state.activeChatId = chatId;
        }
        
        if (!this.state.activeChatId && Object.keys(this.state.chats).length === 0) {
            this._createNewChat();
            return;
        }

        this._renderChatContent();
        this._renderChatList();
        this._saveState();
    }

    // --- Rendering & Content Enhancement ---

    _renderChatList() {
        this.dom.chatList.innerHTML = '';
        const chatIds = Object.keys(this.state.chats);
        if (chatIds.length === 0) return;

        chatIds.sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));

        chatIds.forEach(chatId => {
            const chat = this.state.chats[chatId];
            const li = document.createElement('li');
            li.dataset.chatId = chatId;
            li.className = `group flex items-center justify-between p-2 rounded-md cursor-pointer text-sm transition-colors duration-200 ${
                chatId === this.state.activeChatId ? 'bg-indigo-600/50 text-white' : 'hover:bg-gray-800/50'
            }`;

            const title = document.createElement('span');
            title.className = 'truncate';
            title.textContent = chat.title;

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-chat-btn p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white transition-opacity rounded-full hover:bg-gray-700';
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            
            li.appendChild(title);
            li.appendChild(deleteBtn);
            this.dom.chatList.appendChild(li);
        });
    }

    _renderChatContent() {
        this.dom.chatLog.innerHTML = '';
        const activeChat = this.state.chats[this.state.activeChatId];

        if (!activeChat) {
            this.dom.chatTitle.textContent = 'Chat';
            this.dom.tokenCount.textContent = 'Tokens: 0';
            this.dom.systemPrompt.input.value = '';
            return;
        }

        this.dom.chatTitle.textContent = activeChat.title;
        this.dom.systemPrompt.input.value = activeChat.systemPrompt;
        
        activeChat.messages.forEach((message, index) => this._appendMessageToLog(message.role, message.content, index));
        this._updateTokenCount();
    }
    
    _appendMessageToLog(role, content, index) {
        const messageWrapper = this._createMessageWrapper(role, index);
        const messageBody = messageWrapper.querySelector('.message-body-content');
        messageBody.innerHTML = DOMPurify.sanitize(marked.parse(content));
        this._enhanceContent(messageBody);
        this.dom.chatLog.appendChild(messageWrapper);
        this.dom.chatLog.scrollTop = this.dom.chatLog.scrollHeight;
    }

    _enhanceContent(element) {
        this._addCopyToClipboardButtonToPre(element);
        this._enhanceTables(element);
    }

    _enhanceTables(element) {
        element.querySelectorAll('table').forEach(table => {
            const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent);
            table.querySelectorAll('tbody tr').forEach(row => {
                row.querySelectorAll('td').forEach((cell, i) => {
                    if (headers[i]) {
                        cell.dataset.label = headers[i];
                    }
                });
            });
        });
    }
    
    _createAssistantMessagePlaceholder() {
        const index = this.state.chats[this.state.activeChatId].messages.length;
        const messageWrapper = this._createMessageWrapper('assistant', index);
        this.dom.chatLog.appendChild(messageWrapper);
        this.dom.chatLog.scrollTop = this.dom.chatLog.scrollHeight;
        return messageWrapper;
    }

    // --- CHANGE: Reworked to include sender labels and repositioned actions ---
    _createMessageWrapper(role, index) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-bubble flex items-start`;
        wrapper.dataset.messageIndex = index;

        const senderLabel = `<div class="font-bold text-xs text-gray-400 mb-2">${role === 'user' ? 'Tú:' : 'IA:'}</div>`;
        
        const messageContent = `
            <div class="message-content bg-gray-800 rounded-lg p-3 md:p-4 w-full prose prose-invert prose-sm">
                ${senderLabel}
                <div class="message-body-content"></div>
            </div>
        `;
        
        const actionsToolbar = `
            <div class="message-actions absolute top-2 right-2 flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm border border-gray-700/50 rounded-full p-1">
                <button class="copy-message-btn p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-full transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <button class="delete-message-btn p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-full transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </div>
        `;

        wrapper.innerHTML = `${messageContent} ${actionsToolbar}`;
        
        if (role === 'user') {
            wrapper.classList.add('justify-end');
        }

        return wrapper;
    }

    // --- UI Handlers & Helpers ---

    _handleSidebarActions(e) {
        const deleteBtn = e.target.closest('.delete-chat-btn');
        if (deleteBtn) {
            e.stopPropagation();
            const chatId = deleteBtn.closest('li[data-chat-id]').dataset.chatId;
            this._deleteChat(chatId);
            return;
        }
        
        const targetLi = e.target.closest('li[data-chat-id]');
        if (targetLi) {
            this._setActiveChat(targetLi.dataset.chatId);
            if(window.innerWidth < 768) this._toggleSidebar();
        }
    }

    _handleMessageActions(e) {
        const copyBtn = e.target.closest('.copy-message-btn');
        const deleteBtn = e.target.closest('.delete-message-btn');
        const messageContent = e.target.closest('.message-content');

        if (copyBtn) return this._copyMessage(copyBtn);
        if (deleteBtn) return this._deleteMessage(deleteBtn);

        const currentlyVisible = this.dom.chatLog.querySelector('.actions-visible');
        if (currentlyVisible) {
            currentlyVisible.classList.remove('actions-visible');
        }

        if (messageContent && currentlyVisible?.closest('.message-bubble') !== messageContent.closest('.message-bubble')) {
            messageContent.closest('.message-bubble').querySelector('.message-actions')?.classList.add('actions-visible');
        }
    }

    _copyMessage(button) {
        const bubble = button.closest('.message-bubble');
        const content = bubble.querySelector('.message-body-content');
        navigator.clipboard.writeText(content.innerText)
            .then(() => {
                button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                setTimeout(() => {
                    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                }, 2000);
            })
            .catch(err => console.error('Failed to copy text: ', err));
    }

    _deleteMessage(button) {
        const bubble = button.closest('.message-bubble');
        const index = parseInt(bubble.dataset.messageIndex, 10);
        const activeChat = this.state.chats[this.state.activeChatId];

        if (activeChat && typeof activeChat.messages[index] !== 'undefined') {
            activeChat.messages.splice(index, 1);
            this._renderChatContent();
            this._saveState();
        }
    }

    _toggleSidebar() {
        this.dom.sidebar.classList.toggle('-translate-x-full');
        this.dom.sidebarOverlay.classList.toggle('hidden');
    }
    
    _toggleSystemPrompt() {
        this.dom.systemPrompt.container.classList.toggle('hidden');
    }

    _saveSystemPrompt() {
        const activeChat = this.state.chats[this.state.activeChatId];
        if (activeChat) {
            activeChat.systemPrompt = this.dom.systemPrompt.input.value;
            this._saveState();
            this.dom.systemPrompt.saveButton.textContent = 'Guardado!';
            setTimeout(() => { this.dom.systemPrompt.saveButton.textContent = 'Guardar'; }, 1500);
        }
    }

    _toggleSettingsModal(show) {
        this.dom.settings.modal.classList.toggle('hidden', !show);
    }
    
    _setTypingIndicator(isTyping) {
        this.dom.typingIndicator.classList.toggle('hidden', !isTyping);
        if(isTyping) this.dom.chatLog.scrollTop = this.dom.chatLog.scrollHeight;
    }

    _updateTokenCount() {
        const activeChat = this.state.chats[this.state.activeChatId];
        const totalChars = activeChat ? activeChat.messages.reduce((sum, msg) => sum + msg.content.length, 0) : 0;
        const estimatedTokens = Math.ceil(totalChars / 4);
        this.dom.tokenCount.textContent = `Tokens: ${estimatedTokens}`;
    }
    
    _autoResizeTextarea() {
        this.dom.userInput.style.height = 'auto';
        this.dom.userInput.style.height = `${this.dom.userInput.scrollHeight}px`;
        this._updateSubmitButtonState();
    }
    
    _handleTextareaKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.dom.chatForm.requestSubmit();
        }
    }
    
    _updateSubmitButtonState() {
        this.dom.submitButton.disabled = this.dom.userInput.value.trim().length === 0;
    }

    _addCopyToClipboardButtonToPre(parentElement) {
        parentElement.querySelectorAll('pre').forEach(preElement => {
            const button = document.createElement('button');
            button.className = 'absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-300';
            button.textContent = 'Copiar';
            preElement.style.position = 'relative';
            preElement.appendChild(button);
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = preElement.querySelector('code').innerText;
                navigator.clipboard.writeText(code).then(() => {
                    button.textContent = 'Copiado!';
                    setTimeout(() => { button.textContent = 'Copiar'; }, 2000);
                });
            });
        })
    }

    // --- Settings Logic ---

    _applySettings() {
        const fontSizes = ['text-sm', 'text-base', 'text-lg'];
        this.dom.appContainer.classList.remove(...fontSizes);
        this.dom.appContainer.classList.add(this.state.settings.fontSize);
        
        this.dom.settings.fontSizeOptions.querySelectorAll('button').forEach(btn => {
            btn.classList.remove('bg-indigo-600', 'bg-gray-700');
            btn.classList.add(btn.dataset.size === this.state.settings.fontSize ? 'bg-indigo-600' : 'bg-gray-700');
        });

        this.dom.settings.maxTokens.slider.value = this.state.settings.maxTokens;
        this.dom.settings.maxTokens.value.textContent = this.state.settings.maxTokens;

        this.dom.settings.showThoughtsToggle.checked = this.state.settings.showThoughts;
    }

    _handleFontSizeChange(e) {
        const button = e.target.closest('button[data-size]');
        if (button) {
            this.state.settings.fontSize = button.dataset.size;
            this._applySettings();
            this._saveState();
        }
    }

    _handleMaxTokensChange(e) {
        this.state.settings.maxTokens = parseInt(e.target.value, 10);
        this._applySettings();
        this._saveState();
    }

    _handleShowThoughtsChange(e) {
        this.state.settings.showThoughts = e.target.checked;
        this._applySettings();
        this._saveState();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});