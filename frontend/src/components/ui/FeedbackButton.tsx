import { useState } from 'react';
import { MessageSquarePlus, X, Send, Bug, Lightbulb, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/lib/api';

type FeedbackType = 'bug' | 'feature' | 'other';

const TYPE_OPTIONS: { value: FeedbackType; label: string; icon: React.ReactNode }[] = [
    { value: 'bug', label: 'Bug Report', icon: <Bug className="h-4 w-4" /> },
    { value: 'feature', label: 'Feature Request', icon: <Lightbulb className="h-4 w-4" /> },
    { value: 'other', label: 'Other', icon: <HelpCircle className="h-4 w-4" /> },
];

export function FeedbackButton() {
    const [isOpen, setIsOpen] = useState(false);
    const [type, setType] = useState<FeedbackType>('feature');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);

    const handleSubmit = async () => {
        if (!message.trim()) return;
        setSending(true);
        try {
            // Post to feedback endpoint (or log if unavailable)
            await fetch(`${API_BASE_URL}/api/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, message }),
            }).catch(() => {
                // Endpoint may not exist — log locally
                if (import.meta.env.DEV) console.log('[Feedback]', { type, message });
            });
            setSent(true);
            setTimeout(() => {
                setIsOpen(false);
                setSent(false);
                setMessage('');
            }, 1500);
        } finally {
            setSending(false);
        }
    };

    return (
        <>
            {/* Floating trigger */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
                aria-label="Send Feedback"
                id="feedback-trigger"
            >
                {isOpen ? <X className="h-5 w-5" /> : <MessageSquarePlus className="h-5 w-5" />}
            </button>

            {/* Feedback form panel */}
            {isOpen && (
                <div className="fixed bottom-20 right-6 z-50 w-80 rounded-xl border border-border bg-background shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200" id="feedback-panel">
                    <div className="p-4 border-b border-border">
                        <h3 className="font-semibold text-sm">Send Feedback</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Help us improve Lead Engine</p>
                    </div>

                    {sent ? (
                        <div className="p-6 text-center">
                            <div className="text-2xl mb-2">🎉</div>
                            <p className="text-sm font-medium">Thanks for your feedback!</p>
                        </div>
                    ) : (
                        <div className="p-4 space-y-3">
                            {/* Type selector */}
                            <div className="flex gap-1">
                                {TYPE_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setType(opt.value)}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition ${type === opt.value
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted text-muted-foreground hover:text-foreground'
                                            }`}
                                    >
                                        {opt.icon}
                                        {opt.label}
                                    </button>
                                ))}
                            </div>

                            {/* Message */}
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Describe your feedback..."
                                className="w-full h-24 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                                id="feedback-message"
                            />

                            {/* Submit */}
                            <Button
                                onClick={handleSubmit}
                                disabled={!message.trim() || sending}
                                className="w-full gap-2"
                                size="sm"
                                id="feedback-submit"
                            >
                                <Send className="h-3.5 w-3.5" />
                                {sending ? 'Sending...' : 'Submit'}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

export default FeedbackButton;
