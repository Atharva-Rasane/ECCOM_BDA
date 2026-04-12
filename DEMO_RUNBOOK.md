# CanaryGuard Demo Runbook

Step-by-step guide to execute the full demo: v1 (healthy) -> v2 (broken auth) -> v3 (broken cart) -> rollback to v1.

---

## Prerequisites

Make sure the following are already running on the cluster:
- PostgreSQL, MongoDB (data layer)
- Prometheus + kube-state-metrics (metrics)
- Loki + Promtail (logs)
- Grafana (dashboards)
- OTel Collector + Jaeger (traces)

```bash
# Verify core infra is up
kubectl get pods
kubectl get svc
```

### Build and push all 3 app images

```bash
# v1 (stable)
docker build -t us-central1-docker.pkg.dev/canaryguard-bda/canaryguard/trendtrove-app:latest .
docker push us-central1-docker.pkg.dev/canaryguard-bda/canaryguard/trendtrove-app:latest

# v2 (same code, different tag — FAIL_MODE is set via env var, not baked in)
docker tag us-central1-docker.pkg.dev/canaryguard-bda/canaryguard/trendtrove-app:latest \
           us-central1-docker.pkg.dev/canaryguard-bda/canaryguard/trendtrove-app:v2
docker push us-central1-docker.pkg.dev/canaryguard-bda/canaryguard/trendtrove-app:v2

# v3 (same code, different tag)
docker tag us-central1-docker.pkg.dev/canaryguard-bda/canaryguard/trendtrove-app:latest \
           us-central1-docker.pkg.dev/canaryguard-bda/canaryguard/trendtrove-app:v3
docker push us-central1-docker.pkg.dev/canaryguard-bda/canaryguard/trendtrove-app:v3
```

### Deploy base infrastructure (one-time)

```bash
kubectl apply -f k8deploy/secrets.yaml
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
kubectl apply -f k8deploy/otel-collector.yaml
```

### Deploy error-trigger service (optional — for manual chaos injection)

```bash
kubectl apply -f k8deploy/error-trigger.yaml
```

### Import Grafana dashboards

Import these JSON files into Grafana (Settings > Dashboards > Import):
- `k6/main-dashboard.json` — Operations Centre (primary demo dashboard)
- `k6/failure-detection-dashboard.json` — Cart & Auth Health
- `k6/grafana-dashboard.json` — Application Observability
- `k6/service-graph-dashboard.json` — Service Graph

### Port-forward Grafana and Prometheus (if not exposed via ingress)

```bash
# Grafana (open http://localhost:3001)
kubectl port-forward svc/grafana 3001:80

# Prometheus (open http://localhost:9090)
kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090

# Jaeger (open http://localhost:16686)
kubectl port-forward svc/jaeger-query 16686:16686
```

### Available k6 Scripts

| Script | What it does | How to run |
|--------|-------------|------------|
| `k6/traffic-simulation.js` | Light traffic: 10 anonymous + 3 purchase + chaos logs (3 min) | `k6 run k6/traffic-simulation.js` |
| `k6/traffic-simulation-heavy.js` | Heavy traffic: 15 anonymous + 10 purchase + 5 repeat + chaos (4 min) | `k6 run k6/traffic-simulation-heavy.js` |
| `k6/canary-auth-test.js` | Auth-focused: hammers signup/login routes to surface v2 failures | `k6 run k6/canary-auth-test.js` |
| `k8deploy/k6-canary-auth-test.yaml` | Same as canary-auth-test.js but runs as a K8s Job (in-cluster) | `kubectl apply -f k8deploy/k6-canary-auth-test.yaml` |
| `k8deploy/k6-canary-cart-test.yaml` | Cart-focused: signup + cart add/checkout to surface v3 failures (K8s Job) | `kubectl apply -f k8deploy/k6-canary-cart-test.yaml` |

---

## Step 1: Deploy v1 (Healthy Baseline)

### 1.1 Deploy the stable app

```bash
kubectl apply -f k8deploy/app.yaml
```

### 1.2 Wait for it to be ready

```bash
kubectl rollout status deployment/trendtrove-app
```

