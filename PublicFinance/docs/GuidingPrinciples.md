# Guiding Principles

## Product Development Principles

### P1: Document Before Code
No feature is built without first documenting the problem, user need, acceptance criteria, and success metrics. Documentation lives in `/docs` and is version-controlled alongside code.

### P2: Read Existing Docs First
Before proposing any change, engineers must read relevant existing documentation. Every new document must reference related documents. This prevents contradictory decisions and maintains coherence.

### P3: One Source of Truth
Each concept has exactly one authoritative location. Data models live in `docs/database/`. API contracts live in `docs/api/`. UI patterns live in `docs/design/`. No duplication across documents.

### P4: Progressive Disclosure
Design information layers: Summary (5 seconds) → Overview (30 seconds) → Details (5 minutes) → Raw Data (expert). Users choose their depth; we never force either extreme.

### P5: Offline by Default
Assume no connectivity. Design features to work fully offline, then add sync as an enhancement—not the reverse. Test in airplane mode before testing on WiFi.

### P6: Language Parity
No feature ships in English only. All user-facing text must be translatable from day one. Launch languages are prioritized, but architecture supports all 22 scheduled languages equally.

### P7: Performance Budget
Every feature has a performance budget: maximum app size increase, maximum memory usage, maximum battery impact, maximum network transfer. Exceeding budget requires explicit exception.

### P8: Accessibility Checklist
Every screen passes WCAG 2.1 AA checklist before merge: color contrast, touch target size, screen reader labels, keyboard navigation, focus order, error identification.

---

## Architecture Principles

### A1: Modular Monolith First
Start with a well-modularized monolith. Extract microservices only when scaling demands it. Premature distribution creates unnecessary complexity.

### A2: Database Is Source of Truth
The database schema is the canonical data model. ORMs are convenience layers, not abstraction boundaries. Migrations are versioned and reversible.

### A3: API Contracts Are Immutable
Once an API is published, it cannot break. Add new endpoints or versions; never modify or remove existing behavior without deprecation period.

### A4: Caching Is a Feature, Not Optimization
Design cache invalidation strategies before implementing caching. Define freshness requirements per data type. Cache at multiple layers: CDN, application, database.

### A5: Observability Built-In
Logging, metrics, and tracing are not added post-launch. Every service emits structured logs, standard metrics, and distributed traces from day one.

### A6: Security by Design
Threat modeling happens during design, not before launch. Principle of least privilege applied everywhere. Secrets never in code or configs.

### A7: Dependency Minimization
Every external dependency is a liability. Prefer standard library over packages. Audit all dependencies quarterly. Pin all versions explicitly.

### A8: Test Pyramid Discipline
70% unit tests, 20% integration tests, 10% end-to-end tests. Tests are fast, deterministic, and isolated. Flaky tests block merges.

---

## Engineering Culture Principles

### E1: Assume Good Intent
Critique ideas, not people. Ask clarifying questions before objecting. Offer alternatives when pointing out problems.

### E2: Write Things Down
Decisions made in meetings don't count until documented. Async written communication preferred over synchronous verbal discussion for important topics.

### E3: Blameless Post-Mortems
When things break, focus on systemic fixes, not individual blame. Every incident produces actionable improvements to prevent recurrence.

### E4: Continuous Learning
Dedicate time weekly for learning. Share knowledge through internal docs, tech talks, and code reviews. No knowledge silos.

### E5: Sustainable Pace
Heroics indicate system problems, not virtue. Regular 40-hour weeks produce better long-term outcomes than periodic crunches.

### E6: User Proximity
Engineers regularly observe real users, read support tickets, and conduct usability tests. Distance from users correlates with poor product decisions.

### E7: Incremental Deployment
Ship small changes frequently. Large releases increase risk and delay feedback. Feature flags enable safe incremental rollouts.

### E8: Data-Driven Decisions
Opinions are welcome; decisions require data. Define success metrics before launching features. Measure actual behavior, not self-reported preferences.

---

## Decision-Making Framework

When facing ambiguity, apply this hierarchy:

1. **Vision Alignment**: Does this advance the Vision Document?
2. **User Impact**: How does this affect user experience?
3. **Long-Term Maintainability**: Will this make future changes easier or harder?
4. **Scalability**: Does this work at 100 million users?
5. **Resource Efficiency**: Is this the simplest solution that works?

If principles conflict, escalate with written analysis referencing specific principles.

---

*These Guiding Principles operationalize Core Values into daily engineering practice. Reference these principles in design docs, code reviews, and retrospectives.*
