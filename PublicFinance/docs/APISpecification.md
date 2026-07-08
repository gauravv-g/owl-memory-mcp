# API Specification

## Overview

This document defines the complete REST API specification for the Public Finance Intelligence Platform. The API design follows principles from Vision.md (scalability, accessibility), BackendArchitecture.md (FastAPI, RESTful conventions), PRD.md (feature requirements), and DatabaseSchema.md (data models). All endpoints support multilingual responses, pagination, filtering, and comprehensive error handling.

## API Standards

### Base URL
```
Production: https://api.publicfinance.in/api/v1
Staging: https://api-staging.publicfinance.in/api/v1
Development: http://localhost:8000/api/v1
```

### Versioning
- URL path versioning: `/api/v1/`, `/api/v2/` (future)
- Deprecation policy: 6 months notice before sunset
- Version support: Always support current and previous major version

### Content Types
- **Request**: `application/json` (default), `multipart/form-data` (file uploads)
- **Response**: `application/json`
- **Compression**: gzip supported (client sends `Accept-Encoding: gzip`)

### Authentication
- **Scheme**: Bearer token (JWT)
- **Header**: `Authorization: Bearer <token>`
- **Token Lifetime**: Access token 15 minutes, Refresh token 7 days
- **Refresh Endpoint**: `POST /auth/refresh`

### Rate Limiting
Headers included in every response:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 998
X-RateLimit-Reset: 1704067200
```

Rate limits by user tier:
- Anonymous: 100 requests/hour
- Registered: 1,000 requests/hour
- Premium: 10,000 requests/hour
- Admin: Unlimited

---

## Authentication Endpoints

### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "full_name": "Rajesh Kumar",
  "preferred_language": "hi",
  "phone_number": "+919876543210"
}
```

**Response (201 Created):**
```json
{
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "full_name": "Rajesh Kumar",
    "is_verified": false,
    "created_at": "2024-01-15T10:30:00Z"
  },
  "meta": {
    "message": "Registration successful. Please verify your email."
  }
}
```

**Errors:**
- `400 Bad Request`: Email already exists, weak password
- `429 Too Many Requests`: Rate limit exceeded

---

### POST /auth/login
Authenticate user and receive tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response (200 OK):**
```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "full_name": "Rajesh Kumar",
      "roles": ["citizen"],
      "preferred_language": "hi"
    }
  }
}
```

**Errors:**
- `401 Unauthorized`: Invalid credentials
- `403 Forbidden`: Account disabled or not verified
- `429 Too Many Requests`: Too many login attempts

---

### POST /auth/refresh
Refresh access token using refresh token.

**Request Body:**
```json
{
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4..."
}
```

**Response (200 OK):**
```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "bmV3IHJlZnJlc2ggdG9rZW4...",
    "token_type": "Bearer",
    "expires_in": 900
  }
}
```

**Errors:**
- `401 Unauthorized`: Invalid or expired refresh token
- `403 Forbidden`: Token revoked

---

### POST /auth/logout
Logout user and revoke tokens.

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "meta": {
    "message": "Successfully logged out"
  }
}
```

---

### POST /auth/forgot-password
Request password reset email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "meta": {
    "message": "If an account exists with this email, a password reset link has been sent."
  }
}
```

---

### POST /auth/reset-password
Reset password using token.

**Request Body:**
```json
{
  "token": "password_reset_token_from_email",
  "new_password": "NewSecurePass123!"
}
```

**Response (200 OK):**
```json
{
  "meta": {
    "message": "Password reset successful"
  }
}
```

---

