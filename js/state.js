export default class StateManager {
    constructor() {
        this.state = this._initState();
    }

    _initState() {
        const savedState = JSON.parse(localStorage.getItem('chatAppState'));
        const defaultState = {
            chats: {},
            activeChatId: null,
            settings: {
                fontSize: 3,
                maxTokens: 2048,
                showThoughts: false,
            },
        };
        const state = { ...defaultState, ...savedState };
        state.settings = { ...defaultState.settings, ...(savedState?.settings || {}) };
        return state;
    }

    saveState() {
        localStorage.setItem('chatAppState', JSON.stringify(this.state));
    }

    get() {
        return this.state;
    }

    getActiveChat() {
        return this.state.chats[this.state.activeChatId];
    }

    getActiveChatId() {
        return this.state.activeChatId;
    }

    getChats() {
        return this.state.chats;
    }

    getSettings() {
        return this.state.settings;
    }

    addMessage(role, content) {
        const activeChat = this.getActiveChat();
        if (!activeChat) return;
        
        activeChat.messages.push({ role, content });
        
        if (activeChat.messages.length === 1 && role === 'user') {
            activeChat.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
        }
        this.saveState();
        return activeChat.title;
    }

    deleteMessage(index) {
        const activeChat = this.getActiveChat();
        if (activeChat && typeof activeChat.messages[index] !== 'undefined') {
            activeChat.messages.splice(index, 1);
            this.saveState();
        }
    }
    
    createNewChat() {
        const newChatId = `chat_${Date.now()}`;
        this.state.chats[newChatId] = { id: newChatId, title: 'Nuevo Chat', messages: [], systemPrompt: 'Eres un asistente servicial y profesional.' };
        this.setActiveChat(newChatId);
        return newChatId;
    }

    deleteChat(chatIdToDelete) {
        const wasActive = this.state.activeChatId === chatIdToDelete;
        delete this.state.chats[chatIdToDelete];

        if (wasActive) {
            const remainingChatIds = Object.keys(this.state.chats);
            if (remainingChatIds.length > 0) {
                remainingChatIds.sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));
                this.setActiveChat(remainingChatIds[0]);
            } else {
                this.createNewChat();
            }
        }
        
        this.saveState();
    }

    setActiveChat(chatId) {
        if (!chatId || !this.state.chats[chatId]) {
            const chatIds = Object.keys(this.state.chats);
            this.state.activeChatId = chatIds.length > 0 ? chatIds.sort((a,b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]))[0] : null;
        } else {
            this.state.activeChatId = chatId;
        }
        this.saveState();
    }

    updateSystemPrompt(prompt) {
        const activeChat = this.getActiveChat();
        if (activeChat) {
            activeChat.systemPrompt = prompt;
            this.saveState();
        }
    }

    updateSettings(newSettings) {
        this.state.settings = { ...this.state.settings, ...newSettings };
        this.saveState();
    }
}