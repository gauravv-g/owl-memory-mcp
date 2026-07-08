# Database Schema

## Overview

This document defines the complete database schema for the Public Finance Intelligence Platform. The design follows principles from Vision.md (scalability to 100M users), BackendArchitecture.md (PostgreSQL 16+ with advanced features), and PRD.md (feature requirements). All tables include audit fields, soft deletes where appropriate, and are designed for multilingual support.

## Design Principles

1. **Normalization**: 3NF for transactional integrity, denormalized views for reporting
2. **Audit Trail**: Created/updated timestamps and user IDs on all tables
3. **Soft Deletes**: `deleted_at` column for recoverable data
4. **Multilingual**: JSONB columns for localized content
5. **Partitioning**: Time-based partitioning for large transaction tables
6. **Indexing**: Strategic indexes based on query patterns from InformationArchitecture.md
7. **Constraints**: Foreign keys, check constraints, unique constraints for data integrity
8. **Security**: Row-level security policies for multi-tenant access control

## Core Tables

### Users & Authentication

```sql
-- User accounts
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone_number VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    
    -- Profile
    full_name VARCHAR(255) NOT NULL,
    preferred_language VARCHAR(10) DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'or', 'pa', 'as', 'mai', 'sa', 'ne', 'sd', 'kok', 'man', 'bo', 'brx', 'doi', 'sat')),
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
    
    -- Account status
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,
    phone_verified_at TIMESTAMPTZ,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_login_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = TRUE;

-- User roles and permissions
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL, -- 'admin', 'analyst', 'citizen', 'journalist', 'researcher'
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '[]', -- Array of permission strings
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

-- Sessions and tokens
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    refresh_token_hash VARCHAR(255) UNIQUE,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_token ON sessions(token_hash);

-- MFA devices
CREATE TABLE mfa_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('totp', 'sms', 'email', 'webauthn')),
    device_name VARCHAR(100),
    secret_encrypted BYTEA, -- Encrypted TOTP secret
    phone_number VARCHAR(20),
    is_primary BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_used_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_mfa_devices_user ON mfa_devices(user_id);
```

### Geographic Entities

```sql
-- States and Union Territories
CREATE TABLE states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) UNIQUE NOT NULL, -- 'DL', 'MH', 'UP', etc.
    name_en VARCHAR(100) NOT NULL,
    name_hi VARCHAR(100),
    name_local VARCHAR(100), -- State's official local language name
    type VARCHAR(20) NOT NULL CHECK (type IN ('state', 'union_territory')),
    capital_city VARCHAR(100),
    area_sq_km NUMERIC(10, 2),
    population BIGINT,
    census_year INTEGER,
    
    -- Metadata
    data_source VARCHAR(255),
    last_updated TIMESTAMPTZ,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_states_code ON states(code);
CREATE INDEX idx_states_name_en ON states(name_en);

-- Districts
CREATE TABLE districts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id UUID NOT NULL REFERENCES states(id),
    code VARCHAR(20) UNIQUE NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    name_hi VARCHAR(100),
    name_local VARCHAR(100),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_districts_state ON districts(state_id);
CREATE INDEX idx_districts_code ON districts(code);

-- Local bodies (Municipalities, Panchayats)
CREATE TABLE local_bodies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    district_id UUID NOT NULL REFERENCES districts(id),
    name_en VARCHAR(255) NOT NULL,
    name_hi VARCHAR(255),
    name_local VARCHAR(255),
    body_type VARCHAR(50) NOT NULL, -- 'municipality', 'municipal_corporation', 'panchayat', 'cantonment'
    tier VARCHAR(20), -- 'urban', 'rural'
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_local_bodies_district ON local_bodies(district_id);
```

### Government Entities

