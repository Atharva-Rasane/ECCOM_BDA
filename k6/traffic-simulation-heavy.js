import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

const BASE_URL = 'http://34.122.199.244.nip.io';

const errorRate        = new Rate('error_rate');
const checkoutAttempts = new Counter('checkout_attempts');
const cartAdditions    = new Counter('cart_additions');
const signupCount      = new Counter('signups');
const pageLoadTime     = new Trend('page_load_ms');

export const options = {
    scenarios: {
        // Heavy anonymous browsing — window shoppers
        anonymous_browsing: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 15 },
                { duration: '3m',  target: 15 },
                { duration: '30s', target: 0  },
            ],
            exec: 'anonymousBrowsing',
        },
        // Serious buyers — full purchase funnel
        purchase_flow: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 10 },
                { duration: '3m',  target: 10 },
                { duration: '30s', target: 0  },
            ],
            exec: 'purchaseFlow',
        },
        // Repeat customers — already have accounts, jump straight to cart
        repeat_customers: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 5 },
                { duration: '3m',  target: 5 },
                { duration: '30s', target: 0 },
            ],
            exec: 'repeatCustomer',
        },
        // Catalogue browsers — search and filter heavy
        catalogue_browsing: {
            executor: 'constant-vus',
            vus: 5,
            duration: '4m',
            exec: 'catalogueBrowsing',
        },
        // Chaos: constant stream of realistic error/warn events
        chaos_logs: {
            executor: 'constant-arrival-rate',
            rate: 6,
            timeUnit: '10s',
            duration: '4m',
            preAllocatedVUs: 3,
            exec: 'chaosLogs',
        },
        // Auth abuse: failed logins to spike auth errors
        auth_failures: {
            executor: 'constant-arrival-rate',
            rate: 3,
            timeUnit: '10s',
            duration: '4m',
            preAllocatedVUs: 2,
            exec: 'authFailures',
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<3000'],
        error_rate: ['rate<0.4'],
    },
};

const PRODUCT_IDS  = [1, 2, 3, 4, 5, 6];
const CATEGORIES   = ['shirts', 'pants', 'shoes', 'accessories'];
const SORT_OPTIONS = ['price', 'name', 'createdAt'];
const SIZES        = ['S', 'M', 'L'];

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function rand(min, max) {
    return Math.random() * (max - min) + min;
}

// ─── Scenario 1: Anonymous browsing ─────────────────────────────────────────

export function anonymousBrowsing() {
    group('homepage', () => {
        const res = http.get(`${BASE_URL}/`);
        pageLoadTime.add(res.timings.duration);
        errorRate.add(res.status >= 400);
        check(res, { 'homepage 200': (r) => r.status === 200 });
    });
    sleep(rand(1, 3));

    group('browse products', () => {
        const res = http.get(`${BASE_URL}/products`);
        errorRate.add(res.status >= 400);
        check(res, { 'products 200': (r) => r.status === 200 });
    });
    sleep(rand(0.5, 2));

    // View 2–5 product detail pages
    const viewCount = Math.floor(rand(2, 6));
    for (let i = 0; i < viewCount; i++) {
        group('view product detail', () => {
            const res = http.get(`${BASE_URL}/products/${pick(PRODUCT_IDS)}`);
            pageLoadTime.add(res.timings.duration);
            errorRate.add(res.status >= 400);
        });
        sleep(rand(1, 3));
    }

    // Hit the about page occasionally
    if (Math.random() < 0.3) {
        group('about page', () => { http.get(`${BASE_URL}/about`); });
        sleep(rand(1, 2));
    }

    // 25% chance of hitting a missing product (404)
    if (Math.random() < 0.25) {
        group('404 hit', () => {
            const badId = Math.floor(rand(500, 999));
            const res = http.get(`${BASE_URL}/products/${badId}`);
            check(res, { '404 returned': (r) => r.status === 404 });
        });
    }

    sleep(rand(1, 4));
}

// ─── Scenario 2: Full purchase flow ─────────────────────────────────────────

