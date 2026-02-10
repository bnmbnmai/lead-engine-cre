import { useState, createContext, useContext, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================
// Accordion Context
// ============================================

interface AccordionContextValue {
    openItems: Set<string>;
    toggle: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextValue>({
    openItems: new Set(),
    toggle: () => { },
});

// ============================================
// Accordion Root
// ============================================

interface AccordionProps {
    children: ReactNode;
    defaultOpen?: string[];
    className?: string;
}

export function Accordion({ children, defaultOpen = [], className }: AccordionProps) {
    const [openItems, setOpenItems] = useState<Set<string>>(new Set(defaultOpen));

    const toggle = (id: string) => {
        setOpenItems((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    return (
        <AccordionContext.Provider value={{ openItems, toggle }}>
            <div className={cn('space-y-3', className)}>{children}</div>
        </AccordionContext.Provider>
    );
}

// ============================================
// Accordion Item
// ============================================

interface AccordionItemProps {
    id: string;
    children: ReactNode;
    className?: string;
}

export function AccordionItem({ id, children, className }: AccordionItemProps) {
    return (
        <div
            className={cn(
                'rounded-xl border border-border/50 bg-card overflow-hidden transition-colors',
                className
            )}
            data-accordion-item={id}
        >
            {children}
        </div>
    );
}

// ============================================
// Accordion Trigger
// ============================================

interface AccordionTriggerProps {
    id: string;
    children: ReactNode;
    className?: string;
}

export function AccordionTrigger({ id, children, className }: AccordionTriggerProps) {
    const { openItems, toggle } = useContext(AccordionContext);
    const isOpen = openItems.has(id);

    return (
        <button
            type="button"
            onClick={() => toggle(id)}
            className={cn(
                'flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/50',
                isOpen && 'border-b border-border/50',
                className
            )}
        >
            <div className="flex-1">{children}</div>
            <ChevronDown
                className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                    isOpen && 'rotate-180'
                )}
            />
        </button>
    );
}

// ============================================
// Accordion Content
// ============================================

interface AccordionContentProps {
    id: string;
    children: ReactNode;
    className?: string;
}

export function AccordionContent({ id, children, className }: AccordionContentProps) {
    const { openItems } = useContext(AccordionContext);
    const isOpen = openItems.has(id);

    if (!isOpen) return null;

    return (
        <div
            className={cn('px-5 py-4 animate-in fade-in-0 slide-in-from-top-1 duration-200', className)}
        >
            {children}
        </div>
    );
}
