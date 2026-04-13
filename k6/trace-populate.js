/**
 * trace-populate.js
 *
 * Generates trace data across all services so the Jaeger dashboard has
 * something to show. Hits every major route so you get spans for:
 *   app-service → product-service  (browsing)
 *   app-service → auth-service     (signup / login / logout)
 *   app-service → cart-service     (add to cart / checkout)
 *
 * Run with:  k6 run k6/trace-populate.js
 */

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = 'http://34.122.199.244.nip.io';

const errorRate = new Rate('error_rate');

export const options = {
    scenarios: {
        // Browsing traffic — generates app-service → product-service spans
        browsing: {
            executor: 'constant-vus',
            vus: 5,
            duration: '2m',
            exec: 'browse',
        },
        // Full purchase flow — generates spans across auth + cart + product
        purchase: {
            executor: 'constant-vus',
            vus: 3,
            duration: '2m',
            exec: 'purchaseFlow',
        },
    },
    thresholds: {
        error_rate: ['rate<0.1'],
    },
};

const PRODUCT_IDS = [1, 2, 3, 4, 5, 6];
const SIZES = ['S', 'M', 'L'];

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ── Scenario 1: Anonymous browsing ──────────────────────────────────────────
// Traces: app-service spans with downstream calls to product-service

export function browse() {
    group('homepage', () => {
        const res = http.get(`${BASE_URL}/`);
        errorRate.add(res.status >= 400);
        check(res, { 'homepage ok': (r) => r.status === 200 });
    });

    sleep(1);

    group('product list', () => {
        const res = http.get(`${BASE_URL}/products`);
        errorRate.add(res.status >= 400);
        check(res, { 'products ok': (r) => r.status === 200 });
    });

    sleep(Math.random() + 0.5);

    group('product detail', () => {
        const res = http.get(`${BASE_URL}/products/${pick(PRODUCT_IDS)}`);
        errorRate.add(res.status >= 400);
        check(res, { 'product detail ok': (r) => r.status === 200 });
    });

    sleep(Math.random() * 2 + 1);
}

// ── Scenario 2: Full purchase flow ───────────────────────────────────────────
// Traces: multi-service spans spanning auth-service + cart-service + product-service

export function purchaseFlow() {
    const jar = http.cookieJar();
    const params = { jar, redirects: 5 };

    const email = `trace_user_${__VU}_${__ITER}@loadtest.dev`;
    const password = 'Password123!';

    group('signup', () => {
        const res = http.post(
            `${BASE_URL}/auth/signup`,
            { name: `Trace User ${__VU}`, email, password, confirmPassword: password },
            params
        );
        errorRate.add(res.status >= 500);
        check(res, { 'signup ok': (r) => r.status === 200 || r.status === 302 });
    });

    sleep(1);

    group('login', () => {
        const res = http.post(
            `${BASE_URL}/auth/login`,
            { email, password },
            params
        );
        errorRate.add(res.status >= 500);
        check(res, { 'login ok': (r) => r.status === 200 || r.status === 302 });
    });

    sleep(1);

    group('browse products', () => {
        http.get(`${BASE_URL}/products`, params);
        sleep(0.5);
        http.get(`${BASE_URL}/products/${pick(PRODUCT_IDS)}`, params);
    });

    sleep(1);

    group('add to cart', () => {
        const id = pick(PRODUCT_IDS);
        const res = http.post(
            `${BASE_URL}/cart/product/${id}/create`,
            { productId: String(id), quantity: '1', size: pick(SIZES) },
            params
        );
        errorRate.add(res.status >= 500);
        check(res, { 'add to cart ok': (r) => r.status < 500 });
    });

    sleep(1);

    group('view cart', () => {
        const res = http.get(`${BASE_URL}/cart`, params);
        check(res, { 'cart ok': (r) => r.status === 200 });
    });

    sleep(1);

    group('checkout', () => {
        const res = http.get(`${BASE_URL}/cart/checkout`, params);
        errorRate.add(res.status >= 500);
        check(res, { 'checkout ok': (r) => r.status === 200 || r.status === 302 });
    });

    sleep(1);

    group('logout', () => {
        http.get(`${BASE_URL}/auth/logout`, params);
    });

    sleep(2);
}
