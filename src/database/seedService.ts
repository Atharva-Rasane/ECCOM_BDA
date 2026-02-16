import 'dotenv/config';
import db from '.';
import { seedDatabase } from './seed';

/**
 * Check if the database has already been seeded
 */
async function isDatabaseSeeded(): Promise<boolean> {
    try {
        const productCount = await db.products.count();
        return productCount > 0;
    } catch (error) {
        console.error('[Database Init] Error checking seed status:', error);
        return false;
    }
}

/**
 * Initialize database with seed data if needed
 */
export async function initializeDatabase(): Promise<void> {
    // Check if auto-seeding is enabled
    const autoSeedEnabled = process.env.AUTO_SEED_DB !== 'false';

    if (!autoSeedEnabled) {
        console.log('[Database Init] Auto-seeding disabled via environment variable');
        return;
    }

    console.log('[Database Init] Checking if database needs seeding...');

    // Check if already seeded
    const isSeeded = await isDatabaseSeeded();

    if (isSeeded) {
        console.log('[Database Init] Database already seeded, skipping...');
        return;
    }

    // Run seeding
    console.log('[Database Init] Seeding database with initial data...');
    try {
        await seedDatabase();
        console.log('[Database Init] Database seeded successfully!');
    } catch (error) {
        console.error('[Database Init Error]:', error);
        throw error; // Propagate error for server.ts to handle
    }
}
