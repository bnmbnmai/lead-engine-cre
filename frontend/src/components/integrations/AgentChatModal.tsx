/**
 * AgentChatModal — Demo chat interface for the LangChain autonomous bidding agent.
 *
 * Opens as a Dialog modal. Sends user messages to /api/v1/mcp/chat,
 * displays tool call traces and assistant responses.
 */
import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, Wrench, User, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_BASE_URL } from '@/lib/api';

// ── Types ──

interface ChatMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCall?: { name: string; params: Record<string, unknown>; result?: unknown };
}

interface AgentChatModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

// ── Component ──

export function AgentChatModal({ open, onOpenChange }: AgentChatModalProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [agentMode, setAgentMode] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // Welcome message on open
    useEffect(() => {
        if (open && messages.length === 0) {
            setMessages([{
                role: 'assistant',
                content: '👋 Hi! I\'m your autonomous bidding agent. I can search leads, check bid floors, configure auto-bid rules, and more. Try asking:\n\n• "Search solar leads in California"\n• "What\'s the bid floor for mortgage?"\n• "Show my preferences"\n• "Export my leads as CSV"',
            }]);
        }
    }, [open]);

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

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();

            // Add tool messages and final assistant response
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
            // Find the last assistant message
            const assistantMsg = data.messages?.filter((m: ChatMessage) => m.role === 'assistant').pop();
            if (assistantMsg) {
                newMessages.push(assistantMsg);
            }

            // Track which mode the agent is in
            if (data.mode) {
                setAgentMode(data.mode);
            }

            setMessages((prev) => [...prev, ...newMessages]);
        } catch {
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: '⚠️ Failed to reach the agent server. Make sure the MCP server is running on port 3002.' },
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[70vh] flex flex-col p-0 gap-0">
                {/* Header */}
                <DialogHeader className="px-6 py-4 border-b border-border">
                    <DialogTitle className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20">
                            <Sparkles className="h-4 w-4 text-violet-400" />
                        </div>
                        Agent Chat
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2">
                        Demo chat powered by MCP tools — your messages invoke real API endpoints
                        {agentMode && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono ${agentMode === 'kimi-k2.5'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}>
                                {agentMode === 'kimi-k2.5' ? '🧠 Kimi K2.5' : '⚡ Fallback'}
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                {/* Messages */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
                >
                    {messages.map((msg, i) => (
                        <MessageBubble key={i} message={msg} />
                    ))}
                    {isLoading && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Agent is thinking...
                        </div>
                    )}
                </div>

                {/* Input */}
                <div className="px-6 py-4 border-t border-border">
                    <div className="flex gap-2">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask the agent..."
                            disabled={isLoading}
                            className="flex-1"
                        />
                        <Button
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                            size="sm"
                            className="px-3"
                        >
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Message Bubble ──

function MessageBubble({ message }: { message: ChatMessage }) {
    if (message.role === 'user') {
        return (
            <div className="flex justify-end">
                <div className="flex items-start gap-2 max-w-[80%]">
                    <div className="px-4 py-2.5 rounded-2xl rounded-br-md bg-primary text-primary-foreground text-sm leading-relaxed">
                        {message.content}
                    </div>
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                </div>
            </div>
        );
    }

    if (message.role === 'tool') {
        return (
            <div className="flex items-start gap-2 max-w-[90%]">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Wrench className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <div className="px-3 py-2 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs font-mono space-y-1 overflow-x-auto max-w-full">
                    <div className="text-amber-400 font-semibold">
                        🔧 {message.toolCall?.name}
                    </div>
                    {message.toolCall?.params && Object.keys(message.toolCall.params).length > 0 && (
                        <div className="text-muted-foreground">
                            params: {JSON.stringify(message.toolCall.params)}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Assistant
    return (
        <div className="flex items-start gap-2 max-w-[85%]">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-muted text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
            </div>
        </div>
    );
}

export default AgentChatModal;
