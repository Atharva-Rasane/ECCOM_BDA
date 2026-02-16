import 'dotenv/config';
import { appConfig } from './config';

import app from './app';
import db from './database';
import { mailer } from './mailer';
import { initializeDatabase } from './database/seedService';

(async () => {
    await db.sequelize.sync({ alter: true });
    console.log('📖[Database] connected succesfully!');

    // Initialize database with seed data if needed
    try {
        await initializeDatabase();
    } catch (err) {
        console.error('[Database Init Error]:', err);
        // Non-fatal: application continues to start
    }
})().catch((err) => {
    console.log('[DB Connection Error]:', err);
});

(async () => {
    await mailer.verify();
    console.log('📭 Server is ready to send mails');
})().catch((err) => {
    console.log('[Mailer Connection Error]:', err);
});

app.listen(appConfig.PORT, () => {
    console.log(`🔥[Server] listening on port ${appConfig.PORT}`);
});
