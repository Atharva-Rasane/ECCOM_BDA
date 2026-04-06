import type { Application, Request, Response, NextFunction } from 'express';
import express from 'express';
import passport from 'passport';
import session from 'express-session';
import { appConfig, sessionConfig } from './config';
import authRouter from './routes/authRoute';
import setupPassport from './auth/passportSetup';
import userRouter from './routes/userRoute';
import bodyParser from 'body-parser';
import type { IRequestWithFlashMessages } from './types/requestTypes';
import appErrorHandlerMiddleware from './middlewares/appErrorHandlerMiddleware';
import productRouter from './routes/productRoute';
import adminRouter from './routes/adminRoute';
import {
    ensureAdminUserMiddleware,
    ensureLoggedInMiddleware,
} from './middlewares/authenticationMiddlewares';
import cartRouter from './routes/cartRoute';
import couponRouter from './routes/couponRoute';
import wishlistRouter from './routes/wishlistRoute';
import db from './database';
import cors from 'cors';
import telemetryMiddleware from './middlewares/telemetryMiddleware';
import { logTelemetry } from './telemetry/logger';
import type { RequestWithTelemetry } from './types/telemetry';
import { metricsMiddleware, metricsHandler } from './metrics';
import failureInjectionMiddleware from './middlewares/failureInjectionMiddleware';

const app: Application = express();

app.use(cors({ credentials: true }));
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
app.use(failureInjectionMiddleware);
app.get('/metrics', metricsHandler);

setupPassport();
app.use(passport.initialize());
app.use(passport.session());

app.use((req: IRequestWithFlashMessages, res, next) => {
    // middleware to enable usage of req object in ejs conditional tag
    // for checking authenticated with the req.isAuthenticated() method
    res.locals.req = req;

    // handle flash messages
    res.locals.flashMessages = req.session.flashMessages;
    delete req.session.flashMessages;

    // set default vaue for search word
    res.locals.searchWord = null;
    next();
});

app.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const featuredProducts = await db.products.findAll({
            limit: 5,
            order: [['price', 'DESC']],
        });
        res.render('index', { featuredProducts });
    } catch (err) {
        console.log(err);
        next(err);
    }
});

if (appConfig.AUTH_SERVICE_URL !== '') {
    app.use('/auth', (req, res) => {
        res.redirect(`${appConfig.AUTH_SERVICE_URL}${req.originalUrl}`);
    });
} else {
    app.use('/auth', authRouter);
}
app.use('/user', ensureLoggedInMiddleware, userRouter);

if (appConfig.PRODUCT_SERVICE_URL !== '') {
    app.use('/products', (req, res) => {
        res.redirect(`${appConfig.PRODUCT_SERVICE_URL}${req.originalUrl}`);
    });
} else {
    app.use('/products', productRouter);
}

if (appConfig.CART_SERVICE_URL !== '') {
    app.use('/cart', (req, res) => {
        res.redirect(`${appConfig.CART_SERVICE_URL}${req.originalUrl}`);
    });
} else {
    app.use('/cart', ensureLoggedInMiddleware, cartRouter);
}
app.use('/wishlist', ensureLoggedInMiddleware, wishlistRouter);
app.use(
    '/coupons',
    ensureLoggedInMiddleware,
    ensureAdminUserMiddleware,
    couponRouter
);
app.use(
    '/admin',
    ensureLoggedInMiddleware,
    ensureAdminUserMiddleware,
    adminRouter
);

app.get('/about', (req, res) => {
    res.render('about');
});

// Chaos log endpoint (no side effects, logs only)
app.get('/chaos/log', (req: RequestWithTelemetry, res: Response) => {
    const allowed = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
    const level =
        (req.query.level as string | undefined)?.toUpperCase() ??
        ('INFO' as const);
    const finalLevel = allowed.includes(level as any)
        ? (level as (typeof allowed)[number])
        : 'INFO';
    const category = (req.query.category as string) ?? 'system';
    const event =
        (req.query.event as string) ?? `chaos.${finalLevel.toLowerCase()}`;
    const message =
        (req.query.message as string) ??
        `Chaos log ${finalLevel.toLowerCase()} from app`;

    logTelemetry(req, res, finalLevel, category as any, event, message, {});
    res.json({ status: 'ok', level: finalLevel, category, event });
});

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
