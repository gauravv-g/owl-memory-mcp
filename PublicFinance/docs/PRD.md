# Product Requirements Document (PRD)
## Public Finance Intelligence Platform

**Version**: 1.0  
**Status**: Approved  
**Derived From**: [Vision.md](./Vision.md), [Mission.md](./Mission.md), [CoreValues.md](./CoreValues.md)  
**Last Updated**: 2024

---

## 1. Goals

### 1.1 Primary Goals (Phase 1 - Year 1)

| Goal | Success Metric | Target |
|------|---------------|--------|
| Enable citizens to understand Union Budget | 70% of users can explain budget impact after using app | NPS > 50 |
| Provide searchable budget database | Search success rate > 85% | P95 latency < 500ms |
| Deliver AI summaries in Hindi + English | Summary helpfulness rating > 4/5 | 1M summaries generated/month |
| Build offline-capable Android app | 90% core features work offline | APK size < 50MB |
| Establish data trust | 0 critical data accuracy incidents | Source citation on every number |

### 1.2 Secondary Goals (Phase 2 - Year 2)

- Expand to all 28 states + 8 UTs
- Add 10 regional languages
- Launch web application
- Introduce expenditure tracking
- Open public API for developers

### 1.3 Long-term Goals (Phase 3-5)

- District-level granularity
- All 22 scheduled languages
- Predictive analytics
- Participatory budgeting features
- 100M MAU achievement

---

## 2. Users

### 2.1 Primary Personas

#### Persona 1: Concerned Citizen (Rajesh)
- **Demographics**: 35 years old, small business owner, Tier 2 city
- **Tech Profile**: Mid-range Android phone, Jio 4G, first-time smartphone user in family
- **Needs**: Understand how budget affects his business, track local development funds
- **Pain Points**: Government websites confusing, English-only content, requires high bandwidth
- **Success Scenario**: "I want to know how much money my city got for roads and whether it was spent properly"

#### Persona 2: Journalist (Priya)
- **Demographics**: 28 years old, investigative reporter, national newspaper
- **Tech Profile**: High-end Android + laptop, reliable broadband, power user
- **Needs**: Quick data access for stories, comparative analysis, source verification
- **Pain Points**: Data scattered across portals, inconsistent formats, no historical comparison
- **Success Scenario**: "I need to compare education spending across 5 states for tomorrow's article"

#### Persona 3: Researcher (Dr. Sharma)
- **Demographics**: 52 years old, economics professor, university researcher
- **Tech Profile**: Laptop primary, occasional tablet use, institutional internet
- **Needs**: Granular data download, time-series analysis, methodology transparency
- **Pain Points**: No bulk download, unclear data sources, missing metadata
- **Success Scenario**: "I need 10 years of health budget data across all states for my paper"

#### Persona 4: Civil Society Activist (Fatima)
- **Demographics**: 41 years old, NGO director, rural development focus
- **Tech Profile**: Shared Android device, intermittent connectivity, multiple languages
- **Needs**: Track scheme implementation, community awareness materials, grievance evidence
- **Pain Points**: Offline access unavailable, no local language content, complex interfaces
- **Success Scenario**: "I need to show villagers their entitled funds under MGNREGA in Urdu"

### 2.2 User Segments

| Segment | Size (Target) | Primary Channel | Key Features |
|---------|--------------|-----------------|--------------|
| General Citizens | 80M | Android App | Search, AI Summary, Alerts |
| Media & Researchers | 500K | Web + API | Advanced Filters, Bulk Export |
| Civil Society | 5M | Android App | Offline Mode, Local Language |
| Students/Educators | 10M | Android + Web | Explainer Content, Quizzes |
| Developers | 100K | API Portal | Documentation, Sandboxes |

---

## 3. Use Cases

### 3.1 Core Use Cases (Phase 1)

