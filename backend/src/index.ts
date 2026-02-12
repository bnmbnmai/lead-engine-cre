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

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging in development
if (process.env.NODE_ENV === 'development') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
        next();
    });
}

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
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
});

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
});

export { app, httpServer, socketServer };
