/**
 * AgentMarkdown — Shared markdown renderer for Agent chat UIs.
 *
 * Handles: **bold**, _italic_, `code`, [links](/path), and external links.
 * Internal links fire onNavigate callback for SPA navigation.
 */
import React from 'react';
import { ExternalLink } from 'lucide-react';

// ── Lightweight Markdown Renderer ──

export function RenderMarkdown({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }) {
    // Split by markdown links: [text](url)
    const parts = text.split(/(\[.*?\]\(.*?\))/);

    return (
        <>
            {parts.map((part, i) => {
                const linkMatch = part.match(/^\[(.+?)\]\((.+?)\)$/);
                if (linkMatch) {
                    const url = linkMatch[2];
                    const isInternal = url.startsWith('/');
                    if (isInternal) {
                        return (
                            <a
                                key={i}
                                href={url}
                                onClick={(e) => { e.preventDefault(); onNavigate(url); }}
                                className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors cursor-pointer"
                            >
                                {renderInline(linkMatch[1])}
                            </a>
                        );
                    }
                    return (
                        <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors"
                        >
                            {renderInline(linkMatch[1])}
                            <ExternalLink className="h-3 w-3 inline-flex flex-shrink-0" />
                        </a>
                    );
                }
                return <span key={i}>{renderInline(part)}</span>;
            })}
        </>
    );
}

export function renderInline(text: string): React.ReactNode[] {
    // Handle **bold**, _italic_, `code`
    const tokens = text.split(/(\*\*.*?\*\*|_.*?_|`.*?`)/);
    return tokens.map((token, i) => {
        if (token.startsWith('**') && token.endsWith('**')) {
            return <strong key={i}>{token.slice(2, -2)}</strong>;
        }
        if (token.startsWith('_') && token.endsWith('_') && token.length > 2) {
            return <em key={i} className="text-muted-foreground">{token.slice(1, -1)}</em>;
        }
        if (token.startsWith('`') && token.endsWith('`')) {
            return (
                <code key={i} className="px-1 py-0.5 rounded bg-background/50 text-xs font-mono text-violet-300">
                    {token.slice(1, -1)}
                </code>
            );
        }
        return token;
    });
}
