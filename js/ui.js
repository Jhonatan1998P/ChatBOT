export default class UIManager {
    constructor() {
        this._getDOMElements();
        this._initLibraries();
    }

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
                fontSize: {
                    slider: document.getElementById('font-size-slider'),
                    value: document.getElementById('font-size-value'),
                },
                maxTokens: {
                    slider: document.getElementById('max-tokens-slider'),
                    value: document.getElementById('max-tokens-value'),
                },
                showThoughtsToggle: document.getElementById('show-thoughts-toggle'),
            },
            scrollNav: {
                container: document.getElementById('scroll-nav-buttons'),
                upButton: document.getElementById('scroll-up-btn'),
                downButton: document.getElementById('scroll-down-btn'),
            }
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

    renderChatList(chats, activeChatId) {
        this.dom.chatList.innerHTML = '';
        const chatIds = Object.keys(chats);
        if (chatIds.length === 0) return;

        chatIds.sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));

        chatIds.forEach(chatId => {
            const chat = chats[chatId];
            const li = document.createElement('li');
            li.dataset.chatId = chatId;
            li.className = `group flex items-center justify-between p-2 rounded-md cursor-pointer text-sm transition-colors duration-200 ${
                chatId === activeChatId ? 'bg-indigo-600/50 text-white' : 'hover:bg-gray-800/50'
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

    renderChatContent(chat) {
        this.dom.chatLog.innerHTML = '';

        if (!chat) {
            this.dom.chatTitle.textContent = 'Chat';
            this.updateTokenCount([]);
            this.dom.systemPrompt.input.value = '';
            return;
        }

        this.dom.chatTitle.textContent = chat.title;
        this.dom.systemPrompt.input.value = chat.systemPrompt;
        
        chat.messages.forEach((message, index) => this.appendMessage(message.role, message.content, index, true));
        this.updateTokenCount(chat.messages);
        this.scrollToBottom();
    }

    appendMessage(role, content, index, isInitialRender = false) {
        const messageWrapper = this._createMessageWrapper(role, index);
        const messageBody = messageWrapper.querySelector('.message-body-content');
        
        const processedContent = role === 'assistant' ? this._formatAssistantContent(content) : content;
        messageBody.innerHTML = DOMPurify.sanitize(marked.parse(processedContent));

        this._enhanceContent(messageBody);
        this.dom.chatLog.appendChild(messageWrapper);
        if (!isInitialRender) {
            this.scrollToBottom();
        }
    }

    createAssistantMessagePlaceholder(index) {
        const messageWrapper = this._createMessageWrapper('assistant', index);
        this.dom.chatLog.appendChild(messageWrapper);
        this.scrollToBottom();
        return messageWrapper;
    }

    updateStreamedMessage(messageWrapper, fullResponse) {
        const targetElement = messageWrapper.querySelector('.message-body-content');
        targetElement.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse + '▋'));
    }

    finalizeStreamedMessage(messageWrapper, fullResponse) {
        const targetElement = messageWrapper.querySelector('.message-body-content');
        const formattedResponse = this._formatAssistantContent(fullResponse);
        targetElement.innerHTML = DOMPurify.sanitize(marked.parse(formattedResponse));
        this._enhanceContent(targetElement);
    }

    _formatAssistantContent(text) {
        if (!text) return '';
    
        const protectedBlockRegex = /(```[\s\S]*?```|(?:\n|^)(?:\|.*?\n){2,})/g;
    
        const parts = text.split(protectedBlockRegex);
    
        const formattedParts = parts.map((part, index) => {
            if (!part) return '';
    
            if (index % 2 === 1) {
                return part;
            }
    
            let formattedText = part;
            formattedText = formattedText.replace(/^\s*([*-]|\d+\.)\s+/gm, '• ');
            
            formattedText = formattedText.trim();
            if (formattedText.length > 0) {
                 formattedText = formattedText.replace(/\n\n+/g, '<br>').replace(/\n/g, '<br>').replace(/<br>/g, '\n\n');
            }
           
            return formattedText;
        });
    
        return formattedParts.join('').trim();
    }
    
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

    toggleSidebar() {
        this.dom.sidebar.classList.toggle('-translate-x-full');
        this.dom.sidebarOverlay.classList.toggle('hidden');
    }
    
    toggleSystemPrompt() {
        this.dom.systemPrompt.container.classList.toggle('hidden');
    }

    toggleSettingsModal(show) {
        this.dom.settings.modal.classList.toggle('hidden', !show);
    }
    
    setTypingIndicator(isTyping) {
        this.dom.typingIndicator.classList.toggle('hidden', !isTyping);
        if(isTyping) this.scrollToBottom();
    }

    updateTokenCount(messages) {
        const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
        const estimatedTokens = Math.ceil(totalChars / 4);
        this.dom.tokenCount.textContent = `Tokens: ${estimatedTokens}`;
    }
    
    autoResizeTextarea() {
        this.dom.userInput.style.height = 'auto';
        this.dom.userInput.style.height = `${this.dom.userInput.scrollHeight}px`;
        this.updateSubmitButtonState();
    }
    
    updateSubmitButtonState() {
        this.dom.submitButton.disabled = this.dom.userInput.value.trim().length === 0;
    }

    applySettings(settings) {
        const sizeValue = parseInt(settings.fontSize, 10);
        const sizeMap = {
            1: { name: 'Pequeño', px: '13px' },
            2: { name: 'Normal', px: '14px' },
            3: { name: 'Mediano', px: '16px' },
            4: { name: 'Grande', px: '18px' },
            5: { name: 'Enorme', px: '20px' },
        };
        
        this.dom.appContainer.style.fontSize = sizeMap[sizeValue]?.px || '16px';
        this.dom.settings.fontSize.slider.value = sizeValue;
        this.dom.settings.fontSize.value.textContent = sizeMap[sizeValue]?.name || 'Mediano';

        this.dom.settings.maxTokens.slider.value = settings.maxTokens;
        this.dom.settings.maxTokens.value.textContent = settings.maxTokens;

        this.dom.settings.showThoughtsToggle.checked = settings.showThoughts;
    }

    isScrolledToBottom() {
        return this.dom.chatLog.scrollHeight - this.dom.chatLog.clientHeight <= this.dom.chatLog.scrollTop + 10;
    }

    scrollToBottom() {
        this.dom.chatLog.scrollTop = this.dom.chatLog.scrollHeight;
    }

    scrollToMessage(element) {
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    showScrollNavButtons() {
        this.dom.scrollNav.container.classList.remove('hidden');
    }

    hideScrollNavButtons() {
        this.dom.scrollNav.container.classList.add('hidden');
    }

    showSaveConfirmation() {
        this.dom.systemPrompt.saveButton.textContent = 'Guardado!';
        setTimeout(() => { this.dom.systemPrompt.saveButton.textContent = 'Guardar'; }, 1500);
    }
}