import StateManager from './state.js';
import ApiService from './api.js';
import UIManager from './ui.js';

class ChatApp {
    constructor() {
        this.stateManager = new StateManager();
        this.uiManager = new UIManager();
        this.apiService = null;
        this.scrollTimeout = null;
        
        this._bindEventListeners();
        this._init();
    }

    _bindEventListeners() {
        this.uiManager.dom.chatForm.addEventListener('submit', this._handleFormSubmit.bind(this));
        this.uiManager.dom.userInput.addEventListener('input', () => this.uiManager.autoResizeTextarea());
        this.uiManager.dom.userInput.addEventListener('keydown', this._handleTextareaKeydown.bind(this));
        this.uiManager.dom.newChatButton.addEventListener('click', this._createNewChat.bind(this));
        this.uiManager.dom.chatList.addEventListener('click', this._handleSidebarActions.bind(this));
        this.uiManager.dom.menuToggleButton.addEventListener('click', () => this.uiManager.toggleSidebar());
        this.uiManager.dom.sidebarOverlay.addEventListener('click', () => this.uiManager.toggleSidebar());
        
        this.uiManager.dom.chatLog.addEventListener('click', this._handleMessageActions.bind(this));
        this.uiManager.dom.chatLog.addEventListener('scroll', this._handleChatScroll.bind(this));

        this.uiManager.dom.systemPrompt.toggleButton.addEventListener('click', () => this.uiManager.toggleSystemPrompt());
        this.uiManager.dom.systemPrompt.saveButton.addEventListener('click', this._saveSystemPrompt.bind(this));

        this.uiManager.dom.settings.openButton.addEventListener('click', () => this.uiManager.toggleSettingsModal(true));
        this.uiManager.dom.settings.closeButton.addEventListener('click', () => this.uiManager.toggleSettingsModal(false));
        this.uiManager.dom.settings.modal.addEventListener('click', (e) => {
            if (e.target === this.uiManager.dom.settings.modal) this.uiManager.toggleSettingsModal(false);
        });
        
        this.uiManager.dom.settings.fontSize.slider.addEventListener('input', this._handleFontSizeChange.bind(this));
        this.uiManager.dom.settings.maxTokens.slider.addEventListener('input', this._handleMaxTokensChange.bind(this));
        this.uiManager.dom.settings.showThoughtsToggle.addEventListener('change', this._handleShowThoughtsChange.bind(this));

        this.uiManager.dom.scrollNav.upButton.addEventListener('click', this._handleScrollUp.bind(this));
        this.uiManager.dom.scrollNav.downButton.addEventListener('click', this._handleScrollDown.bind(this));
    }

    _init() {
        const apiKey = this._getApiKey();
        if (apiKey) {
            this.apiService = new ApiService(apiKey);
        }

        const state = this.stateManager.get();
        if (Object.keys(state.chats).length === 0) {
            this._createNewChat();
        } else {
            this._setActiveChat(state.activeChatId);
        }
        this.uiManager.renderChatList(state.chats, state.activeChatId);
        this.uiManager.applySettings(state.settings);
        this.uiManager.updateSubmitButtonState();
    }

    _getApiKey() {
        let apiKey = window.HUGGING_FACE_API_KEY;
        if (!apiKey || apiKey.startsWith('%')) {
            apiKey = localStorage.getItem('hf_api_key_local');
            if (!apiKey) {
                apiKey = prompt('DEVELOPMENT: Introduce tu API Key (se guardará localmente):');
                if (apiKey) localStorage.setItem('hf_api_key_local', apiKey);
            }
        }
        
        if (!apiKey || apiKey.startsWith('%')) {
             console.error("API Key no encontrada.");
             this.uiManager.dom.chatLog.innerHTML = `<div class="text-red-400 p-4">Error de configuración: La clave de la API no está disponible.</div>`;
             return null;
        }
        return apiKey;
    }

    async _handleFormSubmit(e) {
        e.preventDefault();
        const userInput = this.uiManager.dom.userInput.value.trim();
        if (!userInput || !this.apiService) {
            if (!this.apiService) alert('La API Key no está configurada. Por favor, recarga la página.');
            return;
        }

        this.stateManager.updateSystemPrompt(this.uiManager.dom.systemPrompt.input.value);

        const newTitle = this.stateManager.addMessage('user', userInput);
        if (newTitle) {
            this.uiManager.renderChatList(this.stateManager.getChats(), this.stateManager.getActiveChatId());
        }
        
        this.uiManager.renderChatContent(this.stateManager.getActiveChat());

        this.uiManager.dom.userInput.value = '';
        this.uiManager.autoResizeTextarea();

        this.uiManager.setTypingIndicator(true);
        const messageWrapper = this.uiManager.createAssistantMessagePlaceholder(this.stateManager.getActiveChat().messages.length);

        try {
            const payload = this._prepareApiPayload();
            const response = await this.apiService.query(payload);

            if (response && response.body) {
                const finalResponse = await this._processStream(response.body, messageWrapper);
                this.stateManager.addMessage('assistant', finalResponse);
            } else {
                const errorText = "Error: No se recibió una respuesta válida de la API.";
                this.uiManager.finalizeStreamedMessage(messageWrapper, errorText);
                this.stateManager.addMessage('assistant', errorText);
            }
        } catch (error) {
            console.error("Error during AI query or streaming:", error);
            const errorText = `Lo siento, ha ocurrido un error: ${error.message}`;
            this.uiManager.finalizeStreamedMessage(messageWrapper, errorText);
            this.stateManager.addMessage('assistant', errorText);
        } finally {
            this.uiManager.setTypingIndicator(false);
            this.uiManager.updateTokenCount(this.stateManager.getActiveChat().messages);
        }
    }