### 1.3 Generate traffic with k6

Pick one depending on how much traffic you want on the dashboard:

```bash
# Option A: Light traffic (locally — 3 min, 10 browsing + 3 purchase VUs)
k6 run k6/traffic-simulation.js

# Option B: Heavy traffic (locally — 4 min, 15 browsing + 10 purchase + 5 repeat VUs)
k6 run k6/traffic-simulation-heavy.js

# Option C: Run in-cluster as a K8s Job
kubectl apply -f k8deploy/k6-canary-auth-test.yaml
```

### 1.4 Monitor pods and logs while traffic runs

```bash
# Watch pods in real-time
kubectl get pods -w

# Stream app logs
kubectl logs -f deployment/trendtrove-app

# Check k6 job status (if running in-cluster)
kubectl logs job/k6-canary-auth-test -f
```

### 1.5 Show the dashboard

Open Grafana and show:
- **Operations Centre**: all green, low error rate, healthy purchase funnel
- **Cart & Auth Health**: both services active, zero errors
- Point out: "This is our stable v1 — everything works"

### 1.6 Clean up k6 job before next step

```bash
kubectl delete job k6-canary-auth-test --ignore-not-found
kubectl delete configmap k6-canary-auth-script --ignore-not-found
```

---

## Step 2: Deploy v2 (Broken Signup)

> v2 has `FAIL_MODE=auth` — all `/auth` routes return 500.

### 2.1 Deploy v2 canary + ingress + controller

```bash
# Deploy the broken canary
kubectl apply -f k8deploy/app-v2.yaml

# Route 10% traffic to v2
kubectl apply -f k8deploy/ingress-canary.yaml

# Start the canary controller (monitors v2 error rate)
kubectl apply -f k8deploy/canary-controller.yaml
```

### 2.2 Wait for v2 to be ready

```bash
kubectl rollout status deployment/trendtrove-app-v2
```

### 2.3 Run k6 auth test to generate traffic

```bash
# Option A: In-cluster (K8s Job)
kubectl apply -f k8deploy/k6-canary-auth-test.yaml

# Option B: Locally (hammers auth routes — best for v2 demo)
k6 run k6/canary-auth-test.js

# Option C: Full traffic simulation (includes browsing + purchase + chaos)
k6 run k6/traffic-simulation.js
```

### 2.3.1 Monitor traffic and v2 pod

```bash
# Watch v2 pod logs (you'll see 500 errors on /auth routes)
kubectl logs -f deployment/trendtrove-app-v2

# Check k6 job progress
kubectl logs job/k6-canary-auth-test -f

# Quick check: are 5xx errors showing up in Prometheus?
# (run this in a separate terminal)
kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090
# Then query: rate(http_requests_total{service="app-service-v2",status_code=~"5.."}[1m])
```

### 2.4 Show the dashboard

Open Grafana and point out:
- **Operations Centre**: error rate climbing, auth error spikes in "Error Rate by Service"
- **Cart & Auth Health**: Auth service errors lighting up red, cart still green
- **Live Error Feed**: `Auth service unavailable (FAIL_MODE=auth)` messages
- Point out: "v2 broke signup — the dashboard caught it immediately"

### 2.5 Show canary controller logs (auto-rollback)

```bash
kubectl logs canary-controller -f
```

The controller should detect error rate > 5% and trigger rollback automatically.
If you want to show manual awareness before auto-rollback, you can skip deploying the controller and just show the dashboard.

### 2.6 Clean up v2

```bash
kubectl delete -f k8deploy/ingress-canary.yaml --ignore-not-found
kubectl delete pod canary-controller --ignore-not-found
kubectl delete -f k8deploy/app-v2.yaml --ignore-not-found
kubectl delete job k6-canary-auth-test --ignore-not-found
kubectl delete configmap k6-canary-auth-script --ignore-not-found
```

### 2.7 Pause — let dashboard recover

Wait ~1-2 minutes for error rates to drop back to zero. Show the dashboard recovering.

---

## Step 3: Deploy v3 (Broken Cart)

> v3 has `FAIL_MODE=cart` — all `/cart` routes return 500. Signup works fine.