#### UC-001: Search Budget Information
- **Actor**: Any user
- **Trigger**: User wants to find information about a scheme/department/constituency
- **Flow**: 
  1. User opens search bar
  2. Types query in English or Hindi
  3. System shows results with relevance ranking
  4. User selects result to view details
- **Success**: Relevant results in < 1 second
- **Failure**: No results → Show suggestions, spelling correction

#### UC-002: View Budget Summary
- **Actor**: Concerned Citizen
- **Trigger**: User wants to understand overall budget allocation
- **Flow**:
  1. User navigates to Budget Explorer
  2. Selects year (default: current)
  3. Views high-level allocation by ministry
  4. Drills down to specific schemes
  5. Reads AI-generated summary in preferred language
- **Success**: User understands top 5 allocations in < 2 minutes

#### UC-003: Track Money Flow
- **Actor**: Journalist, Activist
- **Trigger**: User wants to follow funds from allocation to implementation
- **Flow**:
  1. User selects a scheme
  2. Views allocation → release → utilization chain
  3. Sees geographic breakdown (State → District → Block)
  4. Checks timelines and delays
- **Success**: Complete traceability with source documents linked

#### UC-004: Compare Across Regions/Time
- **Actor**: Researcher, Journalist
- **Trigger**: User wants comparative analysis
- **Flow**:
  1. User selects comparison mode
  2. Chooses 2-5 regions or years
  3. Views side-by-side metrics
  4. Exports comparison chart/data
- **Success**: Clear visualization of differences with statistical significance

#### UC-005: Receive Personalized Alerts
- **Actor**: Concerned Citizen
- **Trigger**: User wants notifications about their area/interests
- **Flow**:
  1. User sets location (constituency/district)
  2. Selects topics of interest (education, health, infrastructure)
  3. Receives push notifications when relevant data updates
  4. Taps notification to view details
- **Success**: Timely, relevant alerts without spam

#### UC-006: Use App Offline
- **Actor**: Rural user with poor connectivity
- **Trigger**: User has no internet connection
- **Flow**:
  1. User opens app in offline mode
  2. Accesses previously loaded data
  3. Performs searches on cached content
  4. Queues actions for sync when online
- **Success**: Core features fully functional without connectivity

#### UC-007: Change Language
- **Actor**: Non-English speaker
- **Trigger**: User prefers content in native language
- **Flow**:
  1. User opens settings
  2. Selects language from 22+ options
  3. All UI and content translates instantly
  4. Preference persists across sessions
- **Success**: Full feature parity in all languages

### 3.2 Edge Use Cases

#### UC-E01: First-Time User Onboarding
- Low-literacy users need voice-guided tutorial
- Progressive permission requests (location, notifications)
- Minimal initial download with on-demand data fetching

#### UC-E02: Data Discrepancy Reporting
- Users can flag potentially incorrect data
- Structured feedback form with screenshot attachment
- Public issue tracker for transparency

#### UC-E03: Accessibility Mode
- Screen reader optimization
- High contrast themes
- Voice navigation throughout app
- Simplified layout for cognitive accessibility

---

## 4. Features

### 4.1 Phase 1 Features (MVP - Months 1-6)

| ID | Feature | Priority | Description | Acceptance Criteria |
|----|---------|----------|-------------|---------------------|
| F-001 | Unified Search | P0 | Single search bar for all budget data | Returns relevant results in <1s, supports Hindi+English |
| F-002 | Budget Explorer | P0 | Interactive visualization of Union Budget | Drill-down from ministry to scheme level |
| F-003 | AI Summaries | P0 | GPT-powered explanations of budget items | 90% accuracy rating, source citations included |
| F-004 | Offline Cache | P0 | Store frequently accessed data locally | Works without internet for 7 days of content |
| F-005 | Language Toggle | P0 | Switch between Hindi and English | Instant translation, persistent preference |
| F-006 | Source Documents | P0 | Link to original government PDFs/CSVs | Every number clickable to source |
| F-007 | Basic Alerts | P1 | Push notifications for budget updates | User-configurable by topic/location |
| F-008 | Share Functionality | P1 | Share insights via WhatsApp/SMS | Generates image + text summary |
| F-009 | Feedback Mechanism | P1 | Report errors or suggest improvements | Structured form with category selection |
| F-010 | Onboarding Flow | P1 | First-time user guidance | Completable in <3 minutes, skippable |

