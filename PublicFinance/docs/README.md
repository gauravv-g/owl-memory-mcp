# Documentation Index

This document serves as the master index for all project documentation in the Public Finance Intelligence Platform repository.

## Document Hierarchy

### Level 1: Strategic Foundation
These documents define the "why" and "what" of the platform.

| Document | Purpose | Status |
|----------|---------|--------|
| [Vision.md](./Vision.md) | 10-year vision for serving 100M users | ✅ Complete |
| [Mission.md](./Mission.md) | Core mission statement | ✅ Complete |
| [CoreValues.md](./CoreValues.md) | 8 non-negotiable values | ✅ Complete |
| [GuidingPrinciples.md](./GuidingPrinciples.md) | Daily engineering practices | ✅ Complete |
| [NonGoals.md](./NonGoals.md) | Explicit out-of-scope items | ✅ Complete |
| [ProductPhilosophy.md](./ProductPhilosophy.md) | 12 design beliefs | ✅ Complete |

### Level 2: Product Definition
These documents define the product requirements and user experience.

| Document | Purpose | Status |
|----------|---------|--------|
| [PRD.md](./PRD.md) | Complete product requirements | ✅ Complete |
| [InformationArchitecture.md](./InformationArchitecture.md) | User flows, navigation, data architecture | ✅ Complete |
| [DesignSystem.md](./DesignSystem.md) | Visual design language and components | ✅ Complete |

### Level 3: Technical Architecture
These documents define the technical implementation strategy.

| Document | Purpose | Status |
|----------|---------|--------|
| [AndroidArchitecture.md](./AndroidArchitecture.md) | Native Android app architecture | ✅ Complete |
| [BackendArchitecture.md](./BackendArchitecture.md) | Server-side architecture and infrastructure | ✅ Complete |
| [DatabaseSchema.md](./DatabaseSchema.md) | Complete database design | ✅ Complete |
| [APISpecification.md](./APISpecification.md) | REST API contracts | ✅ Complete |

### Level 4: Implementation (Future)
These will be created during implementation phases.

| Document | Purpose | Status |
|----------|---------|--------|
| `SearchModuleSpec.md` | Search feature implementation | ⏳ Pending |
| `BudgetExplorerSpec.md` | Budget explorer implementation | ⏳ Pending |
| `AISummarySpec.md` | AI summary feature implementation | ⏳ Pending |
| `TestingStrategy.md` | Comprehensive testing approach | ⏳ Pending |
| `DeploymentGuide.md` | Production deployment procedures | ⏳ Pending |
| `SecurityRunbook.md` | Security incident response | ⏳ Pending |

### Level 5: Operations (Future)
These will be created before launch.

| Document | Purpose | Status |
|----------|---------|--------|
| `OnCallGuide.md` | Operational procedures | ⏳ Pending |
| `MonitoringDashboards.md` | Observability setup | ⏳ Pending |
| `DisasterRecovery.md` | DR procedures and runbooks | ⏳ Pending |
| `ComplianceChecklist.md` | Regulatory compliance | ⏳ Pending |

---

## Cross-Reference Matrix

This matrix shows how documents reference each other, ensuring coherence.

| From \ To | Vision | Mission | Values | Principles | PRD | IA | Design | Android | Backend | DB | API |
|-----------|--------|---------|--------|------------|-----|----|--------|---------|---------|----|----|
| Vision    | -      | ✓       | ✓      | ✓          | ✓   | ✓  | ✓      | ✓       | ✓       | ✓  | ✓  |
| Mission   | ✓      | -       | ✓      | ✓          | ✓   | -  | -      | -       | -       | -  | -  |
| Values    | ✓      | ✓       | -      | ✓          | ✓   | -  | ✓      | ✓       | ✓       | -  | -  |
| Principles| ✓      | ✓       | ✓      | -          | ✓   | ✓  | ✓      | ✓       | ✓       | ✓  | ✓  |
| PRD       | ✓      | ✓       | ✓      | ✓          | -   | ✓  | ✓      | ✓       | ✓       | ✓  | ✓  |
| IA        | ✓      | -       | -      | ✓          | ✓   | -  | ✓      | ✓       | ✓       | ✓  | -  |
| Design    | ✓      | -       | ✓      | ✓          | ✓   | ✓  | -      | ✓       | -       | -  | -  |
| Android   | ✓      | -       | ✓      | ✓          | ✓   | ✓  | ✓      | -       | ✓       | ✓  | ✓  |
| Backend   | ✓      | -       | -      | ✓          | ✓   | ✓  | -      | ✓       | -       | ✓  | ✓  |
| DB        | ✓      | -       | -      | ✓          | ✓   | ✓  | -      | ✓       | ✓       | -  | ✓  |
| API       | ✓      | -       | -      | ✓          | ✓   | -  | ✓      | ✓       | ✓       | ✓  | -  |