```sql
-- Ministries and Departments
CREATE TABLE ministries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_hi VARCHAR(255),
    abbreviation_en VARCHAR(50),
    abbreviation_hi VARCHAR(50),
    parent_ministry_id UUID REFERENCES ministries(id),
    ministry_type VARCHAR(50) CHECK (ministry_type IN ('central', 'state')),
    state_id UUID REFERENCES states(id), -- For state ministries
    
    -- Contact info
    website_url VARCHAR(500),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_ministries_code ON ministries(code);
CREATE INDEX idx_ministries_parent ON ministries(parent_ministry_id);
CREATE INDEX idx_ministries_state ON ministries(state_id);

-- Schemes and Programs
CREATE TABLE schemes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name_en VARCHAR(500) NOT NULL,
    name_hi VARCHAR(500),
    description_en TEXT,
    description_hi TEXT,
    ministry_id UUID NOT NULL REFERENCES ministries(id),
    scheme_type VARCHAR(50), -- 'central_sector', 'centrally_sponsored', 'state_sector'
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discontinued', 'merged')),
    
    -- Budget allocation
    total_allocation NUMERIC(20, 2), -- In rupees
    currency VARCHAR(3) DEFAULT 'INR',
    
    -- Beneficiary info
    target_beneficiaries TEXT,
    eligibility_criteria TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_schemes_ministry ON schemes(ministry_id);
CREATE INDEX idx_schemes_status ON schemes(status);
CREATE INDEX idx_schemes_code ON schemes(code);
```

### Budget Data (Core Financial Tables)

```sql
-- Fiscal years
CREATE TABLE fiscal_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year_start INTEGER NOT NULL, -- e.g., 2024 for FY 2024-25
    year_end INTEGER NOT NULL, -- e.g., 2025 for FY 2024-25
    display_name VARCHAR(20) NOT NULL, -- 'FY 2024-25'
    is_current BOOLEAN DEFAULT FALSE,
    budget_status VARCHAR(20) DEFAULT 'draft' CHECK (budget_status IN ('draft', 'presented', 'approved', 'revised', 'actuals')),
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX idx_fiscal_years_range ON fiscal_years(year_start, year_end);
CREATE INDEX idx_fiscal_years_current ON fiscal_years(is_current) WHERE is_current = TRUE;

-- Budget heads (chart of accounts)
CREATE TABLE budget_heads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL,
    full_code VARCHAR(200) NOT NULL, -- Hierarchical code like '001.01.001'
    name_en VARCHAR(500) NOT NULL,
    name_hi VARCHAR(500),
    description_en TEXT,
    description_hi TEXT,
    parent_id UUID REFERENCES budget_heads(id),
    level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
    head_type VARCHAR(20) NOT NULL CHECK (head_type IN ('revenue_receipt', 'capital_receipt', 'revenue_expenditure', 'capital_expenditure', 'public_account')),
    ministry_id UUID REFERENCES ministries(id),
    scheme_id UUID REFERENCES schemes(id),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_budget_heads_full_code ON budget_heads(full_code);
CREATE INDEX idx_budget_heads_parent ON budget_heads(parent_id);
CREATE INDEX idx_budget_heads_ministry ON budget_heads(ministry_id);
CREATE INDEX idx_budget_heads_scheme ON budget_heads(scheme_id);
CREATE INDEX idx_budget_heads_type ON budget_heads(head_type);

-- Budget allocations (partitioned by fiscal year)
CREATE TABLE budget_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id),
    budget_head_id UUID NOT NULL REFERENCES budget_heads(id),
    ministry_id UUID NOT NULL REFERENCES ministries(id),
    state_id UUID REFERENCES states(id), -- NULL for central budgets
    
    -- Amounts in rupees
    original_allocation NUMERIC(20, 2) NOT NULL DEFAULT 0,
    revised_allocation NUMERIC(20, 2),
    actual_expenditure NUMERIC(20, 2) DEFAULT 0,
    
    -- Stages
    stage VARCHAR(20) NOT NULL CHECK (stage IN ('estimate', 'revised', 'actual')),
    
    -- Metadata
    data_source VARCHAR(255),
    source_document_url VARCHAR(500),
    last_verified_at TIMESTAMPTZ,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ
);

-- Partitioning strategy for budget_allocations
-- CREATE TABLE budget_allocations_y2024 PARTITION OF budget_allocations
--     FOR VALUES IN (SELECT id FROM fiscal_years WHERE year_start = 2024);

CREATE UNIQUE INDEX idx_budget_allocations_unique 
    ON budget_allocations(fiscal_year_id, budget_head_id, ministry_id, state_id, stage)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_budget_allocations_fiscal_year ON budget_allocations(fiscal_year_id);
CREATE INDEX idx_budget_allocations_ministry ON budget_allocations(ministry_id);
CREATE INDEX idx_budget_allocations_state ON budget_allocations(state_id);
CREATE INDEX idx_budget_allocations_stage ON budget_allocations(stage);

-- Revenue collections (tax and non-tax)
CREATE TABLE revenue_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id),
    budget_head_id UUID NOT NULL REFERENCES budget_heads(id),
    state_id UUID REFERENCES states(id),
    
    -- Time granularity
    collection_month DATE, -- First day of month for monthly data
    
    -- Amounts
    target_amount NUMERIC(20, 2),
    collected_amount NUMERIC(20, 2) NOT NULL DEFAULT 0,
    
    -- Breakdown (optional JSONB for flexible categorization)
    breakdown JSONB, -- e.g., {"direct_tax": 1000, "indirect_tax": 2000}
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_revenue_collections_unique 
    ON revenue_collections(fiscal_year_id, budget_head_id, state_id, collection_month)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_revenue_collections_fiscal_year ON revenue_collections(fiscal_year_id);
CREATE INDEX idx_revenue_collections_month ON revenue_collections(collection_month);
```

