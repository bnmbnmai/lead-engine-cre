/**
 * AgentChatWidget — Persistent floating chat bubble + expandable panel.
 *
 * Renders globally in App.tsx. Uses sessionStorage for history persistence.
 * Sends messages to /api/v1/mcp/chat. Supports internal link navigation,
 * tool-call traces, markdown rendering, and keyboard shortcuts.
 *
 * Position: bottom-20 right-6 (stacks above DemoPanel at bottom-6 right-6).
 * Mobile: full-width bottom sheet on viewports < 640px.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Bot, Send, Loader2, Wrench, User, Sparkles, X, MessageSquare } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';
import { RenderMarkdown } from './AgentMarkdown';

// ── Types ──

interface ChatMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCall?: { name: string; params: Record<string, unknown>; result?: unknown };
}

// ── Storage helpers ──

const STORAGE_KEY = 'le_agent_chat_history';

function loadHistory(): ChatMessage[] {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveHistory(messages: ChatMessage[]) {
    try {
        // Keep last 50 messages to avoid storage bloat
        const trimmed = messages.slice(-50);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
        // Silently fail — storage full or unavailable
    }
}

// ── Component ──

export function AgentChatWidget() {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [agentMode, setAgentMode] = useState<string | null>(null);
    const [hasUnread, setHasUnread] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Persist messages to sessionStorage
    useEffect(() => {
        saveHistory(messages);
    }, [messages]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // Focus input when panel opens
    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    // Welcome message on first open
    useEffect(() => {
        if (isOpen && messages.length === 0) {
            setMessages([{
                role: 'assistant',
                content: '👋 Hi! I\'m **LEAD Engine AI**, your autonomous bidding agent. I can search leads, check bid floors, configure auto-bid rules, and navigate the platform.\n\nTry asking:\n• "Search solar leads in California"\n• "What\'s the bid floor for mortgage?"\n• "Show my preferences"\n• "Take me to the marketplace"',
            }]);
        }
    }, [isOpen, messages.length]);

    // Listen for external open events (from BuyerIntegrations button)
    useEffect(() => {
        const handler = () => {
            setIsOpen(true);
            setHasUnread(false);
        };
        window.addEventListener('agent-chat:open', handler);
        return () => window.removeEventListener('agent-chat:open', handler);
    }, []);

    // Keyboard: Escape to minimize (only when input not focused)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen && document.activeElement !== inputRef.current) {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen]);

    // Navigate to internal links (panel stays open)
    const handleInternalLink = useCallback((path: string) => {
        navigate(path);
    }, [navigate]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isLoading) return;

        const userMsg: ChatMessage = { role: 'user', content: text };
        setMessages((prev) => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/mcp/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(localStorage.getItem('auth_token')
                        ? { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
                        : {}),
                },
                body: JSON.stringify({ message: text, history: messages }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();

            const newMessages: ChatMessage[] = [];
            if (data.toolCalls?.length) {
                for (const tc of data.toolCalls) {
                    newMessages.push({
                        role: 'tool',
                        content: `Called \`${tc.name}\``,
                        toolCall: tc,
                    });
                }
            }
            const assistantMsg = data.messages?.filter((m: ChatMessage) => m.role === 'assistant').pop();
            if (assistantMsg) {
                newMessages.push(assistantMsg);
            }

            if (data.mode) setAgentMode(data.mode);

            setMessages((prev) => [...prev, ...newMessages]);

            // Mark unread if panel is minimized
            if (!isOpen) setHasUnread(true);
        } catch {
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: '⚠️ Failed to reach the agent server. Please try again in a moment.' },
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleClearHistory = () => {
        setMessages([]);
        sessionStorage.removeItem(STORAGE_KEY);
    };

    // ── Render via Portal ──

    return createPortal(
        <>
            {/* Floating bubble — positioned above DemoPanel */}
            {!isOpen && (
                <button
                    onClick={() => { setIsOpen(true); setHasUnread(false); }}
                    className="fixed bottom-20 right-6 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 hover:from-violet-600 hover:to-blue-700 hover:scale-110 flex items-center justify-center shadow-lg shadow-violet-500/25 transition-all duration-300 group"
                    title="Open Agent Chat"
                    aria-label="Open AI Agent chat"
                >
                    <MessageSquare className="h-5 w-5 text-white" />
                    {hasUnread && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-background animate-pulse" />
                    )}
                    {/* Tooltip */}
                    <span className="absolute right-14 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-background/95 border border-border text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
                        AI Agent
                    </span>
                </button>
            )}

            {/* Expanded chat panel */}
            {isOpen && (
                <div className="fixed z-40 bottom-4 right-4 sm:bottom-6 sm:right-6 w-[calc(100vw-2rem)] sm:w-[380px] h-[calc(100vh-5rem)] sm:h-[550px] max-h-[700px] flex flex-col rounded-2xl border border-border bg-background/95 backdrop-blur-xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300" role="dialog" aria-label="Agent Chat">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border rounded-t-2xl bg-background/95 backdrop-blur-xl">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20">
                                <Sparkles className="h-4 w-4 text-violet-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-foreground">Agent Chat</h3>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-muted-foreground">MCP tools</span>
                                    {agentMode && (
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono ${agentMode === 'kimi-k2.5' || agentMode === 'langchain'
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                            }`}>
                                            {agentMode === 'langchain' ? '🧠 LangChain' : agentMode === 'kimi-k2.5' ? '🧠 Kimi' : '⚡ Fallback'}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={handleClearHistory}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                title="Clear chat history"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                title="Close (Esc)"
                                aria-label="Close chat panel"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Messages */}
                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
                    >
                        {messages.map((msg, i) => (
                            <MessageBubble key={i} message={msg} onNavigate={handleInternalLink} />
                        ))}
                        {isLoading && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Agent is thinking...
                            </div>
                        )}
                    </div>

                    {/* Input */}
                    <div className="px-4 py-3 border-t border-border">
                        <div className="flex gap-2">
                            <input
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Ask the agent..."
                                disabled={isLoading}
                                className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || isLoading}
                                className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Send className="h-4 w-4" />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>,
        document.body,
    );
}

// ── Message Bubble ──

function MessageBubble({ message, onNavigate }: { message: ChatMessage; onNavigate: (path: string) => void }) {
    if (message.role === 'user') {
        return (
            <div className="flex justify-end">
                <div className="flex items-start gap-2 max-w-[85%]">
                    <div className="px-3 py-2 rounded-2xl rounded-br-md bg-primary text-primary-foreground text-xs leading-relaxed">
                        {message.content}
                    </div>
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-3 w-3 text-muted-foreground" />
                    </div>
                </div>
            </div>
        );
    }

    if (message.role === 'tool') {
        return (
            <div className="flex items-start gap-2 max-w-[90%]">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Wrench className="h-3 w-3 text-amber-500" />
                </div>
                <div className="px-2.5 py-1.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] font-mono space-y-0.5 overflow-x-auto max-w-full">
                    <div className="text-amber-400 font-semibold">
                        🔧 {message.toolCall?.name}
                    </div>
                    {message.toolCall?.params && Object.keys(message.toolCall.params).length > 0 && (
                        <div className="text-muted-foreground truncate">
                            {JSON.stringify(message.toolCall.params)}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Assistant
    return (
        <div className="flex items-start gap-2 max-w-[90%]">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center">
                <Bot className="h-3 w-3 text-violet-400" />
            </div>
            <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-muted text-xs leading-relaxed whitespace-pre-wrap">
                <RenderMarkdown text={message.content} onNavigate={onNavigate} />
            </div>
        </div>
    );
}

export default AgentChatWidget;
