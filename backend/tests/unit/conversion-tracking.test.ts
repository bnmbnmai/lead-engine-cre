/**
 * Conversion Tracking Service — Unit Tests
 * ──────────────────────────────────────────
 * 15 tests covering:
 *   - Pixel fires GET to configured URL
 *   - Webhook fires POST with correct JSON payload
 *   - No calls when URLs are null
 *   - Timeout/errors are caught silently
 *   - Payload shape matches spec
 *   - Seller not found handling
 */

// ── Mocks ──────────────────────────────────

const mockFindUnique = jest.fn();

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        sellerProfile: {
            findUnique: (...args: any[]) => mockFindUnique(...args),
        },
    },
}));

// Mock global fetch
const mockFetch = jest.fn().mockResolvedValue({ status: 200 });
(global as any).fetch = mockFetch;

// ── Import after mocks ─────────────────────

import { fireConversionEvents, ConversionPayload } from '../../src/services/conversion-tracking.service';

// ── Helpers ────────────────────────────────

function samplePayload(overrides: Partial<ConversionPayload> = {}): ConversionPayload {
    return {
        event: 'lead_sold',
        lead_id: 'lead_123',
        sale_amount: 45.00,
        platform_fee: 1.125,
        vertical: 'mortgage.refinance',
        geo: 'US-TX',
        quality_score: 9200,
        transaction_id: 'tx_abc',
        sold_at: '2026-02-14T00:00:00.000Z',
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ status: 200 });
});