### Documents & Sources

```sql
-- Source documents (budget speeches, PDFs, reports)
CREATE TABLE source_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_en VARCHAR(500) NOT NULL,
    title_hi VARCHAR(500),
    document_type VARCHAR(50) NOT NULL, -- 'budget_speech', 'annual_budget', 'audit_report', 'economic_survey'
    fiscal_year_id UUID REFERENCES fiscal_years(id),
    ministry_id UUID REFERENCES ministries(id),
    state_id UUID REFERENCES states(id),
    
    -- File info
    file_url VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    page_count INTEGER,
    
    -- Extraction metadata
    extraction_status VARCHAR(20) DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed')),
    extracted_at TIMESTAMPTZ,
    extraction_errors JSONB,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    uploaded_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_source_documents_type ON source_documents(document_type);
CREATE INDEX idx_source_documents_fiscal_year ON source_documents(fiscal_year_id);
CREATE INDEX idx_source_documents_ministry ON source_documents(ministry_id);

-- Document sections (for granular referencing)
CREATE TABLE document_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
    section_number VARCHAR(50),
    heading_en VARCHAR(500),
    heading_hi VARCHAR(500),
    content_en TEXT,
    content_hi TEXT,
    page_number INTEGER,
    paragraph_number INTEGER,
    
    -- Extracted entities
    mentioned_schemes UUID[] REFERENCES schemes(id),
    mentioned_budget_heads UUID[] REFERENCES budget_heads(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_document_sections_document ON document_sections(document_id);
```

### Search & Analytics

