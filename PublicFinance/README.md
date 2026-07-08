# Public Finance Intelligence Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation Status](https://img.shields.io/badge/docs-latest-blue.svg)](./docs/README.md)
[![Android](https://img.shields.io/badge/Platform-Android-green.svg)](./android/README.md)
[![Backend](https://img.shields.io/badge/Backend-FastAPI-blue.svg)](./backend/README.md)

## Vision

A world-class Public Finance Intelligence Platform serving 100 million users across India, democratizing access to government budget data with offline-first mobile apps, multilingual support (22 languages), and AI-powered insights.

**Read the full vision:** [docs/Vision.md](./docs/Vision.md)

---

## Project Structure

```
PublicFinance/
├── docs/                    # 📚 Complete documentation (source of truth)
│   ├── README.md           # Documentation index
│   ├── Vision.md           # 10-year platform vision
│   ├── Mission.md          # Core mission statement
│   ├── CoreValues.md       # Non-negotiable values
│   ├── GuidingPrinciples.md # Engineering practices
│   ├── NonGoals.md         # Explicit out-of-scope items
│   ├── ProductPhilosophy.md # Design beliefs
│   ├── PRD.md              # Product requirements document
│   ├── InformationArchitecture.md # User flows & navigation
│   ├── DesignSystem.md     # Visual design language
│   ├── AndroidArchitecture.md # Android app architecture
│   ├── BackendArchitecture.md # Backend architecture
│   ├── DatabaseSchema.md   # Database design
│   └── APISpecification.md # REST API contracts
│
├── android/                 # 📱 Native Android application
│   ├── app/                # Main application module
│   ├── core/               # Core utilities and base classes
│   ├── features/           # Feature modules
│   ├── data/               # Data layer (repositories, sources)
│   └── ui/                 # UI components (Jetpack Compose)
│
├── backend/                 # 🔧 Python FastAPI backend
│   ├── app/                # Application code
│   │   ├── api/v1/         # API v1 endpoints
│   │   ├── core/           # Core configuration
│   │   ├── db/             # Database models and sessions
│   │   ├── models/         # Pydantic schemas
│   │   ├── services/       # Business logic
│   │   └── utils/          # Utility functions
│   ├── tests/              # Test suites
│   └── migrations/         # Database migrations
│
├── ai/                      # 🤖 AI/ML components
│   ├── models/             # ML models
│   ├── pipelines/          # Data pipelines
│   └── prompts/            # AI prompt templates
│
├── infra/                   # ☁️ Infrastructure as Code
│   ├── terraform/          # Terraform configurations
│   ├── kubernetes/         # K8s manifests
│   └── docker/             # Docker configurations
│
├── data/                    # 📊 Data pipelines
│   ├── etl/                # ETL scripts
│   ├── ingestion/          # Data ingestion
│   └── processing/         # Data processing
│
├── api/                     # 🌐 API specifications
│   ├── openapi.json        # OpenAPI 3.1 spec
│   └── postman/            # Postman collections
│
├── testing/                 # ✅ QA and testing
│   ├── automation/         # Automated test suites
│   ├── performance/        # Performance tests
│   └── accessibility/      # Accessibility audits
│
├── design/                  # 🎨 Design assets
│   ├── figma/              # Figma exports
│   ├── icons/              # Icon sets
│   └── branding/           # Brand guidelines
│
├── legal/                   # ⚖️ Legal and compliance
│   ├── licenses/           # License files
│   ├── privacy/            # Privacy policies
│   └── compliance/         # Compliance documents
│
└── prompts/                 # 💬 AI prompt templates
    ├── development/        # Development prompts
    └── documentation/      # Documentation prompts
```

---

## Quick Start

### Prerequisites

- **Python 3.12+** (for backend)
- **Android Studio Hedgehog+** (for Android app)
- **PostgreSQL 16+** (database)
- **Redis 7+** (caching)
- **Docker & Docker Compose** (local development)

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Access the API docs at: http://localhost:8000/api/v1/docs

### Android Setup

```bash
cd android

# Open in Android Studio
# Sync Gradle files
# Run on emulator or device
```

### Local Development with Docker

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

---

## Documentation

All project documentation is in the [`docs/`](./docs/) directory. Start here:

1. **[Documentation Index](./docs/README.md)** - Master index of all docs
2. **[Vision](./docs/Vision.md)** - Long-term platform vision
3. **[PRD](./docs/PRD.md)** - Product requirements
4. **[Architecture](./docs/BackendArchitecture.md)** - Technical architecture
5. **[API Spec](./docs/APISpecification.md)** - API documentation

---

## Development Workflow

We follow a **documentation-first** approach:

```
docs → architecture → API contracts → database → implementation → tests → documentation update
```

### Before Coding

1. Read relevant documentation in `docs/`
2. Ensure you understand the architecture
3. Check existing API contracts
4. Review database schema

### During Development

1. Follow established patterns
2. Write tests alongside code
3. Update documentation if needed
4. Ensure accessibility compliance

### Before Submitting

1. All tests pass
2. Documentation is updated
3. Code follows style guidelines
4. Accessibility checks pass

---

## Key Principles

From our [Guiding Principles](./docs/GuidingPrinciples.md):

- **Document before code** - Understanding precedes implementation
- **Offline by default** - Works without internet connectivity
- **Multilingual first** - Support all 22 scheduled languages
- **Accessibility non-negotiable** - WCAG 2.1 AA compliance
- **Performance matters** - Sub-second response times
- **Security always** - Defense in depth
- **Test everything** - Comprehensive test coverage
- **Measure and monitor** - Observability built-in

---

## Technology Stack

### Backend
- **Language**: Python 3.12+
- **Framework**: FastAPI
- **Database**: PostgreSQL 16+
- **Cache**: Redis 7+
- **ORM**: SQLAlchemy 2.0+
- **Migrations**: Alembic

### Android
- **Language**: Kotlin
- **UI**: Jetpack Compose
- **Architecture**: MVVM + Clean Architecture
- **Database**: Room (SQLite)
- **DI**: Hilt
- **Async**: Coroutines + Flow

### Infrastructure
- **Containerization**: Docker
- **Orchestration**: Kubernetes
- **CI/CD**: GitHub Actions
- **Monitoring**: Prometheus + Grafana
- **Logging**: ELK Stack

---

## Contributing

We welcome contributions! Please read our [Contributing Guidelines](./CONTRIBUTING.md) first.

### Ways to Contribute

- 🐛 Report bugs
- 💡 Suggest features
- 📝 Improve documentation
- 🔧 Submit code fixes
- 🌍 Translate to additional languages
- ♿ Audit accessibility

---

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

## Contact

- **Website**: https://publicfinance.in
- **Email**: hello@publicfinance.in
- **Twitter**: @PublicFinanceIN

---

*Built with ❤️ for transparency and accountability in public finance*