### 4.2 Phase 2 Features (Months 7-18)

| ID | Feature | Priority | Description |
|----|---------|----------|-------------|
| F-011 | State Budgets | P0 | All 28 states + 8 UTs data |
| F-012 | Expenditure Tracker | P0 | Actual spending vs allocated budgets |
| F-013 | 10 Regional Languages | P0 | Bengali, Telugu, Marathi, Tamil, Gujarati, etc. |
| F-014 | Web Application | P0 | Responsive web app with full features |
| F-015 | Comparison Tool | P1 | Side-by-side region/year comparison |
| F-016 | Data Export | P1 | CSV/PDF download for researchers |
| F-017 | Time Series Charts | P1 | Historical trends (10+ years) |
| F-018 | Advanced Filters | P1 | Filter by ministry, scheme, geography, year |
| F-019 | Developer API | P1 | RESTful API with authentication |
| F-020 | Analytics Dashboard | P2 | Usage metrics, popular searches, trends |

### 4.3 Phase 3+ Features (Year 2+)

- District-level data granularity
- All 22 scheduled languages
- Predictive budget modeling
- Participatory budgeting simulation
- Voice-first interface
- AR visualization for complex data
- Integration with government grievance portals
- Global expansion framework

---

## 5. Screens

### 5.1 Mobile App Screens (Android)

| Screen ID | Screen Name | Purpose | Key Elements |
|-----------|-------------|---------|--------------|
| S-001 | Splash Screen | Brand intro, version check | Logo, tagline, loading indicator |
| S-002 | Onboarding 1-4 | Feature introduction | Illustrations, benefits, skip button |
| S-003 | Permission Request | Location, notifications | Clear value prop, allow/deny |
| S-004 | Home Dashboard | Personalized overview | Search bar, recent items, alerts, quick actions |
| S-005 | Search Results | Display search results | Result cards, filters, sorting, pagination |
| S-006 | Search Empty State | No results found | Suggestions, spelling correction, help link |
| S-007 | Budget Overview | High-level budget view | Sunburst chart, key numbers, year selector |
| S-008 | Ministry Detail | Specific ministry breakdown | Allocation chart, schemes list, AI summary |
| S-009 | Scheme Detail | Individual scheme info | Budget flow, beneficiaries, documents, map |
| S-010 | Money Flow Visualization | Fund tracing | Sankey diagram, timeline, geographic breakdown |
| S-011 | Comparison View | Multi-region/year compare | Side-by-side cards, charts, export button |
| S-012 | AI Summary Modal | Detailed explanation | Natural language text, sources, confidence score |
| S-013 | Alerts List | Notification center | Categorized alerts, read/unread, filter |
| S-014 | Alert Detail | Specific alert info | Context, related data, action buttons |
| S-015 | Settings | App configuration | Language, location, notifications, data usage |
| S-016 | Language Selector | Choose preferred language | List of 22 languages, search, preview |
| S-017 | Location Selector | Set constituency/district | Map picker, search, auto-detect |
| S-018 | About & Sources | Transparency info | Data sources, methodology, team, contact |
| S-019 | Feedback Form | Report issues | Category, description, screenshot upload |
| S-020 | Offline Indicator | Connectivity status | Banner, cached content notice, sync button |
| S-021 | Error State | Handle failures | Friendly message, retry, support link |
| S-022 | Accessibility Settings | A11y configuration | Font size, contrast, screen reader mode |