### POST /auth/mfa/setup
Setup multi-factor authentication.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "device_type": "totp",
  "device_name": "My iPhone"
}
```

**Response (200 OK):**
```json
{
  "data": {
    "mfa_id": "mfa-uuid-here",
    "secret": "JBSWY3DPEHPK3PXP",
    "qr_code_url": "https://api.publicfinance.in/qr/mfa-uuid",
    "backup_codes": ["12345678", "87654321", ...]
  },
  "meta": {
    "message": "Scan QR code and enter verification code to complete setup"
  }
}
```

---

### POST /auth/mfa/verify
Verify MFA code during login.

**Request Body:**
```json
{
  "mfa_id": "mfa-uuid-here",
  "code": "123456"
}
```

**Response (200 OK):**
```json
{
  "data": {
    "access_token": "...",
    "refresh_token": "..."
  }
}
```

---

## Budget Endpoints

### GET /budgets
List budget allocations with filtering and pagination.

**Query Parameters:**
- `fiscal_year_id` (UUID): Filter by fiscal year
- `ministry_id` (UUID): Filter by ministry
- `state_id` (UUID): Filter by state (NULL for central budgets)
- `budget_head_id` (UUID): Filter by budget head
- `stage` (string): 'estimate', 'revised', 'actual'
- `head_type` (string): 'revenue_expenditure', 'capital_expenditure', etc.
- `min_amount` (number): Minimum allocation amount
- `max_amount` (number): Maximum allocation amount
- `page` (integer): Page number (default: 1)
- `per_page` (integer): Items per page (default: 20, max: 100)
- `sort` (string): Sort field (e.g., 'original_allocation', 'created_at')
- `order` (string): 'asc' or 'desc'

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "budget-allocation-uuid",
      "fiscal_year": {
        "id": "fy-uuid",
        "display_name": "FY 2024-25"
      },
      "ministry": {
        "id": "ministry-uuid",
        "name_en": "Ministry of Finance",
        "name_hi": "वित्त मंत्रालय",
        "code": "MOF"
      },
      "budget_head": {
        "id": "head-uuid",
        "full_code": "001.01.001",
        "name_en": "Salaries",
        "name_hi": "वेतन",
        "head_type": "revenue_expenditure"
      },
      "state": null,
      "original_allocation": 5000000000.00,
      "revised_allocation": 5200000000.00,
      "actual_expenditure": 4800000000.00,
      "stage": "estimate",
      "currency": "INR",
      "utilization_percentage": 92.31,
      "last_updated": "2024-01-10T08:00:00Z"
    }
  ],
  "meta": {
    "pagination": {
      "current_page": 1,
      "per_page": 20,
      "total_items": 1542,
      "total_pages": 78,
      "has_next": true,
      "has_prev": false,
      "next_page": 2,
      "prev_page": null
    },
    "filters_applied": {
      "fiscal_year_id": "fy-uuid",
      "stage": "estimate"
    }
  }
}
```

**Errors:**
- `400 Bad Request`: Invalid filter parameters
- `401 Unauthorized`: If authentication required for detailed data

---

### GET /budgets/{id}
Get detailed budget allocation by ID.

**Path Parameters:**
- `id` (UUID): Budget allocation ID

**Response (200 OK):**
```json
{
  "data": {
    "id": "budget-allocation-uuid",
    "fiscal_year": { ... },
    "ministry": { ... },
    "budget_head": { ... },
    "state": { ... },
    "original_allocation": 5000000000.00,
    "revised_allocation": 5200000000.00,
    "actual_expenditure": 4800000000.00,
    "stage": "actual",
    "data_source": "Union Budget 2024-25",
    "source_document_url": "https://documents.publicfinance.in/budget-2024.pdf",
    "last_verified_at": "2024-01-10T08:00:00Z",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-10T08:00:00Z"
  }
}
```

**Errors:**
- `404 Not Found`: Budget allocation not found

---

### GET /budgets/summary
Get aggregated budget summary.

**Query Parameters:**
- `fiscal_year_id` (UUID): Fiscal year (required)
- `group_by` (string): 'ministry', 'head_type', 'state'
- `ministry_id` (UUID): Optional filter

