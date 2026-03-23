import { initTracing } from './tracing';
initTracing(process.env.SERVICE_NAME ?? 'app-service');

import 'dotenv/config';
import { appConfig } from './config';
import app from './app';
import db from './database';
import { mailer } from './mailer';
import { initializeDatabase } from './database/seedService';

async function bootstrap(): Promise<void> {
    try {
        await db.sequelize.authenticate();
        await db.sequelize.sync({ alter: true });
        console.log('[Database] connected succesfully!');

        await initializeDatabase();

        try {
            await mailer.verify();
            console.log('Server is ready to send mails');
        } catch (mailErr) {
            console.warn('[Mail Warning]: Mail service unavailable, email features will not work.', mailErr);
        }

        app.listen(appConfig.PORT, () => {
            console.log(`[Server] listening on port ${appConfig.PORT}`);
        });
    } catch (err) {
        console.error('[Startup Error]:', err);
        // Exit so Kubernetes restarts the pod when dependencies (e.g., Postgres) are not yet reachable.
        process.exit(1);
    }
}

void bootstrap();
