# ElasticGuard 🛡️

> Advanced Elasticsearch cluster monitoring and operations dashboard — built for production clusters where Kibana isn't enough.

ElasticGuard is a Node.js web application designed to fill the operational gaps left by Kibana. It provides three unique features not available in Kibana out of the box: a **Shard Rebalance Simulator**, a **Storage Cost Calculator**, and an **ILM Policy Conflict Detector**. Deployed on Kubernetes, exposed via Istio, and backed by a Harbor private registry.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Development](#development)
- [Contributing](#contributing)

---

## Features

### 🔀 Shard Rebalance Simulator

Simulates the outcome of a shard rebalancing operation across your cluster nodes **before** you actually trigger it. Given current node states, shard counts, and disk usage, it projects the post-rebalance distribution and flags any nodes likely to breach high watermark thresholds.

- Preview shard distribution changes without impacting the cluster
- Detect hot-spots and imbalanced nodes before rebalancing
- Supports filtering by index pattern and node role

### 💾 Storage Cost Calculator

Calculates the real storage footprint of your indices and data streams, factoring in replica count, codec (best_compression vs default), and ILM tier placement.

- Per-index and per-data-stream storage breakdown
- Projected savings from `best_compression` codec migration
- Cost modeling based on configurable price-per-GB rates
- Useful for capacity planning and budget reporting

### ⚠️ ILM Policy Conflict Detector

Detects indices where the applied ILM policy conflicts with the actual index state — for example, indices stuck in a phase, indices with no ILM policy assigned, or indices where the rollover alias is misconfigured.

- Scans all managed and unmanaged indices
- Cross-references index settings against active ILM policies
- Surfaces indices with `ERROR` phase status and explains the root cause
- Complements the Kubernetes CronJob approach (for clusters where Metricbeat doesn't collect index settings)

---

## Architecture

```
Browser
  │
  ▼
Istio IngressGateway
  │  (VirtualService: elasticguard.internal)
  ▼
elasticguard Service (ClusterIP)
  │
  ▼
elasticguard Deployment (Node.js)
  │
  ├──► Elasticsearch REST API (valentine-logs cluster)
  │     └─ ECK-managed, ~42 nodes, ~104 TB
  │
  └──► Harbor Registry (image pull)
        └─ harbor.internal/elasticguard/app:latest
```

ElasticGuard runs as a standard Kubernetes `Deployment` with a `ClusterIP` service, exposed externally via an Istio `VirtualService`. The application image is stored in and pulled from a self-hosted Harbor registry.

---

## Prerequisites

- Node.js >= 18
- Access to an Elasticsearch cluster (HTTP or HTTPS)
- Kubernetes cluster with:
  - Istio installed (for ingress)
  - Harbor registry accessible from nodes
  - `kubectl` configured with appropriate RBAC
- Docker (for local build and push to Harbor)

---

## Installation

### Local Development

```bash
git clone https://github.com/your-org/elasticguard.git
cd elasticguard
npm install
cp .env.example .env
# Edit .env with your Elasticsearch connection details
npm run dev
```

### Docker Build & Push to Harbor

```bash
# Build the image
docker build -t harbor.internal/elasticguard/app:latest .

# Login to Harbor
docker login harbor.internal

# Push
docker push harbor.internal/elasticguard/app:latest
```

---

## Configuration

ElasticGuard is configured via environment variables. In Kubernetes, these are injected via a `Secret` or `ConfigMap`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ES_HOST` | ✅ | — | Elasticsearch cluster URL (e.g. `https://es-valentine-logs:9200`) |
| `ES_USERNAME` | ✅ | — | Elasticsearch username |
| `ES_PASSWORD` | ✅ | — | Elasticsearch password |
| `ES_TLS_VERIFY` | ❌ | `true` | Set to `false` to skip TLS verification (dev only) |
| `PORT` | ❌ | `3000` | HTTP port the app listens on |
| `COST_PER_GB` | ❌ | `0.05` | Storage cost rate used by the Storage Cost Calculator ($/GB) |
| `NODE_ENV` | ❌ | `development` | Set to `production` for production deployments |

### Example `.env`

```env
ES_HOST=https://es-valentine-es-http:9200
ES_USERNAME=elastic
ES_PASSWORD=changeme
ES_TLS_VERIFY=false
PORT=3000
COST_PER_GB=0.05
NODE_ENV=production
```

---

## Deployment

### Kubernetes Manifests

#### Secret (credentials)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: elasticguard-secret
  namespace: monitoring
type: Opaque
stringData:
  ES_PASSWORD: "changeme"
  ES_USERNAME: "elastic"
```

#### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: elasticguard
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: elasticguard
  template:
    metadata:
      labels:
        app: elasticguard
    spec:
      containers:
        - name: elasticguard
          image: harbor.internal/elasticguard/app:latest
          ports:
            - containerPort: 3000
          env:
            - name: ES_HOST
              value: "https://es-valentine-es-http:9200"
            - name: ES_TLS_VERIFY
              value: "false"
            - name: ES_USERNAME
              valueFrom:
                secretKeyRef:
                  name: elasticguard-secret
                  key: ES_USERNAME
            - name: ES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: elasticguard-secret
                  key: ES_PASSWORD
```

#### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: elasticguard
  namespace: monitoring
spec:
  selector:
    app: elasticguard
  ports:
    - port: 80
      targetPort: 3000
```

#### Istio VirtualService

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: elasticguard-vs
  namespace: monitoring
spec:
  hosts:
    - elasticguard.internal
  gateways:
    - istio-system/ingressgateway
  http:
    - route:
        - destination:
            host: elasticguard
            port:
              number: 80
```

### ArgoCD (GitOps)

If you manage deployments via ArgoCD, point an `Application` resource at the directory containing the above manifests:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: elasticguard
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://git.internal/infra/elasticguard.git
    targetRevision: HEAD
    path: k8s/
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

---

## Usage

Once deployed, access ElasticGuard via the configured Istio hostname (e.g. `http://elasticguard.internal`).

### Shard Rebalance Simulator

1. Navigate to **Simulator** in the top nav
2. Select the target indices or use a wildcard pattern
3. Click **Simulate** to preview shard distribution
4. Review the projected node-level shard and disk usage
5. Check flagged nodes (highlighted in red) that would breach high watermark

### Storage Cost Calculator

1. Navigate to **Storage** in the top nav
2. The dashboard loads all indices and data streams with their current size
3. Toggle **Replica-aware** to factor in replicas
4. Toggle **best_compression projection** to see estimated savings
5. Export the report as CSV for Confluence or capacity planning

### ILM Policy Conflict Detector

1. Navigate to **ILM Conflicts** in the top nav
2. ElasticGuard scans all indices and cross-references their ILM state
3. Conflicting or unmanaged indices are listed with their current phase, policy name, and detected issue
4. Click any index to drill down into its settings and ILM explain output

---

## API Reference

ElasticGuard exposes a lightweight REST API that powers the frontend.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check — returns cluster connection status |
| `GET` | `/api/nodes` | Returns node-level stats (disk, shards, roles) |
| `GET` | `/api/indices` | Returns all indices with size, shard count, and ILM status |
| `POST` | `/api/simulate/rebalance` | Runs shard rebalance simulation for given indices |
| `GET` | `/api/storage/summary` | Returns storage summary with cost projections |
| `GET` | `/api/ilm/conflicts` | Returns list of ILM policy conflicts |

---

## Development

### Project Structure

```
elasticguard/
├── src/
│   ├── routes/
│   │   ├── nodes.js
│   │   ├── indices.js
│   │   ├── simulate.js
│   │   ├── storage.js
│   │   └── ilm.js
│   ├── services/
│   │   ├── esClient.js       # Elasticsearch client wrapper
│   │   ├── rebalancer.js     # Shard rebalance simulation logic
│   │   ├── costCalculator.js # Storage cost calculation logic
│   │   └── ilmChecker.js     # ILM conflict detection logic
│   └── app.js
├── public/                   # Frontend static assets
├── k8s/                      # Kubernetes manifests
├── Dockerfile
├── .env.example
└── package.json
```

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

Internal use — SFR Valentine Infrastructure Team.

---

> Built to fill the gaps Kibana leaves open. 🔍