**Response (200 OK):**
```json
{
  "data": [
    {
      "group_key": "ministry-uuid",
      "group_name": "Ministry of Defence",
      "revenue_expenditure": 150000000000.00,
      "capital_expenditure": 85000000000.00,
      "total_allocation": 235000000000.00,
      "total_expenditure": 220000000000.00,
      "utilization_percentage": 93.62,
      "budget_head_count": 45
    }
  ],
  "meta": {
    "fiscal_year": "FY 2024-25",
    "grouped_by": "ministry",
    "currency": "INR",
    "last_updated": "2024-01-10T08:00:00Z"
  }
}
```

---

### GET /budgets/trends
Get budget trends over multiple fiscal years.

**Query Parameters:**
- `ministry_id` (UUID): Ministry ID (required)
- `budget_head_id` (UUID): Budget head ID (optional)
- `years` (integer): Number of years to include (default: 5, max: 10)

**Response (200 OK):**
```json
{
  "data": {
    "ministry": {
      "id": "ministry-uuid",
      "name_en": "Ministry of Education"
    },
    "trends": [
      {
        "fiscal_year": "FY 2020-21",
        "total_allocation": 95000000000.00,
        "actual_expenditure": 92000000000.00
      },
      {
        "fiscal_year": "FY 2021-22",
        "total_allocation": 102000000000.00,
        "actual_expenditure": 98000000000.00
      }
    ],
    "growth_rate": {
      "cagr_5y": 8.5,
      "yoy_latest": 12.3
    }
  }
}
```

---

## Revenue Endpoints

### GET /revenue/collections
Get revenue collection data.

**Query Parameters:**
- `fiscal_year_id` (UUID): Fiscal year
- `budget_head_id` (UUID): Revenue head
- `state_id` (UUID): State filter
- `start_date` (date): Start of period (YYYY-MM-DD)
- `end_date` (date): End of period (YYYY-MM-DD)
- `granularity` (string): 'monthly', 'quarterly', 'yearly'

**Response (200 OK):**
```json
{
  "data": [
    {
      "period": "2024-04",
      "target_amount": 100000000000.00,
      "collected_amount": 95000000000.00,
      "achievement_percentage": 95.0,
      "breakdown": {
        "direct_tax": 60000000000.00,
        "indirect_tax": 35000000000.00
      }
    }
  ],
  "meta": {
    "fiscal_year": "FY 2024-25",
    "granularity": "monthly",
    "currency": "INR"
  }
}
```

---

### GET /revenue/summary
Get revenue summary by category.

**Query Parameters:**
- `fiscal_year_id` (UUID): Fiscal year (required)
- `category` (string): 'tax', 'non_tax', 'all'

**Response (200 OK):**
```json
{
  "data": {
    "fiscal_year": "FY 2024-25",
    "total_target": 3500000000000.00,
    "total_collected": 3325000000000.00,
    "overall_achievement": 95.0,
    "by_category": [
      {
        "category": "direct_tax",
        "target": 1500000000000.00,
        "collected": 1450000000000.00,
        "achievement": 96.67
      },
      {
        "category": "indirect_tax",
        "target": 1800000000000.00,
        "collected": 170000000000.00,
        "achievement": 94.44
      }
    ]
  }
}
```

---

## Scheme Endpoints

### GET /schemes
List government schemes.

