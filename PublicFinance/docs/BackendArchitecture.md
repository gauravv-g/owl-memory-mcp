# Backend Architecture

## Overview

This document defines the backend architecture for the Public Finance Intelligence Platform, designed to serve 100 million users with high availability, scalability, and security. This architecture follows the principles outlined in Vision.md, Mission.md, and GuidingPrinciples.md, and supports the features defined in PRD.md.

## Architectural Style: Modular Monolith First

### Rationale
- **Initial Simplicity**: Easier to develop, test, and deploy in early stages
- **Clear Boundaries**: Modules enforce separation of concerns without distributed system complexity
- **Evolution Path**: Can extract microservices when specific modules need independent scaling
- **Data Consistency**: ACID transactions within module boundaries
- **Operational Efficiency**: Single deployment artifact, simplified monitoring

### Module Boundaries
```
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway Layer                         │
│              (Authentication, Rate Limiting)                 │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼───────┐   ┌────────▼────────┐   ┌───────▼───────┐
│   Budget      │   │    Revenue      │   │   Entity      │
│   Module      │   │    Module       │   │   Module      │
│               │   │                 │   │               │
│ - Budgets     │   │ - Tax Receipts  │   │ - Ministries  │
│ - Allocations │   │ - Non-Tax Rev   │   │ - Departments │
│ - Expenditure │   │ - Grants        │   │ - Agencies    │
└───────┬───────┘   └────────┬────────┘   └───────┬───────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Shared Kernel    │
                    │                    │
                    │ - Users            │
                    │ - Auth             │
                    │ - Notifications    │
                    │ - Search           │
                    │ - AI Services      │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Infrastructure   │
                    │                    │
                    │ - Database         │
                    │ - Cache            │
                    │ - Queue            │
                    │ - Storage          │
                    └────────────────────┘
```

## Technology Stack

### Core Framework
- **Language**: Python 3.12+
- **Web Framework**: FastAPI (async-first, automatic OpenAPI docs, type safety)
- **Why FastAPI**: 
  - High performance (comparable to Node.js/Go)
  - Automatic validation with Pydantic
  - Built-in async support for I/O bound operations
  - Excellent developer experience with auto-generated docs

### Application Server
- **WSGI/ASGI Server**: Uvicorn + Gunicorn (production)
- **Worker Management**: Multiple workers with graceful shutdown

### Database Layer
- **Primary Database**: PostgreSQL 16+
  - ACID compliance for financial data
  - Advanced indexing (GIN, GiST, BRIN)
  - Partitioning for time-series data
  - Full-text search capabilities
  - Row-level security
- **ORM**: SQLAlchemy 2.0+ with async support
- **Migration Tool**: Alembic
- **Connection Pooling**: PgBouncer (production)

### Caching Strategy
- **Primary Cache**: Redis 7+
  - Session storage
  - API response caching
  - Rate limiting counters
  - Real-time analytics aggregation
- **Cache Patterns**:
  - Cache-aside for read-heavy endpoints
  - Write-through for critical data
  - Time-based expiration with jitter

### Message Queue
- **Queue System**: Redis Streams (simple) or Apache Kafka (scale)
- **Use Cases**:
  - Async job processing (report generation, data imports)
  - Event-driven architecture between modules
  - Audit log streaming
  - Notification delivery

### Search Engine
- **Primary Search**: PostgreSQL Full-Text Search (initial)
- **Scale Option**: OpenSearch/Elasticsearch (when needed)
- **Features**:
  - Multilingual stemming (Hindi, English, regional languages)
  - Fuzzy matching for entity names
  - Faceted search for filters
  - Relevance scoring

### File Storage
- **Object Storage**: MinIO (self-hosted S3-compatible)
- **Use Cases**:
  - Document uploads (budget PDFs, reports)
  - Exported datasets (CSV, JSON, Excel)
  - Media assets
  - Backup archives

### Authentication & Authorization
- **Protocol**: OAuth 2.1 + OIDC
- **Token Format**: JWT (stateless) + Refresh Tokens (rotating)
- **Session Management**: Redis-backed session store
- **RBAC**: Role-Based Access Control with fine-grained permissions
- **MFA Support**: TOTP, SMS, Email verification

## API Design Principles

### RESTful Conventions
- Resource-oriented URLs: `/api/v1/budgets/{id}`
- HTTP verbs: GET, POST, PUT, PATCH, DELETE
- Status codes: Standard HTTP semantics
- Versioning: URL path versioning (`/api/v1/`)

### Request/Response Standards
- **Content-Type**: `application/json` (default), `multipart/form-data` (uploads)
- **Response Envelope**: Consistent structure with data, meta, errors
- **Pagination**: Cursor-based for large datasets, offset-based for simple lists
- **Filtering**: Query parameters with standardized operators
- **Sorting**: Explicit sort fields with direction

### Error Handling
- Structured error responses with error codes
- Human-readable messages (multilingual ready)
- Machine-readable error categories
- Correlation IDs for debugging

### Rate Limiting
- Tiered limits based on user type (anonymous, registered, premium, admin)
- Per-endpoint limits for expensive operations
- Sliding window algorithm
- Clear rate limit headers in responses

## Security Architecture

### Defense in Depth
1. **Network Layer**: VPC isolation, security groups, WAF
2. **Application Layer**: Input validation, output encoding, CSRF protection
3. **Data Layer**: Encryption at rest, row-level security, audit logging
4. **Access Layer**: MFA, RBAC, principle of least privilege