### 5.2 Web App Screens (Phase 2)

| Screen ID | Screen Name | Purpose |
|-----------|-------------|---------|
| W-001 | Landing Page | Marketing + immediate search |
| W-002 | Authentication | Login/signup for API access |
| W-003 | Advanced Search | Complex queries with filters |
| W-004 | Data Explorer | Interactive tables and charts |
| W-005 | API Documentation | Developer portal |
| W-006 | Bulk Download | Dataset selection and export |
| W-007 | Research Hub | Publications, case studies |
| W-008 | Admin Dashboard | Internal moderation tools |

---

## 6. Navigation

### 6.1 Mobile App Navigation Structure

```
Bottom Navigation Bar (5 tabs):
├── Home (S-004)
├── Explore (S-007)
├── Search (S-005) - Central FAB
├── Alerts (S-013)
└── Profile (S-015)

Hierarchical Navigation:
Home → Ministry Detail → Scheme Detail → Money Flow
Search → Search Results → Scheme Detail
Explore → Budget Overview → Ministry Detail
Alerts → Alert Detail → Related Scheme

Global Actions:
├── Language Switcher (Settings or Quick Toggle)
├── Location Selector (Home header)
├── Search (Persistent in header)
└── Offline Indicator (Status bar)
```

### 6.2 Navigation Principles

1. **Three-Tap Rule**: Any screen reachable within 3 taps from Home
2. **Persistent Search**: Search bar always accessible in header
3. **Breadcrumb Trails**: Show path for deep screens (e.g., Home > Education > NEP 2020)
4. **Gesture Support**: Swipe back, pull to refresh, long-press for context menu
5. **Deep Linking**: Every screen has unique URL for sharing

### 6.3 User Journey Maps

#### Journey 1: Rajesh checks road funding
```
1. Opens app → Home Dashboard (S-004)
2. Sees "Your Constituency" card → Taps
3. Views local allocations → Selects "Roads & Transport"
4. Reads scheme details (S-009) → Checks money flow (S-010)
5. Shares via WhatsApp → Closes app
Total time: < 2 minutes
```

#### Journey 2: Priya researches education spending
```
1. Opens app → Search (S-005)
2. Types "education budget 2024" → Views results
3. Filters by "Ministry of Education" → Selects top result
4. Uses comparison tool (S-011) → Compares 5 states
5. Exports data as CSV → Cites in article
Total time: < 5 minutes
```

#### Journey 3: Fatima works offline in village
```
1. Opens app in no-network area → Sees offline banner (S-020)
2. Accesses cached MGNREGA data → Shows villagers
3. Takes screenshots for meeting → Queues feedback
4. Returns to network → Auto-syncs queued actions
Total time: Unlimited offline usage
```

---

## 7. Acceptance Criteria

### 7.1 Functional Requirements

#### FR-001: Search Performance
- [ ] Search returns results in < 1 second (P95)
- [ ] Supports fuzzy matching and spelling correction
- [ ] Handles Hindi and English queries equally well
- [ ] Shows minimum 10 results per page with infinite scroll
- [ ] Zero results state provides helpful suggestions

#### FR-002: AI Summary Quality
- [ ] Every budget item has AI-generated summary
- [ ] Summaries include source citations with links
- [ ] Confidence score displayed (High/Medium/Low)
- [ ] User can rate helpfulness (thumbs up/down)
- [ ] Summaries available in selected language

#### FR-003: Offline Functionality
- [ ] App loads without internet connection
- [ ] Previously viewed screens accessible offline
- [ ] Search works on cached data
- [ ] Actions queue for background sync
- [ ] Clear indicator of offline status and data freshness

#### FR-004: Language Support
- [ ] UI fully translated (no hardcoded English strings)
- [ ] Content translated with human review for accuracy
- [ ] Language switch is instant (no reload)
- [ ] Preference persists across app restarts
- [ ] Right-to-left support if needed (future languages)