### 3.1 Deploy v3 canary + ingress + controller

```bash
# Deploy the broken canary
kubectl apply -f k8deploy/app-v3.yaml

# Route 10% traffic to v3
kubectl apply -f k8deploy/ingress-canary-v3.yaml

# Start the canary controller (monitors v3 error rate)
kubectl apply -f k8deploy/canary-controller-v3.yaml
```

### 3.2 Wait for v3 to be ready

```bash
kubectl rollout status deployment/trendtrove-app-v3
```

### 3.3 Run k6 cart test to generate traffic

```bash
# Option A: In-cluster (K8s Job — cart-focused test)
kubectl apply -f k8deploy/k6-canary-cart-test.yaml

# Option B: Full traffic simulation (locally — includes cart + auth + browsing)
k6 run k6/traffic-simulation.js
```

### 3.3.1 Monitor traffic and v3 pod

```bash
# Watch v3 pod logs (you'll see 500 errors on /cart routes)
kubectl logs -f deployment/trendtrove-app-v3

# Check k6 job progress
kubectl logs job/k6-canary-cart-test -f
```

### 3.4 Show the dashboard

Open Grafana and point out:
- **Operations Centre**: error rate climbing again, but now it's cart errors (not auth)
- **Cart & Auth Health**: Cart service errors lighting up red, auth is green this time
- **Purchase Funnel**: "Cart Added" and "Checkout" lines dropping off
- Point out: "v3 fixed the signup bug but introduced a cart bug — different failure, same observability stack catches it"

### 3.5 Show canary controller logs

```bash
kubectl logs canary-controller-v3 -f
```

### 3.6 Clean up v3

```bash
kubectl delete -f k8deploy/ingress-canary-v3.yaml --ignore-not-found
kubectl delete pod canary-controller-v3 --ignore-not-found
kubectl delete -f k8deploy/app-v3.yaml --ignore-not-found
kubectl delete job k6-canary-cart-test --ignore-not-found
kubectl delete configmap k6-canary-cart-script --ignore-not-found
kubectl delete configmap canary-controller-v3-script --ignore-not-found
```

---

## Step 4: Rollback to v1 (Perfect Dashboard)

### 4.1 Verify only v1 is running

```bash
kubectl get deployments
# Should only show: trendtrove-app, trendtrove-auth, product-service, cart-service, mail-service
```

### 4.2 Generate clean traffic

```bash
# Option A: Light traffic (locally)
k6 run k6/traffic-simulation.js

# Option B: Heavy traffic (locally — fills the dashboard nicely)
k6 run k6/traffic-simulation-heavy.js

# Option C: In-cluster
kubectl apply -f k8deploy/k6-canary-auth-test.yaml
```

### 4.3 Show the dashboard

- **Operations Centre**: back to all green, zero errors, healthy funnel
- Point out: "We're back to v1 — the dashboard confirms a clean, healthy system"

### 4.4 Final cleanup (after demo)

```bash
kubectl delete job k6-canary-auth-test --ignore-not-found
kubectl delete configmap k6-canary-auth-script --ignore-not-found
```

---

## Useful Grafana / Loki / Prometheus Queries

Use these to manually verify things during the demo if needed.

### Loki (Explore > Loki datasource)

```logql
# All errors across services
{app=~"trendtrove-app|trendtrove-app-v2|trendtrove-app-v3|cart-service|trendtrove-auth"} | json | level="ERROR"

# v2 auth errors specifically
{app="trendtrove-app-v2"} | json | level="ERROR"

# v3 cart errors specifically
{app="trendtrove-app-v3"} | json | level="ERROR"

# Cart events (item added, checkout, payment)
{app=~"trendtrove-app|cart-service"} | json | event=~"cart.*|checkout.*|payment.*"

# Auth events (login, signup, logout)
{app="trendtrove-auth"} | json | event=~"user.*"

# Orders per minute (checkout initiated)
sum(count_over_time({app=~"trendtrove-app|cart-service"} | json | event="checkout.initiated" [1m]))
```

### Prometheus (Explore > Prometheus datasource)