### Data Protection
- **Encryption at Rest**: AES-256 for database, object storage
- **Encryption in Transit**: TLS 1.3 everywhere
- **Sensitive Data**: Field-level encryption for PII
- **Key Management**: HashiCorp Vault or cloud KMS

### Audit & Compliance
- Immutable audit logs for all write operations
- User action tracking with IP, timestamp, user agent
- Data access logging for sensitive endpoints
- Regular security assessments and penetration testing

## Observability

### Logging
- **Structured Logging**: JSON format with correlation IDs
- **Log Levels**: DEBUG, INFO, WARN, ERROR, CRITICAL
- **Aggregation**: Centralized log storage (ELK/Loki)
- **Retention**: 90 days hot, 1 year cold storage

### Metrics
- **Application Metrics**: Request latency, error rates, throughput
- **Business Metrics**: Active users, feature usage, data coverage
- **Infrastructure Metrics**: CPU, memory, disk, network
- **Tooling**: Prometheus + Grafana

### Tracing
- **Distributed Tracing**: OpenTelemetry standard
- **Span Collection**: Jaeger or Tempo
- **Sampling**: Adaptive sampling for high-traffic endpoints
- **Context Propagation**: Across all service boundaries

### Alerting
- **SLO-Based Alerts**: Error budget burn rate
- **Symptom-Based Alerts**: User-facing issues first
- **Escalation Policies**: On-call rotation with clear runbooks
- **Noise Reduction**: Alert correlation and deduplication

## Scalability Strategy

### Horizontal Scaling
- Stateless application servers behind load balancer
- Database read replicas for read-heavy workloads
- Cache clustering for high availability
- Queue partitioning for parallel processing

### Vertical Scaling
- Database instance sizing based on workload patterns
- Memory optimization for cache-heavy operations
- CPU allocation for compute-intensive tasks (AI inference)

### Database Scaling
- **Read Scaling**: Read replicas with logical replication
- **Write Scaling**: Sharding strategy (by state/region when needed)
- **Partitioning**: Time-based partitioning for transaction tables
- **Archival**: Cold data migration to cheaper storage

### Caching Layers
1. **CDN**: Static assets, API responses for anonymous users
2. **Application Cache**: In-memory LRU for frequently accessed data
3. **Distributed Cache**: Redis cluster for shared state
4. **Database Cache**: Query result caching, materialized views

## Deployment Architecture

### Environment Strategy
- **Development**: Local Docker Compose for developers
- **Staging**: Production-like environment for testing
- **Production**: Multi-AZ deployment for high availability
- **DR**: Cross-region backup and failover capability

### Containerization
- **Runtime**: Docker containers
- **Orchestration**: Kubernetes (production)
- **Image Registry**: Private registry with vulnerability scanning
- **Secrets Management**: Kubernetes Secrets + external vault

### CI/CD Pipeline
- **Source Control**: Git with protected branches
- **Build**: Automated builds on every commit
- **Test**: Unit, integration, E2E tests in pipeline
- **Deploy**: Blue-green or canary deployments
- **Rollback**: Automated rollback on health check failures

## Disaster Recovery

### Backup Strategy
- **Database**: Continuous WAL archiving + daily full backups
- **Object Storage**: Cross-region replication
- **Configuration**: Infrastructure as Code in version control
- **Recovery Point Objective (RPO)**: < 1 hour
- **Recovery Time Objective (RTO)**: < 4 hours

### Business Continuity
- Multi-AZ deployment for zone failure tolerance
- Cross-region DR site for regional disasters
- Regular DR drills and failover testing
- Documented recovery procedures

## Performance Targets

### Latency Budgets
- **API Response Time**: p95 < 200ms for simple queries, < 2s for complex aggregations
- **Database Query Time**: p95 < 50ms for indexed lookups
- **Cache Hit Rate**: > 90% for frequently accessed data
- **Page Load Time**: < 3s on 3G networks (mobile)

### Throughput Targets
- **Concurrent Users**: Support 100,000 concurrent users
- **Requests per Second**: 10,000 RPS sustained, 50,000 RPS peak
- **Data Ingestion**: 1 million records/hour for batch imports
- **Export Generation**: 1,000 concurrent export jobs

## Monitoring & Maintenance

### Health Checks
- **Liveness Probes**: Application responsiveness
- **Readiness Probes**: Dependency availability
- **Startup Probes**: Slow container startup handling

### Maintenance Windows
- **Database Migrations**: Zero-downtime migration strategies
- **Schema Changes**: Backward-compatible changes first
- **Deprecation Policy**: 6-month notice for breaking changes
- **Version Support**: Support 2 major API versions simultaneously

## Future Evolution Path

### Microservices Extraction Candidates
1. **AI Service**: Independent scaling for ML workloads
2. **Search Service**: Dedicated search cluster
3. **Notification Service**: High-volume async processing
4. **Export Service**: Compute-intensive report generation

### Event-Driven Architecture
- Event sourcing for audit-critical operations
- CQRS pattern for read-heavy reporting features
- Event streaming for real-time dashboards

### Edge Computing
- CDN edge functions for geographic routing
- Edge caching for regional data access
- Edge compute for preprocessing (image optimization, etc.)

## References
- Vision.md: Long-term platform goals
- PRD.md: Feature requirements driving architecture
- GuidingPrinciples.md: Engineering principles
- InformationArchitecture.md: Data flow requirements
- DesignSystem.md: API consistency standards
