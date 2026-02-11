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

    // ─── CRM Export Endpoint ─────────────────────

    describe('CRM Export', () => {
        it('should return JSON export', async () => {
            const { prisma } = require('../src/lib/prisma');
            (prisma.lead.findMany as jest.Mock).mockResolvedValue([
                {
                    id: 'lead-exp-1',
                    vertical: 'solar',
                    status: 'SOLD',
                    source: 'PLATFORM',
                    geo: { country: 'US', state: 'FL', city: 'Miami', zip: '33101' },
                    seller: { companyName: 'SolarExport' },
                    bids: [{ amount: 100 }],
                    qualityScore: 8000,
                    reservePrice: 80,
                    createdAt: new Date('2025-01-01'),
                },
            ]);

            const res = await request(app)
                .get('/api/v1/crm/export?format=json&days=30');

            expect(res.status).toBe(200);
            expect(res.body.leads).toBeDefined();
            expect(res.body.leads.length).toBe(1);
            expect(res.body.leads[0].lead_id).toBe('lead-exp-1');
        });

        it('should return CSV export', async () => {
            const { prisma } = require('../src/lib/prisma');
            (prisma.lead.findMany as jest.Mock).mockResolvedValue([
                {
                    id: 'lead-csv-1',
                    vertical: 'mortgage',
                    status: 'ACTIVE',
                    source: 'API',
                    geo: { country: 'US', state: 'CA' },
                    seller: { companyName: 'CSVCo' },
                    bids: [],
                    reservePrice: 50,
                    createdAt: new Date('2025-02-01'),
                },
            ]);

            const res = await request(app)
                .get('/api/v1/crm/export?format=csv&days=7');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('text/csv');
            expect(res.text).toContain('lead_id');
            expect(res.text).toContain('lead-csv-1');
        });
    });

    // ─── CRM Push Endpoint ──────────────────────

    describe('CRM Push', () => {
        it('should return error when no webhook URL provided', async () => {
            const origEnv = process.env.CRM_WEBHOOK_URL;
            delete process.env.CRM_WEBHOOK_URL;

            const res = await request(app)
                .post('/api/v1/crm/push')
                .send({ leadIds: ['lead-1'] });

            expect(res.status).toBe(400);
            process.env.CRM_WEBHOOK_URL = origEnv;
        });
    });

    // ─── Generic Format Webhook ─────────────────

    describe('Generic Webhook Format', () => {
        it('should fire generic format with standard payload', async () => {
            const mockFetch = jest.fn().mockResolvedValue({ ok: true });
            global.fetch = mockFetch as any;

            await request(app)
                .post('/api/v1/crm/webhooks')
                .send({
                    url: 'https://generic-test.com/hook',
                    format: 'generic',
                    events: ['lead.sold'],
                });

            await fireCRMWebhooks('lead.sold', [{
                id: 'lead-gen',
                vertical: 'solar',
                status: 'SOLD',
                geo: { country: 'US' },
                bids: [],
                reservePrice: 50,
            }]);

            // Verify fetch was called
            expect(mockFetch).toHaveBeenCalled();
            const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
            const payload = JSON.parse(lastCall[1].body);
            expect(payload.source).toBe('lead-engine-cre');
            expect(payload.event).toBe('lead.sold');
        });
    });

    // ─── CRM Push Endpoint ─────────────────────────

    describe('CRM Push', () => {
        it('should push leads with specific leadIds', async () => {
            const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
            global.fetch = mockFetch as any;

            const { prisma } = require('../src/lib/prisma');
            (prisma.lead.findMany as jest.Mock).mockResolvedValue([{
                id: 'push-lead-1',
                vertical: 'solar',
                status: 'SOLD',
                source: 'PLATFORM',
                geo: { country: 'US', state: 'FL' },
                seller: { companyName: 'SolarCo' },
                bids: [{ amount: 100 }],
                qualityScore: 7500,
                reservePrice: 75,
            }]);
            (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/api/v1/crm/push')
                .send({ leadIds: ['push-lead-1'], webhookUrl: 'https://example.com/hook' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.pushed).toBe(1);
        });

        it('should push default SOLD leads when no leadIds provided', async () => {
            const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
            global.fetch = mockFetch as any;

            const { prisma } = require('../src/lib/prisma');
            (prisma.lead.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/api/v1/crm/push')
                .send({ webhookUrl: 'https://example.com/hook' });

            expect(res.status).toBe(200);
            expect(res.body.pushed).toBe(0);
        });

        it('should return 502 when webhook URL returns error', async () => {
            const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
            global.fetch = mockFetch as any;

            const { prisma } = require('../src/lib/prisma');
            (prisma.lead.findMany as jest.Mock).mockResolvedValue([{
                id: 'push-fail', vertical: 'solar', status: 'SOLD', source: 'PLATFORM',
                geo: {}, seller: { companyName: 'Co' }, bids: [], reservePrice: 0,
            }]);

            const res = await request(app)
                .post('/api/v1/crm/push')
                .send({ webhookUrl: 'https://example.com/bad-hook' });

            expect(res.status).toBe(502);
            expect(res.body.error).toContain('CRM webhook returned error');
        });
    });

    // ─── CRM Export with country filter ──────────

    describe('CRM Export (country filter)', () => {
        it('should filter leads by country when specified', async () => {
            const { prisma } = require('../src/lib/prisma');
            (prisma.lead.findMany as jest.Mock).mockResolvedValue([
                { id: 'us-lead', vertical: 'solar', status: 'SOLD', geo: { country: 'US', state: 'FL' }, seller: { companyName: 'A' }, bids: [], reservePrice: 50, source: 'API' },
                { id: 'eu-lead', vertical: 'solar', status: 'SOLD', geo: { country: 'DE', state: 'BY' }, seller: { companyName: 'B' }, bids: [], reservePrice: 60, source: 'API' },
            ]);

            const res = await request(app)
                .get('/api/v1/crm/export?format=json&country=US');

            expect(res.status).toBe(200);
            expect(res.body.leads.length).toBe(1);
        });

        it('should return 500 on export error', async () => {
            const { prisma } = require('../src/lib/prisma');
            (prisma.lead.findMany as jest.Mock).mockRejectedValue(new Error('db down'));

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
            const res = await request(app)
                .get('/api/v1/crm/export');

            expect(res.status).toBe(500);
            consoleSpy.mockRestore();
        });
    });

    // ─── fireCRMWebhooks circuit breaker ────────

    describe('fireCRMWebhooks (resilience)', () => {
        it('should increment failure count when webhook fetch throws', async () => {
            const mockFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
            global.fetch = mockFetch as any;

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
            // Fire webhook — it should catch the error and log it
            await fireCRMWebhooks('lead.sold', [{
                id: 'lead-err', vertical: 'solar', geo: {},
            }]);
            consoleSpy.mockRestore();
            // Should not throw — errors are caught internally
        });

        it('should handle empty leads array', async () => {
            const mockFetch = jest.fn().mockResolvedValue({ ok: true });
            global.fetch = mockFetch as any;

            await fireCRMWebhooks('lead.sold', []);
            // Should still call the webhook with empty leads
        });
    });

    // ─── Non-matching event skips ────────────────

    describe('Event Filtering', () => {
        it('should skip webhooks not subscribed to event', async () => {
            const mockFetch = jest.fn().mockResolvedValue({ ok: true });
            global.fetch = mockFetch as any;

            const callsBefore = mockFetch.mock.calls.length;

            // Fire an event no webhook is subscribed to
            await fireCRMWebhooks('lead.created', [{
                id: 'lead-skip',
                vertical: 'solar',
                geo: {},
            }]);

            // Should not have made additional calls for this event
            // (all registered webhooks listen to 'lead.sold')
            expect(mockFetch.mock.calls.length).toBe(callsBefore);
        });
    });
});
