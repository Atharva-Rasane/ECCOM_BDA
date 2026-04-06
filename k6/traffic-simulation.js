import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const BASE_URL = 'http://34.122.199.244.nip.io';

// Custom metrics visible in k6 output
const errorRate = new Rate('error_rate');
const checkoutAttempts = new Counter('checkout_attempts');
const cartAdditions = new Counter('cart_additions');

export const options = {
    scenarios: {
        // Most users: anonymous browsing
        anonymous_browsing: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 10 },
                { duration: '2m',  target: 10 },
                { duration: '30s', target: 0 },
            ],
            exec: 'anonymousBrowsing',
        },
        // Smaller portion: full authenticated purchase flow
        purchase_flow: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 3 },
                { duration: '2m',  target: 3 },
                { duration: '30s', target: 0 },
            ],
            exec: 'purchaseFlow',
        },
        // Background: occasional errors and chaos logs
        chaos_logs: {
            executor: 'constant-arrival-rate',
            rate: 2,
            timeUnit: '10s',
            duration: '3m',
            preAllocatedVUs: 2,
            exec: 'chaosLogs',
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.1'],
        http_req_duration: ['p(95)<2000'],
    },
};

const PRODUCT_IDS = [1, 2, 3, 4, 5, 6];
const SIZES = ['S', 'M', 'L'];

function randomProduct() {
    return PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
}

// ─── Scenario 1: Anonymous browsing ─────────────────────────────────────────

export function anonymousBrowsing() {
    group('homepage', () => {
        const res = http.get(`${BASE_URL}/`);
        errorRate.add(res.status >= 400);
        check(res, { 'homepage 200': (r) => r.status === 200 });
    });

    sleep(Math.random() * 2 + 1);

    group('browse products', () => {
        const res = http.get(`${BASE_URL}/products`);
        errorRate.add(res.status >= 400);
        check(res, { 'products 200': (r) => r.status === 200 });
    });

    sleep(Math.random() * 1 + 0.5);

    // View 1–3 individual product pages
    const viewCount = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < viewCount; i++) {
        group('view product detail', () => {
            const id = randomProduct();
            const res = http.get(`${BASE_URL}/products/${id}`);
            errorRate.add(res.status >= 400);
            check(res, { 'product detail 200': (r) => r.status === 200 });
        });
        sleep(Math.random() * 2 + 1);
    }

    // Occasionally hit a non-existent page to generate 404s
    if (Math.random() < 0.2) {
        group('404 hit', () => {
            const res = http.get(`${BASE_URL}/products/9999`);
            check(res, { '404 as expected': (r) => r.status === 404 });
        });
    }

    group('about page', () => {
        const res = http.get(`${BASE_URL}/about`);
        errorRate.add(res.status >= 400);
    });

    sleep(Math.random() * 3 + 1);
}

// ─── Scenario 2: Signup → Login → Add to cart → Checkout ────────────────────

export function purchaseFlow() {
    const jar = http.cookieJar();
    const params = { jar, redirects: 5 };

    // Unique email per VU + iteration so signups don't collide
    const email = `testuser_${__VU}_${__ITER}@loadtest.dev`;
    const password = 'Password123!';

    group('signup', () => {
        const signupPage = http.get(`${BASE_URL}/auth/signup`, params);
        check(signupPage, { 'signup page loaded': (r) => r.status === 200 });

        sleep(1);

        const res = http.post(
            `${BASE_URL}/auth/signup`,
            {
                name: `Load Tester ${__VU}`,
                email,
                password,
                confirmPassword: password,
            },
            params
        );
        errorRate.add(res.status >= 500);
        check(res, { 'signup ok': (r) => r.status === 200 || r.status === 302 });
    });

    sleep(1);

    group('login', () => {
        const loginPage = http.get(`${BASE_URL}/auth/login`, params);
        check(loginPage, { 'login page loaded': (r) => r.status === 200 });

        sleep(1);

        const res = http.post(
            `${BASE_URL}/auth/login`,
            { email, password },
            params
        );
        errorRate.add(res.status >= 500);
        check(res, { 'login ok': (r) => r.status === 200 || r.status === 302 });
    });

    sleep(Math.random() * 2 + 1);

    group('browse while logged in', () => {
        http.get(`${BASE_URL}/products`, params);
        sleep(1);
        http.get(`${BASE_URL}/products/${randomProduct()}`, params);
    });

    sleep(1);

    // Add 1–3 products to cart
    const addCount = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < addCount; i++) {
        group('add to cart', () => {
            const id = randomProduct();
            const res = http.post(
                `${BASE_URL}/cart/product/${id}/create`,
                { productId: String(id), quantity: '1', size: SIZES[Math.floor(Math.random() * SIZES.length)] },
                params
            );
            errorRate.add(res.status >= 500);
            if (res.status < 400) cartAdditions.add(1);
        });
        sleep(Math.random() * 1.5 + 0.5);
    }

    group('view cart', () => {
        const res = http.get(`${BASE_URL}/cart`, params);
        check(res, { 'cart loaded': (r) => r.status === 200 });
    });

    sleep(Math.random() * 2 + 1);

    group('initiate checkout', () => {
        const res = http.get(`${BASE_URL}/cart/checkout`, params);
        errorRate.add(res.status >= 500);
        checkoutAttempts.add(1);
        check(res, { 'checkout loaded': (r) => r.status === 200 || r.status === 302 });
    });

    sleep(Math.random() * 3 + 2);

    group('logout', () => {
        http.get(`${BASE_URL}/auth/logout`, params);
    });

    sleep(2);
}

// ─── Scenario 3: Chaos log injection ────────────────────────────────────────

export function chaosLogs() {
    // Auth-service events — routed to auth-service via /auth/chaos/log
    const authEvents = [
        { level: 'ERROR', category: 'auth',   event: 'auth.failed',         message: 'Invalid credentials attempt' },
        { level: 'WARN',  category: 'auth',   event: 'auth.rate_limit',     message: 'Login rate limit triggered for IP' },
        { level: 'ERROR', category: 'system', event: 'db.connection.error', message: 'Database connection timeout' },
    ];

    // Cart-service events — routed to cart-service via /cart/chaos/log
    const cartEvents = [
        { level: 'ERROR', category: 'cart_checkout',  event: 'cart.sync.failed',   message: 'Cart state sync conflict between sessions' },
        { level: 'WARN',  category: 'cart_checkout',  event: 'cart.abandoned',     message: 'User abandoned cart at checkout' },
        { level: 'ERROR', category: 'payment_fraud',  event: 'payment.failed',     message: 'Stripe payment declined' },
        { level: 'WARN',  category: 'system',         event: 'memory.high',        message: 'Memory usage above 80%' },
        { level: 'WARN',  category: 'system',         event: 'latency.spike',      message: 'Response time exceeded 1s threshold' },
    ];

    const ae = authEvents[Math.floor(Math.random() * authEvents.length)];
    http.get(`${BASE_URL}/auth/chaos/log?level=${ae.level}&category=${ae.category}&event=${encodeURIComponent(ae.event)}&message=${encodeURIComponent(ae.message)}`);

    const ce = cartEvents[Math.floor(Math.random() * cartEvents.length)];
    http.get(`${BASE_URL}/cart/chaos/log?level=${ce.level}&category=${ce.category}&event=${encodeURIComponent(ce.event)}&message=${encodeURIComponent(ce.message)}`);

    sleep(1);
}
