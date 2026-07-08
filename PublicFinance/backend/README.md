# Backend - Public Finance Intelligence Platform

Python FastAPI backend serving the Public Finance Intelligence Platform.

## Architecture

See [BackendArchitecture.md](../docs/BackendArchitecture.md) for complete architecture documentation.

## Quick Start

### Prerequisites

- Python 3.12+
- PostgreSQL 16+
- Redis 7+
- pip or poetry

### Installation

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env

# Run migrations
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/publicfinance

# Redis
REDIS_URL=redis://localhost:6379/0

# Security
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15

# Application
ENVIRONMENT=development
DEBUG=True
API_V1_PREFIX=/api/v1
```

## Project Structure

```
backend/
├── app/
│   ├── api/v1/
│   │   ├── routes/          # API endpoint handlers
│   │   └── schemas/         # Request/response schemas
│   ├── core/                # Configuration, security, exceptions
│   ├── db/                  # Database session, base models
│   ├── models/              # SQLAlchemy ORM models
│   ├── services/            # Business logic layer
│   └── utils/               # Helper functions
├── tests/
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── e2e/                 # End-to-end tests
├── migrations/
│   └── versions/            # Alembic migration scripts
├── requirements.txt         # Python dependencies
├── alembic.ini             # Alembic configuration
└── README.md               # This file
```

## API Documentation

Once running, access:
- **Swagger UI**: http://localhost:8000/api/v1/docs
- **ReDoc**: http://localhost:8000/api/v1/redoc
- **OpenAPI JSON**: http://localhost:8000/api/v1/openapi.json

## Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/unit/test_auth.py

# Run with verbose output
pytest -v
```

## Database Migrations

```bash
# Create new migration
alembic revision --autogenerate -m "Description of changes"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1

# View migration history
alembic history
```

## Development Guidelines

1. **Follow API Specification**: All endpoints must conform to [APISpecification.md](../docs/APISpecification.md)
2. **Type Hints**: Use Python type hints everywhere
3. **Docstrings**: Document all public functions and classes
4. **Tests**: Write tests for all new functionality
5. **Security**: Never commit secrets, validate all inputs
6. **Performance**: Use async where appropriate, optimize queries

## Code Style

We use:
- **Black** for code formatting
- **isort** for import sorting
- **flake8** for linting
- **mypy** for type checking

```bash
# Format code
black app tests
isort app tests

# Lint
flake8 app tests

# Type check
mypy app
```

## Key Modules

### Authentication (`app/core/security.py`)
- JWT token generation and validation
- Password hashing (bcrypt)
- OAuth2 authentication

### Database (`app/db/session.py`)
- Async SQLAlchemy session management
- Connection pooling
- Transaction handling

### Models (`app/models/`)
- User, Role, Session models
- Budget, Ministry, Scheme models
- All models follow [DatabaseSchema.md](../docs/DatabaseSchema.md)

### Services (`app/services/`)
- Business logic implementation
- External API integrations
- Data processing pipelines

## API Versioning

Current version: **v1**

All endpoints are prefixed with `/api/v1/`. Future versions will use `/api/v2/`, etc.

Deprecation policy: 6 months notice before sunsetting any version.

## Monitoring

### Health Checks
- `GET /health` - Basic health check
- `GET /health/ready` - Readiness check (includes dependencies)
- `GET /health/live` - Liveness check

### Metrics
Prometheus metrics available at `/metrics` (when enabled)

## Security

- All passwords hashed with bcrypt
- JWT tokens with short expiration
- CORS configured for allowed origins only
- Rate limiting on all endpoints
- SQL injection prevention via parameterized queries
- XSS prevention via output encoding

## Deployment

See [infra/](../infra/) for deployment configurations:
- Docker images
- Kubernetes manifests
- Terraform infrastructure

## Troubleshooting

### Common Issues

**Database connection failed:**
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Verify DATABASE_URL in .env
```

**Redis connection failed:**
```bash
# Check Redis is running
redis-cli ping

# Should return: PONG
```

**Migration errors:**
```bash
# Check current migration state
alembic current

# Fix any issues, then:
alembic upgrade head
```

## Contributing

1. Read [GuidingPrinciples.md](../docs/GuidingPrinciples.md)
2. Create feature branch
3. Write tests
4. Ensure all tests pass
5. Submit pull request

## License

MIT License - see [LICENSE](../LICENSE)
