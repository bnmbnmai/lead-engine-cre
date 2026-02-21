import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import swaggerUi from 'swagger-ui-express';
import { prisma } from './lib/prisma';
import RTBSocketServer from './rtb/socket';
import { startQuarterlyResetCron } from './services/quarterly-reset.service';
import { resolveExpiredAuctions } from './services/auction-closure.service';

// Load environment variables FIRST
dotenv.config();

// ─── Sentry Monitoring ───────────────────────────────────────
let Sentry: any = null;
if (process.env.SENTRY_DSN) {
    try {
        Sentry = require('@sentry/node');
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'development',
            tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
            integrations: [
                ...(Sentry.autoDiscoverNodePerformanceMonitoringIntegrations?.() ?? []),
            ],
            beforeSend(event: any) {
                // Scrub PII from Sentry events
                if (event.request?.data) {
                    const sensitive = ['ssn', 'password', 'privateKey', 'secret'];
                    for (const key of sensitive) {
                        if (event.request.data[key]) event.request.data[key] = '[REDACTED]';
                    }
                }
                return event;
            },
        });
        console.log('  ✅ Sentry monitoring initialized');
    } catch {
        console.log('  ⚠️  Sentry SDK not installed — monitoring disabled');
        Sentry = null;
    }
}
export { Sentry };
// ─────────────────────────────────────────────────────────────

// Routes
import authRoutes from './routes/auth.routes';
import marketplaceRoutes from './routes/marketplace.routes';
import biddingRoutes from './routes/bidding.routes';
import analyticsRoutes from './routes/analytics.routes';
import integrationRoutes from './routes/integration.routes';
import crmRoutes from './routes/crm.routes';
import landerRoutes from './routes/lander.routes';
import demoPanelRoutes from './routes/demo-panel.routes';
import verticalRoutes from './routes/vertical.routes';
import buyerRoutes from './routes/buyer.routes';
import mcpRoutes from './routes/mcp.routes';
import vaultRoutes from './routes/vault.routes';

// Middleware
import { generalLimiter } from './middleware/rateLimit';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// Initialize Socket.IO
const socketServer = new RTBSocketServer(httpServer);
app.set('io', socketServer.getIO());  // Expose to Express routes via req.app.get('io')

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "ws:"],
        },
    },
}));

const ALLOWED_ORIGINS = [
    'https://lead-engine-cre-frontend.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) {
            callback(null, true);
            return;
        }
        // Only allow explicitly listed origins — reject everything else.
        // SECURITY: The previous fallback callback(null, true) allowed all origins,
        // bypassing CORS entirely. In production this would allow any site to make
        // credentialed cross-origin requests on behalf of logged-in users.
        if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: origin '${origin}' is not in the allowlist`));
        }
    },
    credentials: true,
}));

// Enable CORS preflight for ALL routes — must come immediately after cors() middleware.
// app.options('*', cors()) is the standard Express pattern that handles OPTIONS for any
// path depth (e.g. /api/v1/demo-panel/full-e2e/results/latest). This supersedes the
// per-path handler that used /:rest* which did NOT match multi-segment subpaths.
app.options('*', cors({ origin: (o, cb) => cb(null, true), credentials: true }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── BigInt-safe JSON serialization ──────────────────────────────────────────
// Express res.json() uses JSON.stringify() which throws on BigInt values.
// ethers.js returns BigInt for gasUsed, lock IDs, USDC amounts, etc.
// This middleware replaces res.json with a version that safely converts
// BigInt → string before serialization. Applied globally to ALL routes.
app.use((_req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
        const safe = JSON.parse(
            JSON.stringify(body, (_key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            )
        );
        return originalJson(safe);
    };
    next();
});
// ─────────────────────────────────────────────────────────────────────────────

// Request logging in development
if (process.env.NODE_ENV === 'development') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
        next();
    });
}

// Health check endpoint
const healthHandler = async (_req: Request, res: Response) => {
    try {
        // Check database connection
        await prisma.$queryRaw`SELECT 1`;

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '1.1.0',
            service: 'lead-engine-cre-api',
            database: 'connected',
            socket: 'active',
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
        });
    }
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Swagger UI — serve OpenAPI docs
try {
    const swaggerYaml = readFileSync(join(__dirname, '..', 'swagger.yaml'), 'utf-8');
    // Parse YAML manually (simple key-value for swagger-ui-express)
    const swaggerJson = JSON.parse(JSON.stringify(
        require('js-yaml')?.load?.(swaggerYaml) ?? {}
    ));
    app.use('/api/swagger', swaggerUi.serve, swaggerUi.setup(swaggerJson, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Lead Engine CRE — API Docs',
    }));
} catch {
    // Fallback: serve raw YAML if js-yaml not available
    app.get('/api/swagger', (_req: Request, res: Response) => {
        try {
            const yaml = readFileSync(join(__dirname, '..', 'swagger.yaml'), 'utf-8');
            res.type('text/yaml').send(yaml);
        } catch {
            res.status(404).json({ error: 'swagger.yaml not found' });
        }
    });
}

// API v1 routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', generalLimiter, marketplaceRoutes);
app.use('/api/v1/bids', biddingRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/demo', integrationRoutes);
app.use('/api/v1/crm', crmRoutes);
app.use('/api/v1/lander', landerRoutes);
app.use('/api/v1/demo-panel', demoPanelRoutes);
app.use('/api/v1/verticals', verticalRoutes);
app.use('/api/v1/buyer', buyerRoutes);
app.use('/api/v1/buyer/vault', vaultRoutes);
app.use('/api/v1/mcp', mcpRoutes);


app.post('/api/v1/rtb/bid', (req: Request, res: Response) => {
    res.redirect(307, '/api/v1/bids');
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

    // Report to Sentry
    if (Sentry) {
        Sentry.captureException(err);
    }

    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
        timestamp: new Date().toISOString(),
    });
});

// 404 handler
app.use((_req: Request, res: Response) => {
    res.status(404).json({
        error: 'Not found',
        timestamp: new Date().toISOString(),
    });
});

// Graceful shutdown
const shutdown = async () => {
    console.log('\nShutting down gracefully...');

    try {
        await prisma.$disconnect();
        console.log('Database disconnected');

        httpServer.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    } catch (error) {
        console.error('Shutdown error:', error);
        process.exit(1);
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
httpServer.listen(PORT, () => {
    console.log(`
  🚀 Lead Engine CRE API Server
  ────────────────────────────
  Environment: ${process.env.NODE_ENV || 'development'}
  Port:        ${PORT}
  Health:      http://localhost:${PORT}/health
  API:         http://localhost:${PORT}/api/v1
  WebSocket:   ws://localhost:${PORT}
  ────────────────────────────
  Endpoints:
    Auth:        /api/v1/auth/*
    Marketplace: /api/v1/asks, /api/v1/leads/*
    Bidding:     /api/v1/bids/*
    Swagger:     http://localhost:${PORT}/api/swagger
    Analytics:   /api/v1/analytics/*
    CRM Export:  /api/v1/crm/*
  ────────────────────────────
  `);

    // Start quarterly lease reset cron (daily at midnight UTC)
    startQuarterlyResetCron();

    // Sweep any auctions that expired during downtime
    resolveExpiredAuctions()
        .then((count) => { if (count > 0) console.log(`  ✅ Resolved ${count} expired auctions on startup`); })
        .catch((err) => console.error('  ⚠️  Startup auction sweep failed:', err));
});

export { app, httpServer, socketServer };
