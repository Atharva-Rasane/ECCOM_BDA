import type { Application } from 'express';
import express from 'express';
import passport from 'passport';
import session from 'express-session';
import bodyParser from 'body-parser';
import type { IRequestWithFlashMessages } from './types/requestTypes';
import { appConfig, sessionConfig } from './config';
import setupPassport from './auth/passportSetup';
import cartRouter from './routes/cartRoute';
import { ensureLoggedInMiddleware } from './middlewares/authenticationMiddlewares';
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

// Chaos log endpoint reachable via ingress at /cart/chaos/log
app.get('/cart/chaos/log', (req: RequestWithTelemetry, res) => {
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
        `Chaos log ${finalLevel.toLowerCase()} from cart`;

    logTelemetry(req as any, res, finalLevel, category as any, event, message, {});
    res.json({ status: 'ok', level: finalLevel, category, event });
});

app.use('/cart', ensureLoggedInMiddleware, cartRouter);

// Chaos log endpoint
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
        `Chaos log ${finalLevel.toLowerCase()} from cart`;

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

app.use((_req, res) => {
    res.status(404).render('error', {
        error: {
            title: 'Page not found.',
            message: 'Click the link below :)',
        },
    });
});

app.use(appErrorHandlerMiddleware);

export default app;
