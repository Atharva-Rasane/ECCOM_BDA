# CanaryGuard

**CanaryGuard** is a production-grade canary deployment and automated rollback system built on top of a full-stack e-commerce application (TrendTrove Wears). It demonstrates how to safely release new versions to a subset of users, detect failures in real-time using metrics and logs, and automatically roll back without human intervention.

---

## Table of Contents

- [About TrendTrove Wears](#about-trendtrove-wears)
- [What It Does](#what-it-does)
- [Architecture Overview](#architecture-overview)
- [How the Canary System Works](#how-the-canary-system-works)
- [Observability Stack](#observability-stack)
- [Project Structure](#project-structure)
- [Deployment Workflow](#deployment-workflow)
- [Grafana Dashboards](#grafana-dashboards)
- [k6 Load Tests](#k6-load-tests)
- [Tech Stack](#tech-stack)

---

## About TrendTrove Wears

TrendTrove Wears is the e-commerce application that CanaryGuard is built around. It is a functional B2C clothing store selling Men's, Women's, and Children's wear.

**Features:**
- Authentication — local email/password and Google OAuth2 login
- Product catalog — search, pagination, filters (category, price, size, new arrivals), sorting (A–Z, price high/low)
- Shopping cart — add/remove items, apply coupon codes for discounts
- Checkout — Stripe payment integration
- Wishlist — save products for later
- User profiles — order history, saved shipping details
- Admin panel — manage products, orders, and coupons (add, edit, delete)
- Email notifications — invoice emails to customers and admins after orders are processed

TrendTrove serves as the real-world workload that CanaryGuard monitors. Its auth and cart flows are the primary targets of canary failure injection, because they represent the most critical user journeys.

---

## What It Does

CanaryGuard automates the three-phase canary release lifecycle:

```
v1 (100% traffic, healthy)
       │
       ▼
v2 canary deployed (10% traffic)
       │
       ├── healthy? → promote (manual or automated)
       │
       └── errors detected? → auto-rollback to v1
```

- **Canary deployment** — v2 receives 10% of traffic via NGINX ingress weight
- **Dual-signal failure detection** — monitors both HTTP 5xx error rate (via Prometheus) and pod crash restarts (via kube-state-metrics)
- **Automated rollback** — a Python controller pod watches Prometheus and triggers `kubectl rollout undo` when thresholds are breached
- **Full observability** — metrics (Prometheus), logs (Loki), and traces (Jaeger/OpenTelemetry) all wired up and visualised in Grafana

---

## Architecture Overview

```
                        ┌─────────────────────────────────┐
                        │         NGINX Ingress            │
                        │  (ingress.yaml + ingress-canary) │
                        │                                  │
                        │  /auth, /products, /cart  ──────►│─── 90% ──► app-service (v1)
                        │                           ──────►│─── 10% ──► app-service-v2 (canary)
                        └─────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
       auth-service            cart-service           product-service
       (passport, OAuth)       (orders, Stripe)       (catalog, search)
              │                       │                       │
              └───────────────────────┴───────────────────────┘
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                    PostgreSQL                  MongoDB
                  (business data)          (session store)

                        ┌─────────────────────────────────┐
                        │        Observability             │
                        │  Prometheus ◄── /metrics         │
                        │  Loki ◄── Promtail (stdout)      │
                        │  Jaeger ◄── OTel Collector       │
                        │  Grafana (dashboards)            │
                        └─────────────────────────────────┘

                        ┌─────────────────────────────────┐
                        │      Canary Controller           │
                        │  (Python pod, polls Prometheus)  │
                        │  error rate > 5% OR restarts ≥ 3│
                        │       → kubectl rollout undo     │
                        └─────────────────────────────────┘
```

---

## How the Canary System Works

### 1. Traffic Splitting

The base ingress (`ingress.yaml`) routes 100% of traffic to v1 services. When the canary ingress (`ingress-canary.yaml`) is applied, NGINX uses weighted routing to send **10% of all requests** to `app-service-v2`:

```yaml
nginx.ingress.kubernetes.io/canary: "true"
nginx.ingress.kubernetes.io/canary-weight: "10"
```

### 2. Failure Injection (FAIL_MODE)

v2 is deployed with an environment variable `FAIL_MODE=auth`. The `failureInjectionMiddleware` intercepts all auth-related requests and returns HTTP 500 before they are processed:

```
Incoming request to /auth/login
        │
        ▼
failureInjectionMiddleware (FAIL_MODE=auth)
        │
        ├── path is /auth/* or /login, /signup, /logout, /google?
        │       YES → log ERROR + return 500 JSON
        │       NO  → next()
        ▼
metricsMiddleware records status_code=500 to Prometheus
```

This simulates a real-world bad deployment — same container image, different runtime behaviour controlled by env var.

### 3. Metrics Recording

Every HTTP response is recorded by `metricsMiddleware` with labels:

```
http_requests_total{method, route, status_code, service}
http_request_duration_seconds{method, route, status_code, service}
```

The `service` label distinguishes v1 (`app-service`) from v2 (`app-service-v2`) via the `SERVICE_NAME` env var. Route labels are normalised — bare paths like `/login` are prefixed to `/auth/login` so Prometheus queries are consistent.

### 4. Canary Controller (Auto-Rollback)

The controller runs as a Python pod and polls Prometheus every 30 seconds with two signals:

**Signal 1 — HTTP error rate:**
```promql
sum(http_requests_total{service="app-service-v2", status_code=~"5.."})
─────────────────────────────────────────────────────────────────────
         sum(http_requests_total{service="app-service-v2"})
```
If error rate > **5%** → rollback.

**Signal 2 — Pod restarts:**
```promql
sum(kube_pod_container_status_restarts_total{pod=~"trendtrove-app-v2-.*"})
```
If restarts ≥ **3** since deployment → rollback.

Signal 2 catches crashes that happen before the pod can serve any requests (and therefore before any metrics are recorded).

**Rollback action:**
```bash
kubectl rollout undo deployment/trendtrove-app-v2
```
The controller then exits so it does not repeatedly flip versions.

### 5. Structured Logging

Every request produces a structured JSON log line to stdout:

```json
{
  "timestamp": "2026-04-15T10:23:45.123Z",
  "level": "ERROR",
  "service": "app-service-v2",
  "version": "0.0.0",
  "environment": "production",
  "trace_id": "abc123",
  "request_id": "req-456",
  "category": "system",
  "event": "service.unavailable",
  "message": "Auth service unavailable (FAIL_MODE=auth)",
  "http": { "method": "POST", "path": "/auth/login", "status_code": 500 }
}
```

Promtail collects these from pod stdout, parses the JSON, and promotes `level`, `service`, `event`, `trace_id` as Loki stream labels — enabling filtered queries like `{app="trendtrove-app-v2", level="ERROR"}`.

---

## Observability Stack

| Tool | Role | How it connects |
|---|---|---|
| **Prometheus** | Metrics storage & querying | Scrapes `/metrics` on all pods via ServiceMonitors |
| **kube-state-metrics** | Pod restart counts | Deployed with kube-prometheus-stack |
| **Loki** | Log aggregation | Receives logs from Promtail |
| **Promtail** | Log collector | DaemonSet on every node, tails pod stdout, parses JSON |
| **Jaeger** | Distributed tracing | Receives spans from OTel Collector |
| **OpenTelemetry Collector** | Trace pipeline | Receives OTLP from app, forwards to Jaeger |
| **Grafana** | Visualisation | Queries Prometheus, Loki, Jaeger |

---

## Project Structure

```
ECCOM_BDA/
├── src/                          # Main application source (TypeScript)
│   ├── app.ts                    # Express app, proxy routing per service
│   ├── metrics.ts                # Prometheus counters + middleware
│   ├── middlewares/
│   │   ├── failureInjectionMiddleware.ts   # FAIL_MODE chaos injection
│   │   └── telemetryMiddleware.ts          # Request ID, trace context
│   ├── telemetry/logger.ts       # Structured JSON logger
│   ├── controllers/              # Route handlers (auth, cart, product, etc.)
│   ├── models/                   # Sequelize models (Postgres)
│   └── routes/                   # Express routers
│
├── micro services/               # Independently deployable services
│   ├── auth service/             # Passport.js, Google OAuth2
│   ├── cart service/             # Cart, orders, Stripe checkout
│   ├── product service/          # Catalog, search, filters
│   ├── mail service/             # Nodemailer email notifications
│   └── error trigger/            # Manual chaos injection helper
│
├── k8deploy/                     # Kubernetes manifests
│   ├── app.yaml                  # v1 deployment + service
│   ├── app-v2.yaml               # v2 canary (FAIL_MODE=auth)
│   ├── ingress.yaml              # Base ingress (100% to v1)
│   ├── ingress-canary.yaml       # Canary ingress (10% to v2)
│   ├── canary-controller.yaml    # Auto-rollback controller pod
│   ├── canary-controller-rbac.yaml  # RBAC for controller
│   ├── servicemonitors.yaml      # Prometheus scrape targets
│   ├── loki-stack.yaml           # Loki + Promtail deployment
│   ├── otel-collector.yaml       # OpenTelemetry collector
│   ├── jaeger.yaml               # Jaeger tracing backend
│   ├── postgres.yaml             # PostgreSQL statefulset
│   ├── mongodb.yaml              # MongoDB statefulset
│   └── prometheus-values.yaml    # Helm values for kube-prometheus-stack
│
├── k6/                           # Load testing scripts
│   ├── no-chaos/                 # Clean traffic, no failure injection
│   │   ├── heavy-commerce-mix.js # Full user journey simulation
│   │   ├── canary-auth-test.js   # Auth flow targeting
│   │   └── canary-cart-test.js   # Cart flow targeting
│   └── with-chaos/               # Triggers FAIL_MODE to test rollback
│       ├── canary-auth-test.js   # Hammers /auth to expose v2 failures
│       └── canary-cart-test.js   # Hammers /cart to expose v2 failures
│
├── DEMO_RUNBOOK.md               # Step-by-step demo execution guide
├── Dockerfile                    # Container image (all services share base)
├── docker-compose.yml            # Local development setup
└── package.json                  # Node.js dependencies and scripts
```

---

## Deployment Workflow

### Prerequisites

- GKE cluster (or any Kubernetes cluster with NGINX ingress controller)
- Helm 3
- kubectl configured
- Docker + access to a container registry
- k6 installed locally

### 1. Install observability infrastructure

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  -n ecommerce --create-namespace \
  -f k8deploy/prometheus-values.yaml
```

### 2. Build and push images

```bash
# v1 (stable)
docker build -t <registry>/trendtrove-app:latest .
docker push <registry>/trendtrove-app:latest

# v2 (same image, different tag — FAIL_MODE injected via env var at runtime)
docker tag <registry>/trendtrove-app:latest <registry>/trendtrove-app:v2
docker push <registry>/trendtrove-app:v2
```

### 3. Deploy base infrastructure

```bash
kubectl apply -f k8deploy/configmap.yaml
kubectl apply -f k8deploy/postgres.yaml
kubectl apply -f k8deploy/mongodb.yaml
kubectl apply -f k8deploy/auth.yaml
kubectl apply -f k8deploy/product.yaml
kubectl apply -f k8deploy/cart.yaml
kubectl apply -f k8deploy/mail.yaml
kubectl apply -f k8deploy/ingress.yaml
kubectl apply -f k8deploy/servicemonitors.yaml
kubectl apply -f k8deploy/loki-stack.yaml
kubectl apply -f k8deploy/jaeger.yaml
kubectl apply -f k8deploy/otel-collector.yaml
```

### 4. Phase 1 — Deploy v1 (healthy baseline)

```bash
kubectl apply -f k8deploy/app.yaml
kubectl rollout status deployment/trendtrove-app

# Generate traffic
k6 run k6/no-chaos/heavy-commerce-mix.js
```

All Grafana dashboards should show green — zero errors, healthy purchase funnel.

### 5. Phase 2 — Deploy v2 canary (broken auth)

```bash
kubectl apply -f k8deploy/app-v2.yaml
kubectl apply -f k8deploy/ingress-canary.yaml
kubectl apply -f k8deploy/canary-controller.yaml

kubectl rollout status deployment/trendtrove-app-v2

# Same traffic script — canary gets 10%
k6 run k6/no-chaos/heavy-commerce-mix.js
```

Within ~60 seconds:
- Grafana shows error rate climbing on `app-service-v2`
- Loki streams ERROR logs with `event=service.unavailable`
- Canary controller detects > 5% error rate and triggers rollback automatically

Watch the controller:
```bash
kubectl logs canary-controller -f
```

### 6. Phase 3 — Rollback and verify

The controller rolls back automatically. To clean up the canary resources:

```bash
kubectl delete -f k8deploy/ingress-canary.yaml --ignore-not-found
kubectl delete pod canary-controller --ignore-not-found
kubectl delete -f k8deploy/app-v2.yaml --ignore-not-found
```

Grafana returns to all green — 100% traffic back on v1.

---

## Grafana Dashboards

| Dashboard | File | Purpose |
|---|---|---|
| Operations Centre | `k6/main-dashboard.json` | Primary demo view — traffic, errors, purchase funnel |
| Cart & Auth Health | `k6/failure-detection-dashboard.json` | Per-service error rates |
| Application Observability | `k6/grafana-dashboard.json` | Log volume, status codes, business events |
| Canary Auth Failure | `k6/canary-auth-failure-dashboard.json` | v1 vs v2 error rate, rollback signal |
| Service Graph | `k6/service-graph-dashboard.json` | Inter-service dependency map |
| Traces | `k6/traces-dashboard.json` | Jaeger trace explorer |

Import via **Grafana → Dashboards → Import → Upload JSON**. Select your Prometheus and Loki datasources when prompted.

---

## k6 Load Tests

| Script | When to use |
|---|---|
| `k6/no-chaos/heavy-commerce-mix.js` | Main demo traffic — realistic browsing, cart, and purchase flows |
| `k6/no-chaos/canary-auth-test.js` | Auth-focused traffic without chaos |
| `k6/no-chaos/canary-cart-test.js` | Cart-focused traffic without chaos |
| `k6/with-chaos/canary-auth-test.js` | Forces auth failures on v2 to demonstrate rollback |
| `k6/with-chaos/canary-cart-test.js` | Forces cart failures on v2 to demonstrate rollback |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript |
| Framework | Express.js |
| Auth | Passport.js (local + Google OAuth2) |
| Databases | PostgreSQL (Sequelize), MongoDB (sessions) |
| Payments | Stripe |
| Container | Docker |
| Orchestration | Kubernetes (GKE), NGINX Ingress |
| Metrics | Prometheus, prom-client |
| Logs | Loki, Promtail |
| Traces | Jaeger, OpenTelemetry |
| Dashboards | Grafana |
| Load Testing | k6 |