    _prepareApiPayload() {
        const activeChat = this.stateManager.getActiveChat();
        const messages = [{ role: 'system', content: activeChat.systemPrompt }];
        messages.push(...activeChat.messages.map(({ role, content }) => ({ role, content })));
        
        return {
            model: "openai/gpt-oss-120b:novita", 
            messages, 
            stream: true 
        };
    }

    async _processStream(stream, messageWrapper) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";
        let frameRequested = false;

        const render = () => {
            this.uiManager.updateStreamedMessage(messageWrapper, fullResponse);
            frameRequested = false;
        };

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
                            if (!frameRequested) {
                                frameRequested = true;
                                requestAnimationFrame(render);
                            }
                        }
                    } catch (e) {
                        console.error("Error parsing stream JSON:", e, "Data:", data);
                    }
                }
            }
        }
        
        this.uiManager.finalizeStreamedMessage(messageWrapper, fullResponse);
        return fullResponse;
    }
    
    _createNewChat() {
        this.stateManager.createNewChat();
        this._setActiveChat(this.stateManager.getActiveChatId());
    }
    
    _deleteChat(chatIdToDelete) {
        if (!confirm('¿Estás seguro de que quieres borrar este chat? Esta acción no se puede deshacer.')) {
            return;
        }
        this.stateManager.deleteChat(chatIdToDelete);
        this._setActiveChat(this.stateManager.getActiveChatId());
    }

    _setActiveChat(chatId) {
        this.stateManager.setActiveChat(chatId);
        const state = this.stateManager.get();
        this.uiManager.renderChatList(state.chats, state.activeChatId);
        this.uiManager.renderChatContent(state.chats[state.activeChatId]);
    }

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
            if(window.innerWidth < 768) this.uiManager.toggleSidebar();
        }
    }

    _handleMessageActions(e) {
        const copyBtn = e.target.closest('.copy-message-btn');
        const deleteBtn = e.target.closest('.delete-message-btn');

        if (copyBtn) return this._copyMessage(copyBtn);
        if (deleteBtn) return this._deleteMessage(deleteBtn);
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
        this.stateManager.deleteMessage(index);
        this.uiManager.renderChatContent(this.stateManager.getActiveChat());
    }

    _saveSystemPrompt() {
        this.stateManager.updateSystemPrompt(this.uiManager.dom.systemPrompt.input.value);
        this.uiManager.showSaveConfirmation();
    }
    
    _handleTextareaKeydown(e) {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            this.uiManager.dom.chatForm.requestSubmit();
        }
    }

    _handleChatScroll() {
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
        }
        this.uiManager.showScrollNavButtons();
        this.scrollTimeout = setTimeout(() => {
            this.uiManager.hideScrollNavButtons();
        }, 1500);
    }

    _getCurrentMessageIndex() {
        const bubbles = Array.from(this.uiManager.dom.chatLog.querySelectorAll('.message-bubble'));
        let currentIndex = -1;
        for (let i = 0; i < bubbles.length; i++) {
            const rect = bubbles[i].getBoundingClientRect();
            if (rect.top >= 0 && rect.top < this.uiManager.dom.chatLog.clientHeight) {
                currentIndex = i;
                break;
            }
        }
        if (currentIndex === -1 && bubbles.length > 0) {
            return bubbles.length -1;
        }
        return currentIndex;
    }

    _handleScrollUp() {
        const bubbles = Array.from(this.uiManager.dom.chatLog.querySelectorAll('.message-bubble'));
        const currentIndex = this._getCurrentMessageIndex();
        
        let targetIndex = -1;
        for (let i = currentIndex - 1; i >= 0; i--) {
            if (bubbles[i]) {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex !== -1) {
            this.uiManager.scrollToMessage(bubbles[targetIndex]);
        }
    }

    _handleScrollDown() {
        const bubbles = Array.from(this.uiManager.dom.chatLog.querySelectorAll('.message-bubble'));
        const currentIndex = this._getCurrentMessageIndex();
        
        let targetIndex = -1;
        for (let i = currentIndex + 1; i < bubbles.length; i++) {
            if (bubbles[i]) {
                targetIndex = i;
                break;
            }
        }
        
        if (targetIndex !== -1) {
            this.uiManager.scrollToMessage(bubbles[targetIndex]);
        }
    }

    _handleFontSizeChange(e) {
        const newSize = parseInt(e.target.value, 10);
        this.stateManager.updateSettings({ fontSize: newSize });
        this.uiManager.applySettings(this.stateManager.getSettings());
    }

    _handleMaxTokensChange(e) {
        const maxTokens = parseInt(e.target.value, 10);
        this.stateManager.updateSettings({ maxTokens });
        this.uiManager.applySettings(this.stateManager.getSettings());
    }

    _handleShowThoughtsChange(e) {
        const showThoughts = e.target.checked;
        this.stateManager.updateSettings({ showThoughts });
        this.uiManager.applySettings(this.stateManager.getSettings());
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});