#### FR-005: Data Accuracy
- [ ] Every number links to source document
- [ ] Data versioning with last-updated timestamp
- [ ] Discrepancy reporting mechanism functional
- [ ] Automated validation against source totals
- [ ] Audit log for all data transformations

### 7.2 Non-Functional Requirements

#### NFR-001: Performance
- Cold start time: < 2 seconds on mid-range Android
- Screen transition: < 300ms
- API response: P95 < 500ms globally
- App size: < 50MB download, < 100MB installed
- Battery usage: < 5% per hour of active use

#### NFR-002: Reliability
- Uptime: 99.9% for backend services
- Crash-free sessions: > 99.5%
- Data loss prevention: Auto-save every user action
- Graceful degradation when services fail
- Retry logic with exponential backoff

#### NFR-003: Security
- All data encrypted in transit (TLS 1.3)
- Sensitive data encrypted at rest
- No PII stored without explicit consent
- Regular security audits and penetration testing
- Compliance with India DPDP Act 2023

#### NFR-004: Accessibility
- WCAG 2.1 AA compliance
- Screen reader compatibility (TalkBack)
- Minimum touch target 48dp
- Color contrast ratio ≥ 4.5:1
- Keyboard navigation support (web)

#### NFR-005: Scalability
- Support 100K concurrent users (Phase 1)
- Horizontal scaling architecture
- CDN for static assets globally
- Database read replicas for load distribution
- Rate limiting to prevent abuse

---

## 8. Edge Cases

### 8.1 Technical Edge Cases

| Edge Case | Handling Strategy |
|-----------|------------------|
| Network drops mid-request | Retry with idempotency keys, show progress indicator |
| Server returns 500 error | Friendly error message, retry button, report option |
| Corrupted local cache | Auto-clear and re-download affected data |
| API rate limit exceeded | Exponential backoff, queue requests, notify user |
| Outdated app version | Force update prompt with changelog |
| Device storage full | Warn user, offer to clear cache, reduce data quality |
| Timezone mismatches | Store all timestamps in UTC, display in local timezone |
| Leap year/date edge cases | Use standard date libraries, extensive testing |

### 8.2 Data Edge Cases

| Edge Case | Handling Strategy |
|-----------|------------------|
| Missing budget data for year | Show "Data not available" with explanation, suggest alternatives |
| Inconsistent data across sources | Flag discrepancy, show both values with sources |
| Revised budgets vs original | Clearly label versions, show comparison |
| Currency format variations | Standardize to INR with locale-specific formatting |
| Extremely large numbers | Use Indian numbering system (lakhs/crores) with toggle |
| Special characters in names | Proper Unicode handling, escape sequences |
| Duplicate scheme names | Disambiguate with year, ministry, unique ID |

### 8.3 User Behavior Edge Cases

| Edge Case | Handling Strategy |
|-----------|------------------|
| User denies all permissions | Degrade gracefully, explain benefits, allow manual input |
| Rapid repeated searches | Implement debouncing, show loading states |
| User switches language mid-flow | Preserve context, translate current screen |
| Multiple users on shared device | No login required for basic features, optional profiles |
| Accessibility features enabled | Detect and optimize automatically |
| User tries to access premium feature | Clear messaging about free tier, no paywall surprises |

---

## 9. Success Metrics

### 9.1 North Star Metric

**Weekly Active Users (WAU) who complete a "Value Moment"**
- Value Moment defined as: Search + View Details + Read AI Summary
- Target: 10M WAU by end of Year 1

### 9.2 Acquisition Metrics

| Metric | Baseline | Target (Y1) | Measurement |
|--------|----------|-------------|-------------|
| App Downloads | 0 | 5M | Play Store Console |
| Install-to-Open Rate | - | > 80% | Firebase Analytics |
| Organic vs Paid | - | > 90% organic | Attribution tracking |
| Viral Coefficient | - | > 0.5 | Share tracking |