```sql
-- Search index materialized view (refreshed periodically)
CREATE MATERIALIZED VIEW search_index AS
SELECT 
    'budget_head' AS entity_type,
    bh.id AS entity_id,
    bh.name_en || ' ' || COALESCE(bh.name_hi, '') AS search_text,
    bh.full_code AS code,
    bh.head_type AS category,
    tsvector_concat(
        to_tsvector('english', bh.name_en),
        to_tsvector('hindi', COALESCE(bh.name_hi, ''))
    ) AS search_vector
FROM budget_heads bh
WHERE bh.deleted_at IS NULL

UNION ALL

SELECT 
    'scheme' AS entity_type,
    s.id AS entity_id,
    s.name_en || ' ' || COALESCE(s.name_hi, '') || ' ' || COALESCE(s.description_en, ''),
    s.code,
    s.scheme_type,
    tsvector_concat(
        to_tsvector('english', s.name_en || ' ' || COALESCE(s.description_en, '')),
        to_tsvector('hindi', COALESCE(s.name_hi, '') || ' ' || COALESCE(s.description_hi, ''))
    )
FROM schemes s
WHERE s.deleted_at IS NULL

UNION ALL

SELECT 
    'ministry' AS entity_type,
    m.id AS entity_id,
    m.name_en || ' ' || COALESCE(m.name_hi, ''),
    m.code,
    m.ministry_type,
    tsvector_concat(
        to_tsvector('english', m.name_en),
        to_tsvector('hindi', COALESCE(m.name_hi, ''))
    )
FROM ministries m
WHERE m.deleted_at IS NULL;

CREATE INDEX idx_search_vector ON search_index USING GIN(search_vector);
CREATE INDEX idx_search_entity_type ON search_index(entity_type);

-- User activity tracking (for analytics, privacy-compliant)
CREATE TABLE user_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    session_id UUID,
    activity_type VARCHAR(50) NOT NULL, -- 'search', 'view_budget', 'export_data', 'share'
    entity_type VARCHAR(50), -- What was accessed
    entity_id UUID, -- ID of accessed entity
    metadata JSONB, -- Additional context
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_user_activities_user ON user_activities(user_id);
CREATE INDEX idx_user_activities_type ON user_activities(activity_type);
CREATE INDEX idx_user_activities_created ON user_activities(created_at);

-- Partition by month for large-scale analytics
-- CREATE TABLE user_activities_2024_01 PARTITION OF user_activities
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### Audit & Compliance

```sql
-- Comprehensive audit log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values JSONB, -- Previous state (NULL for INSERT)
    new_values JSONB, -- New state (NULL for DELETE)
    changed_fields TEXT[], -- Array of field names that changed
    user_id UUID REFERENCES users(id),
    ip_address INET,
    user_agent TEXT,
    correlation_id UUID, -- For tracing across services
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_record ON audit_logs(record_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- Partition audit_logs by month for performance
-- This will be implemented via declarative partitioning in production
```

## Views for Common Queries

```sql
-- Budget summary by ministry and fiscal year
CREATE VIEW v_ministry_budget_summary AS
SELECT 
    fy.display_name AS fiscal_year,
    m.name_en AS ministry_name,
    m.code AS ministry_code,
    SUM(CASE WHEN bh.head_type = 'revenue_expenditure' THEN ba.original_allocation ELSE 0 END) AS revenue_expenditure,
    SUM(CASE WHEN bh.head_type = 'capital_expenditure' THEN ba.original_allocation ELSE 0 END) AS capital_expenditure,
    SUM(ba.original_allocation) AS total_allocation,
    SUM(ba.actual_expenditure) AS total_expenditure,
    COUNT(DISTINCT ba.budget_head_id) AS budget_head_count
FROM budget_allocations ba
JOIN fiscal_years fy ON ba.fiscal_year_id = fy.id
JOIN ministries m ON ba.ministry_id = m.id
JOIN budget_heads bh ON ba.budget_head_id = bh.id
WHERE ba.deleted_at IS NULL AND ba.stage = 'estimate'
GROUP BY fy.display_name, m.name_en, m.code;

-- Scheme-wise budget tracking
CREATE VIEW v_scheme_budget_tracking AS
SELECT 
    s.code AS scheme_code,
    s.name_en AS scheme_name,
    m.name_en AS ministry_name,
    fy.display_name AS fiscal_year,
    SUM(ba.original_allocation) AS allocated_amount,
    SUM(ba.actual_expenditure) AS expended_amount,
    ROUND(
        CASE 
            WHEN SUM(ba.original_allocation) > 0 
            THEN (SUM(ba.actual_expenditure) / SUM(ba.original_allocation) * 100)::NUMERIC
            ELSE 0 
        END, 2
    ) AS utilization_percentage
FROM schemes s
JOIN ministries m ON s.ministry_id = m.id
LEFT JOIN budget_heads bh ON bh.scheme_id = s.id
LEFT JOIN budget_allocations ba ON ba.budget_head_id = bh.id AND ba.stage = 'actual'
LEFT JOIN fiscal_years fy ON ba.fiscal_year_id = fy.id
WHERE s.deleted_at IS NULL
GROUP BY s.code, s.name_en, m.name_en, fy.display_name;
```

## Indexes Strategy Summary

### B-Tree Indexes (Default)
- Primary keys (automatic)
- Foreign keys (manual, for join performance)
- Unique constraints (automatic)
- Range queries (dates, amounts)

### GIN Indexes
- JSONB columns (breakdown, metadata)
- Full-text search vectors
- Array columns (mentioned_schemes, mentioned_budget_heads)

### BRIN Indexes (for time-series partitioned tables)
- `collection_month` in revenue_collections
- `created_at` in audit_logs and user_activities

### Partial Indexes
- Active records only: `WHERE deleted_at IS NULL`
- Current fiscal year: `WHERE is_current = TRUE`

## Constraints & Data Integrity

### Check Constraints
- Enum-like validations for status fields
- Numeric range validations
- Date range validations

### Foreign Key Constraints
- All references use `ON DELETE CASCADE` or `ON DELETE RESTRICT` based on business logic
- Deferrable constraints for complex migration scenarios

### Unique Constraints
- Natural keys (codes) alongside surrogate keys (UUIDs)
- Composite unique indexes for junction tables

## Backup & Recovery Strategy

### Daily Backups
- Full database dump with `pg_dump` in custom format
- Stored in object storage with lifecycle policies
- Retention: 30 days daily, 12 months monthly

### Continuous Archiving
- WAL (Write-Ahead Log) archiving to object storage
- Point-in-time recovery capability
- RPO < 1 hour as per BackendArchitecture.md

### Backup Verification
- Weekly restore tests in staging environment
- Automated backup integrity checks
- Documentation of recovery procedures in legal/ folder

## Migration Strategy

### Version Control
- All schema changes in Alembic migration scripts
- Migration scripts reviewed and tested before deployment
- Rollback scripts for every migration

### Zero-Downtime Migrations
1. Add new columns (nullable)
2. Deploy code that writes to both old and new
3. Backfill data
4. Make new column required
5. Remove old column in subsequent migration

### Data Migration Scripts
- Separate from schema migrations
- Idempotent and resumable
- Progress tracking and logging

## Security Considerations

### Row-Level Security (RLS)
- Implement RLS policies for multi-tenant scenarios
- State-specific data access controls
- Role-based filtering

### Column-Level Encryption
- Encrypt sensitive PII (phone numbers, emails)
- Use pgcrypto extension for encryption
- Key rotation procedures documented

### Audit Compliance
- All data modifications logged in audit_logs
- Immutable audit trail
- Regular audit log analysis

## Performance Optimization

### Query Optimization
- EXPLAIN ANALYZE for all complex queries
- Index usage monitoring
- Query plan caching

### Connection Pooling
- PgBouncer in transaction pooling mode
- Pool size tuned based on workload
- Connection timeout and retry logic

### Materialized Views
- Refresh strategies (concurrent refresh for zero-downtime)
- Scheduled refresh during low-traffic periods
- Dependency tracking for cascading refreshes

## References
- Vision.md: Scalability requirements
- BackendArchitecture.md: Technology choices
- PRD.md: Feature-driven table design
- InformationArchitecture.md: Data relationships
- GuidingPrinciples.md: Design principles
