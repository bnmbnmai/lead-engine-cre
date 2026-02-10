import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { prisma } from './lib/prisma';
import RTBSocketServer from './rtb/socket';

// Routes
import authRoutes from './routes/auth.routes';
import marketplaceRoutes from './routes/marketplace.routes';
import biddingRoutes from './routes/bidding.routes';
import analyticsRoutes from './routes/analytics.routes';
import integrationRoutes from './routes/integration.routes';

// Middleware
import { generalLimiter } from './middleware/rateLimit';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// Initialize Socket.IO
const socketServer = new RTBSocketServer(httpServer);

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
            version: '1.0.0',
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

// API v1 routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', generalLimiter, marketplaceRoutes);
app.use('/api/v1/bids', biddingRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/demo', integrationRoutes);

// Legacy endpoints (backward compatibility)
app.get('/api/v1/leads', (_req: Request, res: Response) => {
    res.redirect(307, '/api/v1/leads');
});

app.post('/api/v1/rtb/bid', (req: Request, res: Response) => {
    res.redirect(307, '/api/v1/bids');
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

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
    Analytics:   /api/v1/analytics/*
  ────────────────────────────
  `);
});

export { app, httpServer, socketServer };