### 9.3 Engagement Metrics

| Metric | Target | Definition |
|--------|--------|------------|
| DAU/WAU Ratio | > 40% | Stickiness |
| Session Duration | > 3 minutes | Average time in app |
| Sessions per User/Week | > 3 | Frequency |
| Search Success Rate | > 85% | Searches with clicks |
| Feature Adoption | > 60% | Users trying 3+ features |
| Retention D1/D7/D30 | 50%/30%/20% | Cohort retention |

### 9.4 Quality Metrics

| Metric | Target | Threshold |
|--------|--------|-----------|
| Crash-Free Sessions | > 99.5% | Alert if < 99% |
| ANR Rate | < 0.1% | Alert if > 0.3% |
| API Error Rate | < 0.5% | Alert if > 1% |
| P95 Latency | < 500ms | Alert if > 1s |
| App Store Rating | > 4.5 stars | Monitor reviews |

### 9.5 Impact Metrics

| Metric | Measurement Method | Target |
|--------|-------------------|--------|
| User Comprehension | In-app quizzes | 70% pass rate |
| Media Citations | Manual tracking | 100+ articles/year |
| Research Papers | Google Scholar alerts | 50+ citations/year |
| Policy References | Parliamentary records | 10+ mentions/year |
| NPS Score | Quarterly surveys | > 50 |

### 9.6 Operational Metrics

| Metric | Target | Owner |
|--------|--------|-------|
| Data Freshness | < 24 hours from official release | Data Engineering |
| Uptime SLA | 99.9% | Infrastructure |
| Support Response Time | < 24 hours | Community |
| Bug Resolution Time | Critical < 24h, Major < 1 week | Engineering |
| Translation Coverage | 100% of user-facing strings | Localization |

---

## 10. Future Expansion

### 10.1 Geographic Expansion

**Phase 1**: Union Budget + 5 pilot states (Maharashtra, Karnataka, Tamil Nadu, Uttar Pradesh, Bihar)  
**Phase 2**: All 28 states + 8 UTs  
**Phase 3**: District-level data for 700+ districts  
**Phase 4**: Block and Gram Panchayat level  
**Phase 5**: South Asia (Pakistan, Bangladesh, Sri Lanka framework)

### 10.2 Domain Expansion

**Current**: Budget allocations and expenditures  
**Near-term**: 
- Revenue collection (tax, non-tax)
- Fiscal deficit and debt tracking
- Central sector schemes monitoring
- CSS (Centrally Sponsored Schemes) detailed tracking

**Long-term**:
- Outcome-based budgeting integration
- SDG (Sustainable Development Goals) alignment tracking
- Climate finance tracking
- Gender budgeting analysis
- Corporate social responsibility (CSR) data correlation

### 10.3 Feature Expansion

**AI Capabilities**:
- Conversational Q&A ("How much did my district get for schools?")
- Predictive modeling ("What will next year's education budget be?")
- Anomaly detection ("This expenditure pattern is unusual")
- Policy simulation ("What if we increase health spending by 10%?")

**User Empowerment**:
- Participatory budgeting simulations
- Community discussion forums (moderated)
- Integration with RTI (Right to Information) filing
- Grievance portal linkage
- Social sharing campaigns

**Developer Ecosystem**:
- Public API with free tier
- Webhook notifications for data updates
- SDK for common languages (Python, JavaScript)
- Hackathons and grant programs
- Marketplace for derivative apps

### 10.4 Platform Expansion

**Mobile**: iOS app (after Android maturity)  
**Web**: Progressive Web App for desktop/tablet  
**Voice**: Alexa/Google Assistant skills  
**Messaging**: WhatsApp/Telegram bots for low-friction access  
**Enterprise**: White-label solutions for media organizations

### 10.5 Monetization (Non-Profit Model)

