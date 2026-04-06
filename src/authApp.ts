import type { Application } from 'express';
import express from 'express';
import passport from 'passport';
import session from 'express-session';
import bodyParser from 'body-parser';
import type { IRequestWithFlashMessages } from './types/requestTypes';
import { appConfig, sessionConfig } from './config';
import setupPassport from './auth/passportSetup';
import authRouter from './routes/authRoute';
import appErrorHandlerMiddleware from './middlewares/appErrorHandlerMiddleware';
import telemetryMiddleware from './middlewares/telemetryMiddleware';
import { logTelemetry } from './telemetry/logger';
import type { RequestWithTelemetry } from './types/telemetry';
import { metricsMiddleware, metricsHandler } from './metrics';

const app: Application = express();

app.set('view engine', 'ejs');

if (appConfig.ENV === 'production') {
    app.set('trust proxy', 1);
}

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));
app.use(session(sessionConfig));
app.use(telemetryMiddleware);
app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);

setupPassport();
app.use(passport.initialize());
app.use(passport.session());

app.use((req: IRequestWithFlashMessages, res, next) => {
    res.locals.req = req;
    res.locals.flashMessages = req.session.flashMessages;
    delete req.session.flashMessages;
    res.locals.searchWord = null;
    next();
});

app.get('/', (_req, res) => {
    res.redirect('/auth/login');
});

// Lightweight error trigger endpoint for chaos/observability testing
// Example: POST /chaos/trigger with optional JSON body { reason: "invalid_credentials" }
app.all('/chaos/trigger', (req, res) => {
    const reason =
        (req.body?.reason as string) ||
        (req.query?.reason as string) ||
        'manual_trigger';
    // System-level chaos log
    logTelemetry(
        req as any,
        res,
        'ERROR',
        'system',
        'chaos.triggered',
        `Chaos trigger fired: ${reason}`,
        { tags: { trigger: 'auth-chaos-endpoint', reason } }
    );
    // Emit a user_session failure event to mirror a login failure
    logTelemetry(
        req as any,
        res,
        'WARN',
        'user_session',
        'user.login.failure',
        `Login failed (chaos trigger): ${reason}`,
        {
            user_session: {
                auth_method: 'password',
                failure_reason: reason,
                ip_address: req.ip,
                device_type: 'web',
            },
        }
    );
    res.status(202).json({ status: 'chaos-triggered', reason });
});

// Chaos log endpoint (logs only, no auth side effects)
app.get('/chaos/log', (req: RequestWithTelemetry, res) => {
    const allowed = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
    const level =
        (req.query.level as string | undefined)?.toUpperCase() ??
        ('INFO' as const);
    const finalLevel = allowed.includes(level as any)
        ? (level as typeof allowed[number])
        : 'INFO';
    const category = (req.query.category as string) ?? 'system';
    const event =
        (req.query.event as string) ?? `chaos.${finalLevel.toLowerCase()}`;
    const message =
        (req.query.message as string) ??
        `Chaos log ${finalLevel.toLowerCase()} from auth`;

    logTelemetry(
        req as any,
        res,
        finalLevel,
        category as any,
        event,
        message,
        {}
    );
    res.json({ status: 'ok', level: finalLevel, category, event });
});

// Chaos log endpoint reachable via ingress at /auth/chaos/log
app.get('/auth/chaos/log', (req: RequestWithTelemetry, res) => {
    const allowed = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
    const level =
        (req.query.level as string | undefined)?.toUpperCase() ?? 'INFO';
    const finalLevel = allowed.includes(level as any)
        ? (level as typeof allowed[number])
        : 'INFO';
    const category = (req.query.category as string) ?? 'system';
    const event = (req.query.event as string) ?? `chaos.${finalLevel.toLowerCase()}`;
    const message =
        (req.query.message as string) ??
        `Chaos log ${finalLevel.toLowerCase()} from auth`;

    logTelemetry(req as any, res, finalLevel, category as any, event, message, {});
    res.json({ status: 'ok', level: finalLevel, category, event });
});

app.use('/auth', authRouter);

app.use((req, res) => {
    res.status(404).render('error', {
        error: {
            title: 'Page not found.',
            message: 'Click the link below :)',
        },
    });
});

app.use(appErrorHandlerMiddleware);

export default app;