✓ = References this document

---

## Document Update Protocol

When making changes to any document:

1. **Identify Dependencies**: Check the cross-reference matrix
2. **Update Sequentially**: Update dependent documents in order
3. **Version Notes**: Add changelog entry at bottom of document
4. **Review**: Ensure consistency across all references
5. **Commit**: Use descriptive commit messages referencing document names

Example changelog entry format:
```markdown
## Changelog
- 2024-01-15: Initial version
- 2024-01-20: Updated scalability targets per Vision.md v1.1
```

---

## Decision Log

Major architectural decisions tracked here with links to detailed discussions.

| ID | Date | Decision | ADR Location | Status |
|----|------|----------|--------------|--------|
| ADR-001 | 2024-01-15 | Modular Monolith over Microservices | `/docs/adr/001-modular-monolith.md` | Accepted |
| ADR-002 | 2024-01-15 | PostgreSQL as Primary Database | `/docs/adr/002-postgresql.md` | Accepted |
| ADR-003 | 2024-01-15 | Kotlin + Jetpack Compose for Android | `/docs/adr/003-android-stack.md` | Accepted |
| ADR-004 | 2024-01-15 | FastAPI for Backend Framework | `/docs/adr/004-fastapi.md` | Accepted |
| ADR-005 | 2024-01-15 | Offline-First Architecture | `/docs/adr/005-offline-first.md` | Accepted |
| ADR-006 | 2024-01-15 | Multilingual Support (22 Languages) | `/docs/adr/006-multilingual.md` | Accepted |

---

## Quick Start for New Team Members

Read documents in this order:

1. **Day 1**: Vision.md → Mission.md → CoreValues.md
2. **Day 2**: PRD.md → InformationArchitecture.md
3. **Day 3**: DesignSystem.md → AndroidArchitecture.md / BackendArchitecture.md
4. **Day 4**: DatabaseSchema.md → APISpecification.md
5. **Day 5**: Start implementing with first feature spec

---

## Governance

### Document Ownership
Each document has an assigned owner responsible for accuracy:

| Document | Owner | Last Review | Next Review |
|----------|-------|-------------|-------------|
| Vision.md | Product Lead | 2024-01-15 | 2024-07-15 |
| PRD.md | Product Manager | 2024-01-15 | 2024-04-15 |
| BackendArchitecture.md | Staff Backend Engineer | 2024-01-15 | 2024-04-15 |
| AndroidArchitecture.md | Staff Android Engineer | 2024-01-15 | 2024-04-15 |
| DatabaseSchema.md | Staff Backend Engineer | 2024-01-15 | 2024-04-15 |
| APISpecification.md | Staff Backend Engineer | 2024-01-15 | 2024-04-15 |

### Review Cadence
- **Strategic docs** (Vision, Mission, Values): Quarterly review
- **Product docs** (PRD, IA, Design): Monthly review during development
- **Technical docs** (Architecture, DB, API): Bi-weekly review during active development

---

## Related Directories

```
PublicFinance/
├── docs/           # This directory - All documentation
├── prompts/        # Prompt templates for AI-assisted development
├── android/        # Android application source code
├── backend/        # Backend application source code
├── ai/             # AI models and ML pipelines
├── infra/          # Infrastructure as Code (Terraform, K8s)
├── data/           # Data pipelines and ETL scripts
├── api/            # API specifications (OpenAPI, GraphQL schemas)
├── testing/        # Test suites and QA automation
├── design/         # Design files (Figma exports, assets)
└── legal/          # Legal documents, licenses, compliance
```

---

## Version Control

All documentation follows semantic versioning principles:
- **Major**: Breaking changes to architecture or product direction
- **Minor**: New features or significant additions
- **Patch**: Clarifications, typo fixes, minor updates

Git tags for major milestones:
- `docs-v1.0.0`: Initial complete documentation set
- `docs-v1.1.0`: Post-implementation refinements

---

*Last updated: 2024-01-15*
*Document version: 1.0.0*