```promql
# Request rate by service
sum by (service) (rate(http_requests_total[1m]))

# Error rate for v2 canary
sum(rate(http_requests_total{service="app-service-v2",status_code=~"5.."}[1m]))

# Error rate for v3 canary
sum(rate(http_requests_total{service="app-service-v3",status_code=~"5.."}[1m]))

# p95 latency
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="app-service"}[5m]))) * 1000

# Pod restarts (canary crash detection)
sum(kube_pod_container_status_restarts_total{pod=~"trendtrove-app-v2.*"})
sum(kube_pod_container_status_restarts_total{pod=~"trendtrove-app-v3.*"})
```

---

## Talking Points During Demo

| Step | Key Message |
|------|-------------|
| v1 | "This is our baseline — observability confirms everything is healthy" |
| v2 | "A bad canary broke auth — Grafana caught it in real-time, canary controller auto-rolled back" |
| v3 | "Different failure mode (cart instead of auth) — same observability stack detects it automatically" |
| Rollback | "Back to stable — dashboard confirms full recovery" |

## Quick Reference: What Each Version Does

| Version | FAIL_MODE | Signup | Cart | Image Tag |
|---------|-----------|--------|------|-----------|
| v1 | none | Works | Works | `latest` |
| v2 | `auth` | Broken (500) | Works | `v2` |
| v3 | `cart` | Works | Broken (500) | `v3` |

## Troubleshooting

**k6 job won't start / already exists:**
```bash
kubectl delete job <job-name> --ignore-not-found
# Then re-apply
```

**Canary controller not detecting errors:**
```bash
# Check if Prometheus is scraping the canary
kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090
# Visit http://localhost:9090 and query: http_requests_total{service="app-service-v2"}
```

**Ingress not routing to canary:**
```bash
kubectl get ingress
# Should show both trendtrove-ingress and the canary ingress
# Only one canary ingress should exist at a time
```

**Dashboard not showing v3 data:**
- Make sure ServiceMonitors are applied: `kubectl apply -f k8deploy/servicemonitors.yaml`
- Re-import the dashboard JSON files into Grafana

**k6 not installed locally:**
```bash
# macOS
brew install k6

# or run via Docker
docker run --rm -i grafana/k6 run - < k6/traffic-simulation.js
```

---

## Manual Chaos Injection (Optional)

If the error-trigger service is deployed, you can manually inject error logs:

```bash
# Inject an auth error log
curl "http://34.122.199.244.nip.io/auth/chaos/log?level=ERROR&category=auth&event=auth.failed&message=Manual+auth+failure+injection"

# Inject a cart error log
curl "http://34.122.199.244.nip.io/cart/chaos/log?level=ERROR&category=cart_checkout&event=cart.sync.failed&message=Manual+cart+failure+injection"

# Inject a payment error log
curl "http://34.122.199.244.nip.io/cart/chaos/log?level=ERROR&category=payment_fraud&event=payment.failed&message=Stripe+payment+declined"
```

---

## Full Cleanup (tear down everything)

```bash
# Remove canary deployments
kubectl delete -f k8deploy/app-v2.yaml --ignore-not-found
kubectl delete -f k8deploy/app-v3.yaml --ignore-not-found

# Remove canary ingresses
kubectl delete -f k8deploy/ingress-canary.yaml --ignore-not-found
kubectl delete -f k8deploy/ingress-canary-v3.yaml --ignore-not-found

# Remove canary controllers
kubectl delete pod canary-controller --ignore-not-found
kubectl delete pod canary-controller-v3 --ignore-not-found
kubectl delete configmap canary-controller-script --ignore-not-found
kubectl delete configmap canary-controller-v3-script --ignore-not-found

# Remove k6 jobs and scripts
kubectl delete job k6-canary-auth-test --ignore-not-found
kubectl delete job k6-canary-cart-test --ignore-not-found
kubectl delete configmap k6-canary-auth-script --ignore-not-found
kubectl delete configmap k6-canary-cart-script --ignore-not-found

# Remove error trigger
kubectl delete -f k8deploy/error-trigger.yaml --ignore-not-found
```