**Query Parameters:**
- `ministry_id` (UUID): Filter by ministry
- `status` (string): 'active', 'completed', 'discontinued'
- `scheme_type` (string): 'central_sector', 'centrally_sponsored', 'state_sector'
- `state_id` (UUID): For state schemes
- `search` (string): Full-text search in name and description
- `page`, `per_page`, `sort`, `order`: Pagination

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "scheme-uuid",
      "code": "PMAY-G",
      "name_en": "Pradhan Mantri Awas Yojana - Gramin",
      "name_hi": "प्रधान मंत्री आवास योजना - ग्रामीण",
      "description_en": "Affordable housing scheme for rural areas",
      "ministry": {
        "id": "ministry-uuid",
        "name_en": "Ministry of Rural Development"
      },
      "scheme_type": "centrally_sponsored",
      "status": "active",
      "start_date": "2016-04-01",
      "total_allocation": 250000000000.00,
      "currency": "INR"
    }
  ],
  "meta": {
    "pagination": { ... }
  }
}
```

---

### GET /schemes/{id}
Get detailed scheme information.

**Path Parameters:**
- `id` (UUID): Scheme ID

**Response (200 OK):**
```json
{
  "data": {
    "id": "scheme-uuid",
    "code": "PMAY-G",
    "name_en": "Pradhan Mantri Awas Yojana - Gramin",
    "name_hi": "प्रधान मंत्री आवास योजना - ग्रामीण",
    "description_en": "Full description...",
    "description_hi": "पूर्ण विवरण...",
    "ministry": { ... },
    "scheme_type": "centrally_sponsored",
    "status": "active",
    "start_date": "2016-04-01",
    "end_date": null,
    "total_allocation": 250000000000.00,
    "target_beneficiaries": "Rural households below poverty line",
    "eligibility_criteria": "Annual income below Rs. X, no pucca house",
    "budget_allocations": [
      {
        "fiscal_year": "FY 2024-25",
        "allocated": 50000000000.00,
        "expended": 45000000000.00
      }
    ],
    "created_at": "2020-01-01T00:00:00Z",
    "updated_at": "2024-01-10T08:00:00Z"
  }
}
```

---

## Search Endpoints

### GET /search
Full-text search across all entities.

**Query Parameters:**
- `q` (string): Search query (required)
- `entity_types` (array): Filter by entity types ['budget_head', 'scheme', 'ministry']
- `fiscal_year_id` (UUID): Filter by fiscal year
- `language` (string): Preferred result language ('en', 'hi', etc.)
- `page`, `per_page`: Pagination

**Response (200 OK):**
```json
{
  "data": {
    "query": "education budget",
    "results": [
      {
        "entity_type": "budget_head",
        "entity_id": "head-uuid",
        "title_en": "Education - School Education",
        "title_hi": "शिक्षा - स्कूली शिक्षा",
        "code": "001.02.001",
        "snippet_en": "Budget allocation for <mark>school education</mark> programs",
        "relevance_score": 0.95
      },
      {
        "entity_type": "scheme",
        "entity_id": "scheme-uuid",
        "title_en": "Samagra Shiksha Abhiyan",
        "title_hi": "समग्र शिक्षा अभियान",
        "code": "SSA",
        "snippet_en": "Integrated scheme for <mark>school education</mark>",
        "relevance_score": 0.89
      }
    ]
  },
  "meta": {
    "total_results": 156,
    "search_time_ms": 45,
    "pagination": { ... }
  }
}
```

---

### GET /search/suggest
Get search suggestions (autocomplete).

**Query Parameters:**
- `q` (string): Partial query (required)
- `limit` (integer): Max suggestions (default: 5, max: 10)

**Response (200 OK):**
```json
{
  "data": {
    "query": "edu",
    "suggestions": [
      "Education",
      "Education Budget",
      "Higher Education",
      "School Education",
      "Ministry of Education"
    ]
  }
}
```

---

## Entity Endpoints

### GET /ministries
List all ministries.

**Query Parameters:**
- `ministry_type` (string): 'central', 'state'
- `state_id` (UUID): For state ministries
- `search` (string): Search in name

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "ministry-uuid",
      "code": "MOF",
      "name_en": "Ministry of Finance",
      "name_hi": "वित्त मंत्रालय",
      "abbreviation_en": "MoF",
      "ministry_type": "central",
      "website_url": "https://finmin.gov.in"
    }
  ]
}
```

---