**Never**: Paywalls for citizens, selling user data, political advertising  
**Potential**: 
- Premium API tiers for commercial users
- Grants from transparency foundations
- Corporate sponsorships (with strict independence clauses)
- Paid training and certification programs
- Consulting for governments on data publication

### 10.6 Technology Evolution

**Year 1-2**: Proven stack (Kotlin, Python, PostgreSQL)  
**Year 3-4**: ML model optimization, edge computing  
**Year 5+**: Blockchain for audit trails, quantum-resistant encryption preparation

---

## 11. Dependencies & Risks

### 11.1 External Dependencies

| Dependency | Risk Level | Mitigation |
|------------|------------|------------|
| Government data portals availability | High | Mirror datasets, multiple source fallback |
| API changes by data providers | Medium | Abstraction layer, monitoring, rapid adaptation |
| Cloud provider outages | Medium | Multi-region deployment, disaster recovery |
| Third-party AI API costs | Medium | Hybrid model (open-source + managed), caching |
| Regulatory changes (DPDP Act) | High | Legal review, privacy-by-design architecture |

### 11.2 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Scale exceeds projections | Medium | High | Design for 10x headroom from start |
| Data quality issues | High | High | Automated validation, human review process |
| Security breach | Low | Critical | Regular audits, bug bounty, minimal data collection |
| Model hallucination in AI | Medium | High | Source citations, confidence scores, user feedback loop |
| Offline sync conflicts | Medium | Medium | Last-write-wins with conflict logs, user notification |

### 11.3 Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Government pushback | Medium | High | Political neutrality, focus on published data only |
| Low user adoption | Medium | High | User research, iterative design, partnerships |
| Funding sustainability | Medium | High | Diversified revenue, lean operations, grant pipeline |
| Talent acquisition | Low | Medium | Remote-first, open-source community, competitive comp |
| Competition enters space | Low | Medium | First-mover advantage, network effects, brand trust |

---

## 12. Open Questions

1. **Data Licensing**: What is the exact licensing status of government budget data? Can we redistribute?
2. **Authentication**: Should we implement optional user accounts for personalization, or stay completely anonymous?
3. **Update Frequency**: How often do government portals actually update? Need empirical study.
4. **Language Priority**: Which 10 languages for Phase 2 beyond Hindi/English? Population vs digital adoption tradeoff.
5. **AI Model**: Build custom fine-tuned models or rely on managed APIs? Cost vs control considerations.
6. **Partnerships**: Should we partner with existing civic tech orgs or build independently?
7. **Feedback Moderation**: How to handle potentially false discrepancy reports without censorship?

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| Union Budget | Annual financial statement of Government of India |
| Demands for Grants | Detailed expenditure proposals by ministries |
| Appropriation Bill | Legislation authorizing withdrawal from Consolidated Fund |
| Finance Bill | Legislation for taxation proposals |
| Revenue Expenditure | Day-to-day government running costs |
| Capital Expenditure | Asset creation spending |
| Fiscal Deficit | Gap between total expenditure and total receipts |
| CSS | Centrally Sponsored Schemes |
| BE | Budget Estimates |
| RE | Revised Estimates |
| Actuals | Actual expenditure incurred |

## Appendix B: Reference Documents

- [Vision.md](./Vision.md) - Strategic vision and north star
- [Mission.md](./Mission.md) - Core mission statement
- [CoreValues.md](./CoreValues.md) - Non-negotiable values
- [GuidingPrinciples.md](./GuidingPrinciples.md) - Daily engineering practices
- [NonGoals.md](./NonGoals.md) - Explicitly out-of-scope items
- [ProductPhilosophy.md](./ProductPhilosophy.md) - Design beliefs

## Appendix C: Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024 | Founding Team | Initial PRD creation |

---

*This PRD is derived from Vision.md, Mission.md, and Core Values.md. All subsequent Architecture, Design, and Implementation documents must reference and align with this PRD.*