export function purchaseFlow() {
    const params = { redirects: 5 };
    const email    = `buyer_${__VU}_${__ITER}@shop.test`;
    const password = 'Shopper99!';

    group('signup', () => {
        http.get(`${BASE_URL}/auth/signup`, params);
        sleep(rand(0.5, 1.5));
        const res = http.post(`${BASE_URL}/auth/signup`, {
            name: `Shopper ${__VU}`,
            email,
            password,
            confirmPassword: password,
        }, params);
        errorRate.add(res.status >= 500);
        signupCount.add(1);
    });
    sleep(rand(0.5, 1.5));

    group('login', () => {
        http.get(`${BASE_URL}/auth/login`, params);
        sleep(rand(0.5, 1));
        const res = http.post(`${BASE_URL}/auth/login`, { email, password }, params);
        errorRate.add(res.status >= 500);
        check(res, { 'login ok': (r) => r.status === 200 || r.status === 302 });
    });
    sleep(rand(1, 2));

    // Browse products
    group('browse after login', () => {
        http.get(`${BASE_URL}/products`, params);
        sleep(rand(0.5, 1.5));
        http.get(`${BASE_URL}/products/${pick(PRODUCT_IDS)}`, params);
        sleep(rand(0.5, 1.5));
        http.get(`${BASE_URL}/products/${pick(PRODUCT_IDS)}`, params);
    });
    sleep(rand(1, 2));

    // Add 2–5 items to cart
    const addCount = Math.floor(rand(2, 6));
    for (let i = 0; i < addCount; i++) {
        group('add to cart', () => {
            const id  = pick(PRODUCT_IDS);
            const qty = Math.floor(rand(1, 4));
            const res = http.post(
                `${BASE_URL}/cart/product/${id}/create`,
                { productId: String(id), quantity: String(qty), size: pick(SIZES) },
                params
            );
            errorRate.add(res.status >= 500);
            if (res.status < 400) cartAdditions.add(1);
        });
        sleep(rand(0.5, 2));
    }

    group('view cart', () => {
        const res = http.get(`${BASE_URL}/cart`, params);
        pageLoadTime.add(res.timings.duration);
        check(res, { 'cart 200': (r) => r.status === 200 });
    });
    sleep(rand(1, 3));

    // 70% of users reach checkout
    if (Math.random() < 0.7) {
        group('checkout', () => {
            const res = http.get(`${BASE_URL}/cart/checkout`, params);
            checkoutAttempts.add(1);
            errorRate.add(res.status >= 500);
        });
        sleep(rand(2, 4));

        // 40% of those attempt to submit checkout (POST)
        if (Math.random() < 0.4) {
            group('submit checkout', () => {
                const res = http.post(`${BASE_URL}/cart/checkout`, {}, params);
                errorRate.add(res.status >= 500);
            });
            sleep(rand(1, 3));
        }
    }

    group('logout', () => { http.get(`${BASE_URL}/auth/logout`, params); });
    sleep(rand(1, 2));
}

// ─── Scenario 3: Repeat customer (login → cart → checkout fast) ──────────────

export function repeatCustomer() {
    const params = { redirects: 5 };
    // Reuse accounts created by purchaseFlow VUs 1–10, iter 0
    const vuId = ((__VU - 1) % 10) + 1;
    const email    = `buyer_${vuId}_0@shop.test`;
    const password = 'Shopper99!';

    group('login', () => {
        http.get(`${BASE_URL}/auth/login`, params);
        sleep(rand(0.3, 0.8));
        http.post(`${BASE_URL}/auth/login`, { email, password }, params);
    });
    sleep(rand(0.5, 1));

    // Quick browse — they know what they want
    group('quick browse', () => {
        http.get(`${BASE_URL}/products/${pick(PRODUCT_IDS)}`, params);
    });
    sleep(rand(0.5, 1.5));

    // Add 1–3 items quickly
    const addCount = Math.floor(rand(1, 4));
    for (let i = 0; i < addCount; i++) {
        group('add to cart', () => {
            const id = pick(PRODUCT_IDS);
            const res = http.post(
                `${BASE_URL}/cart/product/${id}/create`,
                { productId: String(id), quantity: '1', size: pick(SIZES) },
                params
            );
            if (res.status < 400) cartAdditions.add(1);
        });
        sleep(rand(0.3, 1));
    }

    group('view cart', () => { http.get(`${BASE_URL}/cart`, params); });
    sleep(rand(0.5, 1.5));

    group('checkout', () => {
        const res = http.get(`${BASE_URL}/cart/checkout`, params);
        checkoutAttempts.add(1);
        errorRate.add(res.status >= 500);
    });
    sleep(rand(1, 2));

    group('logout', () => { http.get(`${BASE_URL}/auth/logout`, params); });
    sleep(rand(0.5, 1.5));
}