### GET /states
List states and union territories.

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "state-uuid",
      "code": "DL",
      "name_en": "Delhi",
      "name_hi": "दिल्ली",
      "type": "union_territory",
      "capital_city": "New Delhi"
    }
  ]
}
```

---

### GET /fiscal-years
List available fiscal years.

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "fy-uuid",
      "year_start": 2024,
      "year_end": 2025,
      "display_name": "FY 2024-25",
      "is_current": true,
      "budget_status": "approved"
    }
  ]
}
```

---

## Document Endpoints

### GET /documents
List source documents.

**Query Parameters:**
- `document_type` (string): 'budget_speech', 'annual_budget', etc.
- `fiscal_year_id` (UUID): Filter by fiscal year
- `ministry_id` (UUID): Filter by ministry
- `state_id` (UUID): Filter by state

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "doc-uuid",
      "title_en": "Union Budget 2024-25 Speech",
      "title_hi": "केंद्रीय बजट 2024-25 भाषण",
      "document_type": "budget_speech",
      "fiscal_year": {
        "display_name": "FY 2024-25"
      },
      "ministry": {
        "name_en": "Ministry of Finance"
      },
      "file_url": "https://documents.publicfinance.in/budget-speech-2024.pdf",
      "file_size_bytes": 2500000,
      "page_count": 45,
      "extraction_status": "completed",
      "uploaded_at": "2024-02-01T10:00:00Z"
    }
  ]
}
```

---

### GET /documents/{id}
Get document details with sections.

**Path Parameters:**
- `id` (UUID): Document ID

**Response (200 OK):**
```json
{
  "data": {
    "id": "doc-uuid",
    "title_en": "Union Budget 2024-25 Speech",
    "document_type": "budget_speech",
    "file_url": "...",
    "sections": [
      {
        "id": "section-uuid",
        "section_number": "1.1",
        "heading_en": "Economic Overview",
        "heading_hi": "आर्थिक अवलोकन",
        "content_en": "The economy grew at...",
        "page_number": 5,
        "mentioned_schemes": [...],
        "mentioned_budget_heads": [...]
      }
    ]
  }
}
```

---

## Export Endpoints

### POST /exports/budget
Export budget data to CSV/Excel.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "format": "csv",
  "filters": {
    "fiscal_year_id": "fy-uuid",
    "ministry_id": "ministry-uuid",
    "stage": "actual"
  },
  "columns": ["ministry", "budget_head", "original_allocation", "actual_expenditure"]
}
```

**Response (202 Accepted):**
```json
{
  "data": {
    "export_id": "export-uuid",
    "status": "processing",
    "estimated_completion": "2024-01-15T10:35:00Z"
  },
  "meta": {
    "message": "Export job queued. Check status at /exports/{export_id}"
  }
}
```

---

### GET /exports/{id}
Check export status and download.

**Path Parameters:**
- `id` (UUID): Export ID

**Response (200 OK - Processing):**
```json
{
  "data": {
    "id": "export-uuid",
    "status": "processing",
    "progress_percentage": 45,
    "estimated_completion": "2024-01-15T10:35:00Z"
  }
}
```

**Response (200 OK - Completed):**
```json
{
  "data": {
    "id": "export-uuid",
    "status": "completed",
    "download_url": "https://exports.publicfinance.in/export-uuid.csv",
    "expires_at": "2024-01-22T10:30:00Z",
    "file_size_bytes": 1500000
  }
}
```

---

## User Endpoints

### GET /users/me
Get current user profile.

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "data": {
    "id": "user-uuid",
    "email": "user@example.com",
    "full_name": "Rajesh Kumar",
    "preferred_language": "hi",
    "timezone": "Asia/Kolkata",
    "roles": ["citizen"],
    "is_verified": true,
    "created_at": "2024-01-01T00:00:00Z",
    "last_login_at": "2024-01-15T09:00:00Z"
  }
}
```

---

### PUT /users/me
Update current user profile.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "full_name": "Rajesh Kumar Singh",
  "preferred_language": "hi",
  "timezone": "Asia/Kolkata"
}
```