describe('Conversion Tracking Service', () => {

    // ── Seller Not Found ───────────────────

    test('1. returns false/false when seller not found', async () => {
        mockFindUnique.mockResolvedValue(null);
        const result = await fireConversionEvents('nonexistent', samplePayload());
        expect(result).toEqual({ pixelFired: false, webhookFired: false });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    // ── No URLs Configured ─────────────────

    test('2. returns false/false when no URLs configured', async () => {
        mockFindUnique.mockResolvedValue({ conversionPixelUrl: null, conversionWebhookUrl: null });
        const result = await fireConversionEvents('seller_1', samplePayload());
        expect(result).toEqual({ pixelFired: false, webhookFired: false });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    test('3. empty strings treated as no URL', async () => {
        mockFindUnique.mockResolvedValue({ conversionPixelUrl: '', conversionWebhookUrl: '' });
        const result = await fireConversionEvents('seller_1', samplePayload());
        // Empty string is falsy, so no calls
        expect(result).toEqual({ pixelFired: false, webhookFired: false });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    // ── Pixel Only ─────────────────────────

    test('4. fires pixel GET when pixelUrl is set', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: 'https://pixel.example.com/track',
            conversionWebhookUrl: null,
        });
        const result = await fireConversionEvents('seller_1', samplePayload());
        expect(result.pixelFired).toBe(true);
        expect(result.webhookFired).toBe(false);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
            'https://pixel.example.com/track',
            expect.objectContaining({ method: 'GET' }),
        );
    });

    // ── Webhook Only ───────────────────────

    test('5. fires webhook POST when webhookUrl is set', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: null,
            conversionWebhookUrl: 'https://hooks.example.com/lead-sold',
        });
        const payload = samplePayload();
        const result = await fireConversionEvents('seller_1', payload);
        expect(result.webhookFired).toBe(true);
        expect(result.pixelFired).toBe(false);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
            'https://hooks.example.com/lead-sold',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }),
        );
    });

    // ── Both URLs ──────────────────────────

    test('6. fires both pixel and webhook when both configured', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: 'https://pixel.example.com/track',
            conversionWebhookUrl: 'https://hooks.example.com/lead-sold',
        });
        const result = await fireConversionEvents('seller_1', samplePayload());
        expect(result).toEqual({ pixelFired: true, webhookFired: true });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // ── Pixel Error Handling ───────────────

    test('7. pixel failure is caught silently', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: 'https://pixel.example.com/track',
            conversionWebhookUrl: null,
        });
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        const result = await fireConversionEvents('seller_1', samplePayload());
        expect(result.pixelFired).toBe(false);
        // Should not throw
    });

    // ── Webhook Error Handling ──────────────

    test('8. webhook failure is caught silently', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: null,
            conversionWebhookUrl: 'https://hooks.example.com/lead-sold',
        });
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
        const result = await fireConversionEvents('seller_1', samplePayload());
        expect(result.webhookFired).toBe(false);
    });

    test('9. pixel fails but webhook still fires', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: 'https://pixel.example.com/track',
            conversionWebhookUrl: 'https://hooks.example.com/lead-sold',
        });
        mockFetch
            .mockRejectedValueOnce(new Error('Pixel timeout'))
            .mockResolvedValueOnce({ status: 200 });
        const result = await fireConversionEvents('seller_1', samplePayload());
        expect(result.pixelFired).toBe(false);
        expect(result.webhookFired).toBe(true);
    });

    // ── Payload Shape ──────────────────────

    test('10. webhook payload contains all required fields', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: null,
            conversionWebhookUrl: 'https://hooks.example.com/lead-sold',
        });
        const payload = samplePayload();
        await fireConversionEvents('seller_1', payload);
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body).toHaveProperty('event', 'lead_sold');
        expect(body).toHaveProperty('lead_id', 'lead_123');
        expect(body).toHaveProperty('sale_amount', 45.00);
        expect(body).toHaveProperty('platform_fee', 1.125);
        expect(body).toHaveProperty('vertical', 'mortgage.refinance');
        expect(body).toHaveProperty('geo', 'US-TX');
        expect(body).toHaveProperty('quality_score', 9200);
        expect(body).toHaveProperty('transaction_id', 'tx_abc');
        expect(body).toHaveProperty('sold_at');
    });

    test('11. webhook event is always "lead_sold"', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: null,
            conversionWebhookUrl: 'https://hooks.example.com/lead-sold',
        });
        await fireConversionEvents('seller_1', samplePayload());
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('lead_sold');
    });

    // ── Prisma Query ───────────────────────

    test('12. queries sellerProfile with correct id and select', async () => {
        mockFindUnique.mockResolvedValue(null);
        await fireConversionEvents('seller_xyz', samplePayload());
        expect(mockFindUnique).toHaveBeenCalledWith({
            where: { id: 'seller_xyz' },
            select: { conversionPixelUrl: true, conversionWebhookUrl: true },
        });
    });

    // ── AbortSignal usage ──────────────────

    test('13. pixel request includes AbortSignal', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: 'https://pixel.example.com/track',
            conversionWebhookUrl: null,
        });
        await fireConversionEvents('seller_1', samplePayload());
        const fetchOptions = mockFetch.mock.calls[0][1];
        expect(fetchOptions.signal).toBeDefined();
    });

    test('14. webhook request includes AbortSignal', async () => {
        mockFindUnique.mockResolvedValue({
            conversionPixelUrl: null,
            conversionWebhookUrl: 'https://hooks.example.com/lead-sold',
        });
        await fireConversionEvents('seller_1', samplePayload());
        const fetchOptions = mockFetch.mock.calls[0][1];
        expect(fetchOptions.signal).toBeDefined();
    });

    // ── Multiple calls are independent ─────

    test('15. separate calls for different sellers are independent', async () => {
        mockFindUnique
            .mockResolvedValueOnce({ conversionPixelUrl: 'https://pixel1.com', conversionWebhookUrl: null })
            .mockResolvedValueOnce({ conversionPixelUrl: null, conversionWebhookUrl: 'https://webhook2.com' });

        const r1 = await fireConversionEvents('seller_1', samplePayload({ lead_id: 'lead_a' }));
        const r2 = await fireConversionEvents('seller_2', samplePayload({ lead_id: 'lead_b' }));

        expect(r1).toEqual({ pixelFired: true, webhookFired: false });
        expect(r2).toEqual({ pixelFired: false, webhookFired: true });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
});
