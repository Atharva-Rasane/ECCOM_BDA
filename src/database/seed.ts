import 'dotenv/config';
import db from '.';
import mailerConfig from '../config/mailerConfig';
import { PRODUCT_CATEGORIES, PRODUCT_SIZES } from '../constants';
import { type ProductAttributes } from '../types/models/productTypes';
import { faker } from '@faker-js/faker';
import { UserRoleEnum } from '../types/models/userTypes';

/**
 * Generate seed data and populate database
 */
export async function seedDatabase(): Promise<void> {
    const products = [] as ProductAttributes[];
    for (let i = 0; i < 15; i++) {
        products.push({
            name: faker.commerce.productName(),
            price: faker.number.float({ min: 5, max: 1000, fractionDigits: 2 }),
            category: faker.helpers.arrayElement(PRODUCT_CATEGORIES),
            sizes: faker.helpers.arrayElements(Object.keys(PRODUCT_SIZES)),
            shortDescription: faker.word.words({ count: { min: 3, max: 10 } }),
            longDescription: faker.commerce.productDescription(),
            available: faker.datatype.boolean(),
            imageURL: faker.image.urlLoremFlickr({ category: 'clothes' }),
        });
    }

    const adminEmail = mailerConfig.MAILER_USER;
    if (adminEmail === '' || adminEmail == null) {
        throw Error('No mailer user/email has been set');
    }

    await db.users.update(
        { role: UserRoleEnum.admin },
        {
            where: {
                email: mailerConfig.MAILER_USER,
            },
        }
    );

    await db.products.bulkCreate(products);
}

// CLI execution support
if (require.main === module) {
    seedDatabase()
        .then(() => {
            console.log('[DB Seeding] successful');
            process.exit(0);
        })
        .catch((err) => {
            console.log('[DB Seeding Error]:', err);
            process.exit(1);
        });
}
