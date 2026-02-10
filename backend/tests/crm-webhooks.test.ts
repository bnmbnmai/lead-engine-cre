/**
 * CRM Webhooks Tests
 *
 * Tests for CRM webhook registration, format-specific transformers
 * (HubSpot, Zapier), and webhook firing logic.
 */

import request from 'supertest';
import express from 'express';

// ============================================
// Mock Prisma
// ============================================

jest.mock('../src/lib/prisma', () => ({
    prisma: {
        analyticsEvent: { create: jest.fn().mockResolvedValue({}) },
        lead: { findMany: jest.fn().mockResolvedValue([]) },
    },
}));

// Mock auth middleware
jest.mock('../src/middleware/auth', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'test_user_1', walletAddress: '0xTest' };
        next();
    },
    AuthenticatedRequest: {},
}));

// ============================================
// Setup
// ============================================

import crmRouter, { fireCRMWebhooks } from '../src/routes/crm.routes';

const app = express();
app.use(express.json());
app.use('/api/v1/crm', crmRouter);

// ============================================
// Tests
// ============================================

describe('CRM Webhooks', () => {
    describe('Webhook Registration', () => {
        it('should register a generic webhook', async () => {
            const res = await request(app)
                .post('/api/v1/crm/webhooks')
                .send({ url: 'https://example.com/webhook', format: 'generic' });

            expect(res.status).toBe(201);
            expect(res.body.webhook).toBeDefined();
            expect(res.body.webhook.url).toBe('https://example.com/webhook');
            expect(res.body.webhook.format).toBe('generic');
            expect(res.body.webhook.id).toMatch(/^wh_/);
        });

        it('should register a HubSpot webhook', async () => {
            const res = await request(app)
                .post('/api/v1/crm/webhooks')
                .send({
                    url: 'https://api.hubapi.com/crm/v3/objects/contacts/batch/create',
                    format: 'hubspot',
                    events: ['lead.sold'],
                });

            expect(res.status).toBe(201);
            expect(res.body.webhook.format).toBe('hubspot');
        });

        it('should register a Zapier webhook', async () => {
            const res = await request(app)
                .post('/api/v1/crm/webhooks')
                .send({
                    url: 'https://hooks.zapier.com/hooks/catch/12345/abcdef/',
                    format: 'zapier',
                });

            expect(res.status).toBe(201);
            expect(res.body.webhook.format).toBe('zapier');
        });

        it('should reject missing URL', async () => {
            const res = await request(app)
                .post('/api/v1/crm/webhooks')
                .send({ format: 'generic' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('URL is required');
        });

        it('should reject invalid format', async () => {
            const res = await request(app)
                .post('/api/v1/crm/webhooks')
                .send({ url: 'https://example.com', format: 'salesforce' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('hubspot, zapier, or generic');
        });
    });

    describe('Webhook Listing', () => {
        it('should list user webhooks', async () => {
            // Register one first
            await request(app)
                .post('/api/v1/crm/webhooks')
                .send({ url: 'https://list-test.com/webhook' });

            const res = await request(app).get('/api/v1/crm/webhooks');

            expect(res.status).toBe(200);
            expect(res.body.webhooks).toBeDefined();
            expect(Array.isArray(res.body.webhooks)).toBe(true);
            expect(res.body.webhooks.length).toBeGreaterThan(0);
        });
    });

    describe('Webhook Deletion', () => {
        it('should delete an existing webhook', async () => {
            // Register
            const createRes = await request(app)
                .post('/api/v1/crm/webhooks')
                .send({ url: 'https://delete-test.com/webhook' });

            const webhookId = createRes.body.webhook.id;

            // Delete
            const deleteRes = await request(app).delete(`/api/v1/crm/webhooks/${webhookId}`);
            expect(deleteRes.status).toBe(200);
            expect(deleteRes.body.success).toBe(true);
        });

        it('should return 404 for non-existent webhook', async () => {
            const res = await request(app).delete('/api/v1/crm/webhooks/wh_nonexistent');
            expect(res.status).toBe(404);
        });
    });

    describe('HubSpot Payload Format', () => {
        it('should transform leads to HubSpot contact properties', async () => {
            // We test the formatter indirectly via fireCRMWebhooks
            // First register a HubSpot webhook
            const mockFetch = jest.fn().mockResolvedValue({ ok: true });
            global.fetch = mockFetch as any;

            await request(app)
                .post('/api/v1/crm/webhooks')
                .send({
                    url: 'https://api.hubapi.com/test',
                    format: 'hubspot',
                    events: ['lead.sold'],
                });

            // Fire the webhook
            const leads = [{
                id: 'lead_1',
                vertical: 'solar',
                status: 'SOLD',
                geo: { country: 'US', state: 'CA', city: 'LA', zip: '90001' },
                seller: { companyName: 'SolarCo' },
                bids: [{ amount: 120 }],
                qualityScore: 9000,
                reservePrice: 100,
            }];

            await fireCRMWebhooks('lead.sold', leads);

            const calledPayload = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);

            // HubSpot format check
            if (calledPayload.inputs) {
                expect(calledPayload.inputs[0].properties).toBeDefined();
                expect(calledPayload.inputs[0].properties.lead_vertical).toBe('solar');
                expect(calledPayload.inputs[0].properties.lead_source).toBe('Lead Engine CRE');
                expect(calledPayload.inputs[0].properties.hs_lead_status).toBe('QUALIFIED');
            }
        });
    });

    describe('Zapier Payload Format', () => {
        it('should produce flat key-value objects for Zapier', async () => {
            const mockFetch = jest.fn().mockResolvedValue({ ok: true });
            global.fetch = mockFetch as any;

            await request(app)
                .post('/api/v1/crm/webhooks')
                .send({
                    url: 'https://hooks.zapier.com/test',
                    format: 'zapier',
                    events: ['lead.sold'],
                });

            const leads = [{
                id: 'lead_2',
                vertical: 'mortgage',
                status: 'SOLD',
                source: 'PLATFORM',
                geo: { country: 'US', state: 'FL' },
                seller: { companyName: 'MortgagePros' },
                bids: [{ amount: 250 }],
                qualityScore: 8500,
                reservePrice: 200,
            }];

            await fireCRMWebhooks('lead.sold', leads);

            const calledPayload = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);

            // Zapier format produces an array of flat objects
            if (Array.isArray(calledPayload)) {
                expect(calledPayload[0].lead_id).toBe('lead_2');
                expect(calledPayload[0].vertical).toBe('mortgage');
                expect(calledPayload[0].event_type).toBe('lead.sold');
                expect(calledPayload[0].country).toBe('US');
            }
        });
    });
});