// ─── Scenario 4: Catalogue browsing (filtering, pagination) ──────────────────

export function catalogueBrowsing() {
    group('homepage', () => { http.get(`${BASE_URL}/`); });
    sleep(rand(0.5, 1.5));

    // Browse with filters / sorting
    const queries = [
        `/products?category=${pick(CATEGORIES)}`,
        `/products?sortBy=${pick(SORT_OPTIONS)}`,
        `/products?page=1&size=6`,
        `/products?priceMin=10&priceMax=500`,
        `/products?latest=true`,
    ];

    const iterations = Math.floor(rand(3, 7));
    for (let i = 0; i < iterations; i++) {
        group('filtered browse', () => {
            const res = http.get(`${BASE_URL}${pick(queries)}`);
            errorRate.add(res.status >= 400);
            pageLoadTime.add(res.timings.duration);
        });
        sleep(rand(1, 3));

        // View a product from the results
        group('view product', () => {
            http.get(`${BASE_URL}/products/${pick(PRODUCT_IDS)}`);
        });
        sleep(rand(1, 2));
    }

    sleep(rand(1, 3));
}

// ─── Scenario 5: Chaos log injection ─────────────────────────────────────────

export function chaosLogs() {
    // Auth-service events — routed to auth-service via /auth/chaos/log
    const authEvents = [
        { level: 'ERROR', category: 'auth',   event: 'auth.token.invalid',   message: 'JWT verification failed — token expired' },
        { level: 'ERROR', category: 'system', event: 'db.connection.timeout',message: 'Postgres connection pool exhausted' },
        { level: 'ERROR', category: 'system', event: 'upstream.unavailable', message: 'Upstream service returned 503' },
        { level: 'WARN',  category: 'auth',   event: 'auth.rate_limit',      message: 'Login rate limit triggered for IP' },
        { level: 'WARN',  category: 'system', event: 'memory.high',          message: 'Heap usage at 82% — approaching limit' },
        { level: 'WARN',  category: 'system', event: 'disk.usage.high',      message: 'Disk usage at 78% on /data volume' },
    ];

    // Cart-service events — routed to cart-service via /cart/chaos/log
    const cartEvents = [
        { level: 'ERROR', category: 'payment_fraud', event: 'payment.failed',       message: 'Stripe payment declined — card_declined' },
        { level: 'ERROR', category: 'system',        event: 'db.query.error',        message: 'Query execution timeout after 5000ms' },
        { level: 'ERROR', category: 'cart_checkout', event: 'cart.sync.failed',      message: 'Cart state sync conflict between sessions' },
        { level: 'WARN',  category: 'cart_checkout', event: 'cart.abandoned',        message: 'User abandoned cart at payment step' },
        { level: 'WARN',  category: 'system',        event: 'latency.spike',         message: 'p99 response time exceeded 1.2s' },
        { level: 'WARN',  category: 'payment_fraud', event: 'payment.suspicious',    message: 'Multiple payment attempts from same IP' },
    ];

    const ae = pick(authEvents);
    http.get(`${BASE_URL}/auth/chaos/log?level=${ae.level}&category=${ae.category}&event=${encodeURIComponent(ae.event)}&message=${encodeURIComponent(ae.message)}`);

    const ce = pick(cartEvents);
    http.get(`${BASE_URL}/cart/chaos/log?level=${ce.level}&category=${ce.category}&event=${encodeURIComponent(ce.event)}&message=${encodeURIComponent(ce.message)}`);

    sleep(1);
}

// ─── Scenario 6: Auth failure spike ──────────────────────────────────────────

export function authFailures() {
    const params = { redirects: 0 };
    const fakeEmails = [
        'hacker@evil.com',
        'admin@admin.com',
        `user${Math.floor(rand(1, 999))}@example.com`,
    ];

    group('failed login attempt', () => {
        const res = http.post(`${BASE_URL}/auth/login`, {
            email: pick(fakeEmails),
            password: 'wrongpassword',
        }, params);
        // 302 to login page = failure redirect = expected
        check(res, { 'auth rejected': (r) => r.status === 302 || r.status === 200 });
    });

    sleep(rand(1, 3));
}
