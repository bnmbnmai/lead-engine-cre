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
    const lines = text.split('\n');
    const output: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // ── H2 heading ──
        if (line.startsWith('## ')) {
            output.push(<h4 key={i} className="font-bold text-[11px] uppercase tracking-wider text-foreground/80 mt-3 mb-1">{renderInline(line.slice(3))}</h4>);
            i++; continue;
        }
        // ── H3 heading ──
        if (line.startsWith('### ')) {
            output.push(<h5 key={i} className="font-semibold text-[11px] text-foreground/70 mt-2 mb-0.5">{renderInline(line.slice(4))}</h5>);
            i++; continue;
        }

        // ── Table block ──
        if (line.startsWith('|')) {
            const tableLines: string[] = [];
            while (i < lines.length && lines[i].startsWith('|')) {
                tableLines.push(lines[i]);
                i++;
            }
            const rows = tableLines
                .filter(l => !l.match(/^[\s|:-]+$/))
                .map(l => l.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim()));
            if (rows.length > 0) {
                output.push(
                    <div key={`table-${i}`} className="overflow-x-auto my-1.5">
                        <table className="w-full text-[11px] border-collapse">
                            <thead>
                                <tr>{rows[0].map((cell, ci) => <th key={ci} className="px-2 py-1 text-left font-semibold text-foreground/80 border-b border-border/50">{renderInline(cell)}</th>)}</tr>
                            </thead>
                            <tbody>
                                {rows.slice(1).map((row, ri) => (
                                    <tr key={ri} className="border-b border-border/20 hover:bg-white/[0.02]">
                                        {row.map((cell, ci) => <td key={ci} className="px-2 py-1 text-muted-foreground">{renderInline(cell)}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            }
            continue;
        }

        // ── Bullet list block ──
        if (line.match(/^[•\-*] /) || line.match(/^\d+\. /)) {
            const listItems: string[] = [];
            const isOrdered = line.match(/^\d+\. /);
            while (i < lines.length && (lines[i].match(/^[•\-*] /) || lines[i].match(/^\d+\. /))) {
                listItems.push(lines[i].replace(/^[•\-*] /, '').replace(/^\d+\. /, ''));
                i++;
            }
            const Tag = isOrdered ? 'ol' : 'ul';
            output.push(
                <Tag key={`list-${i}`} className={`my-1 pl-3 space-y-0.5 text-[11px] ${isOrdered ? 'list-decimal' : 'list-disc'}`}>
                    {listItems.map((item, li) => <li key={li} className="text-foreground/90">{renderInlineWithLinks(item, onNavigate)}</li>)}
                </Tag>
            );
            continue;
        }

        // ── Horizontal rule ──
        if (line.match(/^---+$/) || line.match(/^===+$/)) {
            output.push(<hr key={i} className="border-border/40 my-2" />);
            i++; continue;
        }

        // ── Blank line ──
        if (line.trim() === '') {
            if (output.length > 0) output.push(<br key={i} />);
            i++; continue;
        }

        // ── Normal paragraph text (may have inline links) ──
        output.push(<span key={i} className="block">{renderInlineWithLinks(line, onNavigate)}</span>);
        i++;
    }

    return <>{output}</>;
}

// Inline renderer that also handles [link](url) patterns
function renderInlineWithLinks(text: string, onNavigate: (path: string) => void): React.ReactNode[] {
    const parts = text.split(/(\[.*?\]\(.*?\))/);
    return parts.map((part, i) => {
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
    });
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