**Response (200 OK):**
```json
{
  "data": {
    "id": "user-uuid",
    "full_name": "Rajesh Kumar Singh",
    "preferred_language": "hi",
    ...
  }
}
```

---

### GET /users/me/activities
Get user activity history.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `activity_type` (string): Filter by type
- `start_date`, `end_date`: Date range
- `page`, `per_page`: Pagination

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "activity-uuid",
      "activity_type": "search",
      "metadata": {"query": "education budget"},
      "created_at": "2024-01-15T09:30:00Z"
    }
  ],
  "meta": {
    "pagination": { ... }
  }
}
```

---

## Error Responses

### Standard Error Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input provided",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ],
    "correlation_id": "req-uuid-for-debugging",
    "documentation_url": "https://docs.publicfinance.in/errors/VALIDATION_ERROR"
  }
}
```

### Common Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | VALIDATION_ERROR | Request validation failed |
| 400 | INVALID_PARAMETER | Invalid query parameter |
| 401 | UNAUTHORIZED | Missing or invalid authentication |
| 401 | TOKEN_EXPIRED | Access token has expired |
| 403 | FORBIDDEN | Insufficient permissions |
| 403 | ACCOUNT_DISABLED | User account is disabled |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Resource conflict (duplicate) |
| 422 | PROCESSING_ERROR | Data processing failed |
| 429 | RATE_LIMIT_EXCEEDED | Too many requests |
| 500 | INTERNAL_ERROR | Internal server error |
| 503 | SERVICE_UNAVAILABLE | Service temporarily unavailable |

---

## Pagination

All list endpoints support cursor-based pagination for large datasets.

### Offset-Based (Simple Lists)
```
GET /api/v1/ministries?page=2&per_page=20
```

Response includes:
```json
"meta": {
  "pagination": {
    "current_page": 2,
    "per_page": 20,
    "total_items": 150,
    "total_pages": 8,
    "has_next": true,
    "has_prev": true,
    "next_page": 3,
    "prev_page": 1
  }
}
```

### Cursor-Based (Large Datasets)
```
GET /api/v1/budgets?cursor=eyJpZCI6MTAwfQ==&per_page=20
```

Response includes:
```json
"meta": {
  "pagination": {
    "per_page": 20,
    "next_cursor": "eyJpZCI6MTIwfQ==",
    "prev_cursor": "eyJpZCI6ODB9",
    "has_next": true,
    "has_prev": true
  }
}
```

---

## Filtering & Sorting

### Filtering Operators
Standard operators for numeric and date fields:
- `gte`: Greater than or equal
- `lte`: Less than or equal
- `gt`: Greater than
- `lt`: Less than
- `ne`: Not equal

Example:
```
GET /api/v1/budgets?original_allocation[gte]=1000000000&stage=actual
```

### Sorting
```
GET /api/v1/budgets?sort=original_allocation&order=desc
```

Multiple sort fields:
```
GET /api/v1/budgets?sort=ministry.name_en,budget_head.full_code&order=asc,desc
```

---

## Localization

### Accept-Language Header
Clients can specify preferred language:
```
Accept-Language: hi-IN,hi;q=0.9,en;q=0.8
```

### Response Localization
All text fields include both English and Hindi where available:
```json
{
  "name_en": "Ministry of Finance",
  "name_hi": "वित्त मंत्रालय"
}
```

### Error Messages
Error messages respect Accept-Language header when available.

---

## OpenAPI Specification

The complete OpenAPI 3.1 specification is available at:
- JSON: `GET /api/v1/openapi.json`
- Interactive UI: `GET /api/v1/docs` (Swagger UI)
- Alternative UI: `GET /api/v1/redoc` (ReDoc)

---

## References
- Vision.md: Platform goals and scalability requirements
- BackendArchitecture.md: API design principles and technology stack
- PRD.md: Feature requirements driving API endpoints
- DatabaseSchema.md: Data models informing request/response structures
- DesignSystem.md: Consistency standards for API responses
