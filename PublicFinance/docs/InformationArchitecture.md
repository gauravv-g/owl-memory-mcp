# Information Architecture
## Public Finance Intelligence Platform

**Version**: 1.0  
**Derived From**: [PRD.md](./PRD.md), [Vision.md](./Vision.md)  
**Status**: Approved

---

## 1. Site Map

```mermaid
graph TD
    A[Public Finance Platform] --> B[Mobile App]
    A --> C[Web App]
    A --> D[API Platform]
    
    B --> B1[Splash Screen]
    B --> B2[Onboarding Flow]
    B --> B3[Home Dashboard]
    B --> B4[Search]
    B --> B5[Budget Explorer]
    B --> B6[Alerts Center]
    B --> B7[Settings & Profile]
    
    B3 --> B3a[Your Constituency Card]
    B3 --> B3b[Recent Searches]
    B3 --> B3c[Trending Schemes]
    B3 --> B3d[Quick Actions]
    
    B4 --> B4a[Search Results]
    B4 --> B4b[Search Filters]
    B4 --> B4c[Search History]
    
    B5 --> B5a[Union Budget Overview]
    B5 --> B5b[Ministry Detail]
    B5 --> B5c[Scheme Detail]
    B5 --> B5d[Money Flow Visualization]
    
    B5c --> B5c1[Allocation Breakdown]
    B5c --> B5c2[Beneficiary Info]
    B5c --> B5c3[Source Documents]
    B5c --> B5c4[AI Summary]
    
    B6 --> B6a[Alert List]
    B6 --> B6b[Alert Detail]
    B6 --> B6c[Alert Preferences]
    
    B7 --> B7a[Language Settings]
    B7 --> B7b[Location Settings]
    B7 --> B7c[Notification Settings]
    B7 --> B7d[Data & Storage]
    B7 --> B7e[Accessibility]
    B7 --> B7f[About & Sources]
    B7 --> B7g[Feedback]
    
    C --> C1[Landing Page]
    C --> C2[Advanced Search]
    C --> C3[Data Explorer]
    C --> C4[API Documentation]
    C --> C5[Bulk Download]
    C --> C6[Research Hub]
    
    D --> D1[Authentication]
    D --> D2[Budget Endpoints]
    D --> D3[Search Endpoints]
    D --> D4[User Endpoints]
    D --> D5[Webhooks]
```

---

## 2. Screen Hierarchy

### 2.1 Mobile App Screen Tree

```mermaid
graph LR
    Splash --> Onboarding
    Onboarding --> Home
    
    Home --> Search
    Home --> Explore
    Home --> Alerts
    Home -> Settings
    
    Search --> Results
    Results --> SchemeDetail
    Results --> MinistryDetail
    
    Explore --> BudgetOverview
    BudgetOverview --> MinistryDetail
    MinistryDetail --> SchemeDetail
    SchemeDetail --> MoneyFlow
    
    Alerts --> AlertList
    AlertList --> AlertDetail
    AlertDetail --> SchemeDetail
    
    Settings --> Language
    Settings --> Location
    Settings --> Notifications
    Settings --> Accessibility
    Settings --> About
```

### 2.2 Deep Link Structure

```
publicfinance://home
publicfinance://search?query=budget&year=2024
publicfinance://ministry/{ministry_id}
publicfinance://scheme/{scheme_id}
publicfinance://moneyflow/{scheme_id}
publicfinance://comparison?regions=MH,KA,TN&year=2024
publicfinance://alert/{alert_id}
publicfinance://settings/language
publicfinance://settings/location
publicfinance://about
```

---

## 3. User Flow Diagrams

### 3.1 First-Time User Onboarding Flow

```mermaid
sequenceDiagram
    participant U as User
    participant A as App
    participant S as Server
    
    U->>A: Launch App
    A->>A: Show Splash Screen
    A->>A: Check First Launch
    A->>U: Show Onboarding Slide 1
    U->>A: Swipe Next
    A->>U: Show Onboarding Slide 2
    U->>A: Swipe Next
    A->>U: Show Onboarding Slide 3
    U->>A: Swipe Next
    A->>U: Show Onboarding Slide 4
    U->>A: Tap Get Started
    A->>U: Request Location Permission
    U->>A: Grant/Deny
    A->>U: Request Notification Permission
    U->>A: Grant/Deny
    A->>S: Register Device (anonymous)
    S-->>A: Device ID
    A->>A: Set Complete
    A->>U: Navigate to Home
```

### 3.2 Search Journey Flow

```mermaid
flowchart TD
    Start([User Opens Search]) --> Type[User Types Query]
    Type --> Debounce{Debounce 300ms}
    Debounce -->|Continue Typing| Type
    Debounce -->|Stop| Search[Execute Search]
    Search --> Cache{In Cache?}
    Cache -->|Yes| ReturnCache[Return Cached Results]
    Cache -->|No| API[Call Search API]
    API --> Network{Network OK?}
    Network -->|No| Offline[Show Offline State]
    Network -->|Yes| Results[Display Results]
    ReturnCache --> Results
    Offline --> Suggest[Show Suggestions]
    Results --> Empty{Empty Results?}
    Empty -->|Yes| EmptyState[Show Empty State]
    Empty -->|No| List[Show Result List]
    EmptyState --> Suggest
    List --> Select[User Selects Result]
    Select --> Detail[Navigate to Detail Screen]
    Detail --> End([End])
    Suggest --> End
```

### 3.3 Budget Exploration Flow

```mermaid
flowchart LR
    A[Home] --> B[Tap Explore]
    B --> C[Budget Overview]
    C --> D{Select View}
    D -->|By Ministry| E[Ministry List]
    D -->|By Sector| F[Sector List]
    D -->|By Scheme| G[Scheme List]
    
    E --> H[Select Ministry]
    F --> H
    G --> I[Select Scheme]
    
    H --> J[Ministry Detail]
    J --> K{User Action}
    K -->|View Schemes| L[Scheme List]
    K -->|View AI Summary| M[AI Summary Modal]
    K -->|Compare| N[Comparison Tool]
    
    L --> I
    I --> O[Scheme Detail]
    O --> P{User Action}
    P -->|Track Money| Q[Money Flow Viz]
    P -->|View Docs| R[Source Documents]
    P -->|Share| S[Share Sheet]
    P -->|Save| T[Add to Bookmarks]
    
    Q --> End([End])
    M --> End
    N --> End
    R --> End
    S --> End
    T --> End
```

### 3.4 Offline Usage Flow

```mermaid
sequenceDiagram
    participant U as User
    participant A as App
    participant DB as Local DB
    participant S as Server
    
    U->>A: Open App (No Network)
    A->>A: Detect Offline Status
    A->>U: Show Offline Banner
    A->>DB: Check Cached Data
    DB-->>A: Return Available Data
    A->>U: Display Cached Content
    U->>A: Perform Search
    A->>DB: Query Local Index
    DB-->>A: Return Matches
    A->>U: Show Results (Cached)
    U->>A: View Scheme Detail
    A->>DB: Fetch Cached Detail
    DB-->>A: Return Data
    A->>U: Display Detail
    U->>A: Queue Feedback
    A->>DB: Store in Queue
    DB-->>A: Confirm Queued
    A->>U: Show "Will Sync Later"
    
    Note over A,S: Network Restored
    
    A->>A: Detect Online Status
    A->>U: Hide Offline Banner
    A->>DB: Get Queued Actions
    DB-->>A: Return Queue
    loop For Each Queued Action
        A->>S: Sync Action
        S-->>A: Confirm
        A->>DB: Remove from Queue
    end
    A->>U: Show "Sync Complete"
```

### 3.5 Language Switch Flow

```mermaid
flowchart TD
    A[User in Any Screen] --> B[Open Settings]
    B --> C[Tap Language]
    C --> D[Show Language List]
    D --> E{User Selects}
    E --> F[ Hindi ]
    E --> G[ English ]
    E --> H[ Other Language ]
    
    F --> I[Load Hindi Translations]
    G --> I[Load English Translations]
    H --> I[Load Selected Language]
    
    I --> J{Translations Available?}
    J -->|Yes| K[Apply to Current Screen]
    J -->|Partial| L[Apply Available + Fallback]
    
    K --> M[Update All UI Strings]
    L --> M
    
    M --> N[Save Preference]
    N --> O[Return to Previous Screen]
    O --> P[Screen Now in New Language]
```

---

## 4. Component Architecture

### 4.1 Android App Component Tree

```mermaid
graph TD
    App[Application Class] --> MainActivity
    App --> AppDatabase
    App --> RepositoryContainer
    App --> DependencyInjector
    
    MainActivity --> NavHost
    MainActivity --> BottomNav
    
    NavHost --> HomeScreen
    NavHost --> ExploreScreen
    NavHost --> SearchScreen
    NavHost --> AlertsScreen
    NavHost --> SettingsScreen
    
    HomeScreen --> HomeViewModel
    HomeScreen --> ConstituencyCard
    HomeScreen --> RecentSearchesCard
    HomeScreen --> TrendingCard
    
    ExploreScreen --> ExploreViewModel
    ExploreScreen --> BudgetChart
    ExploreScreen --> MinistryList
    
    SearchScreen --> SearchViewModel
    SearchScreen --> SearchBar
    SearchScreen --> ResultList
    SearchScreen --> FilterSheet
    
    AlertsScreen --> AlertsViewModel
    AlertsScreen --> AlertList
    AlertsScreen --> AlertDetail
    
    SettingsScreen --> SettingsViewModel
    SettingsScreen --> LanguagePicker
    SettingsScreen --> LocationPicker
    SettingsScreen --> ToggleSettings
    
    RepositoryContainer --> BudgetRepository
    RepositoryContainer --> SearchRepository
    RepositoryContainer --> UserRepository
    RepositoryContainer --> SyncRepository
    
    BudgetRepository --> RemoteDataSource
    BudgetRepository --> LocalDataSource
    
    RemoteDataSource --> ApiService
    LocalDataSource --> DAO
```

### 4.2 Backend Service Architecture

```mermaid
graph TD
    Client[Mobile/Web Client] --> CDN[Cloudflare CDN]
    CDN --> LB[Load Balancer]
    LB --> API[API Gateway]
    
    API --> Auth[Auth Service]
    API --> Budget[Budget Service]
    API --> Search[Search Service]
    API --> User[User Service]
    API --> AI[AI Service]
    API --> Notify[Notification Service]
    
    Auth --> AuthDB[(Auth DB)]
    Budget --> BudgetDB[(Budget DB)]
    Search --> SearchIndex[(Elasticsearch)]
    User --> UserDB[(User DB)]
    AI --> ModelServer[ML Model Server]
    Notify --> Queue[Message Queue]
    
    Queue --> EmailWorker[Email Worker]
    Queue --> PushWorker[Push Worker]
    Queue --> SyncWorker[Sync Worker]
    
    BudgetDB --> ReadReplica1[(Read Replica)]
    BudgetDB --> ReadReplica2[(Read Replica)]
    
    Budget --> Cache[Redis Cache]
    Search --> Cache
    
    AllServices --> Logs[Centralized Logging]
    AllServices --> Metrics[Prometheus Metrics]
    AllServices --> Tracing[Distributed Tracing]
```

---

## 5. Data Flow Diagrams

### 5.1 Budget Data Ingestion Pipeline

```mermaid
flowchart LR
    A[Government Portals] --> B[Scraper Service]
    A --> C[Manual Upload]
    
    B --> D[Raw Data Store]
    C --> D
    
    D --> E[Validation Service]
    E --> F{Valid?}
    F -->|No| G[Error Queue]
    F -->|Yes| H[Transformation Service]
    
    G --> I[Alert Team]
    
    H --> J[Standardized Format]
    J --> K[Enrichment Service]
    K --> L[Add Metadata]
    L --> M[Add AI Tags]
    
    M --> N[Quality Check]
    N --> O{Pass QC?}
    O -->|No| G
    O -->|Yes| P[Main Database]
    
    P --> Q[Search Index Update]
    P --> R[Cache Invalidation]
    P --> S[Webhook Triggers]
    
    Q --> T[Search Available]
    R --> U[Fresh Data Served]
    S --> V[Notify Subscribers]
```

### 5.2 Search Query Flow

```mermaid
sequenceDiagram
    participant U as User
    participant A as Android App
    participant G as API Gateway
    participant S as Search Service
    participant E as Elasticsearch
    participant C as Redis Cache
    participant AI as AI Service
    
    U->>A: Enter Search Query
    A->>A: Debounce Input
    A->>C: Check Query Cache
    C-->>A: Cache Miss
    A->>G: POST /api/v1/search
    G->>S: Route to Search Service
    S->>E: Query Index
    E-->>S: Return Results
    S->>AI: Get Query Enhancements
    AI-->>S: Return Suggestions
    S->>S: Rank & Format Results
    S->>C: Cache Results (5 min)
    S-->>G: Return Response
    G-->>A: JSON Response
    A->>A: Parse & Display
    A->>U: Show Results
```

### 5.3 Offline Sync Flow

```mermaid
flowchart TD
    Start{Network Available?}
    Start -->|Yes| CheckSync[Check Last Sync Time]
    Start -->|No| QueueOnly[Queue Actions Only]
    
    CheckSync --> Old{Last Sync > 1hr?}
    Old -->|Yes| FullSync[Full Data Sync]
    Old -->|No| IncrSync[Incremental Sync]
    
    FullSync --> Download[Download Updated Datasets]
    IncrSync --> Download
    
    Download --> Validate[Validate Data Integrity]
    Validate --> Store[Store in Local DB]
    Store --> UploadQueued[Upload Queued Actions]
    
    UploadQueued --> Process{Process Each}
    Process --> Success{Success?}
    Success -->|Yes| Remove[Remove from Queue]
    Success -->|No| Retry[Mark for Retry]
    
    Remove --> More{More Items?}
    Retry --> More
    
    More -->|Yes| Process
    More -->|No| UpdateMeta[Update Sync Metadata]
    UpdateMeta --> Notify[Notify User]
    Notify --> End([Complete])
    
    QueueOnly --> StoreLocal[Store in Local Queue]
    StoreLocal --> Confirm[Confirm to User]
    Confirm --> EndOffline([Will Sync Later])
```

---

## 6. State Management

### 6.1 App State Machine

```mermaid
stateDiagram-v2
    [*] --> Initializing
    Initializing --> LoadingData: App Start
    LoadingData --> Ready: Data Loaded
    LoadingData --> Error: Load Failed
    Ready --> Offline: Network Lost
    Ready --> Online: Network Active
    Offline --> Online: Network Restored
    Offline --> Ready: Cached Data Available
    Error --> Retry: User Retries
    Retry --> LoadingData
    Error --> Ready: Use Cached Data
    Online --> Ready: Normal Operation
    Ready --> Background: App Backgrounded
    Background --> Ready: App Foregrounded
    Background --> [*]: App Terminated
```

### 6.2 Sync State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Pending: Data Change Detected
    Idle --> Scheduled: Sync Timer Fires
    Pending --> Syncing: Network Available
    Scheduled --> Syncing: Network Available
    Pending --> Queued: Network Unavailable
    Scheduled --> Queued: Network Unavailable
    Queued --> Pending: Network Restored
    Syncing --> Validating: Upload/Download Complete
    Validating --> Success: Validation Passed
    Validating --> Conflict: Data Conflict Detected
    Conflict --> Resolved: Auto-Resolve or User Input
    Resolved --> Success
    Success --> Idle
    Syncing --> Failed: Error Occurred
    Failed --> Pending: Retry After Delay
    Failed --> Queued: Max Retries Exceeded
```

---

## 7. Navigation Graph

### 7.1 Android Navigation Graph (Jetpack Compose)

```mermaid
graph LR
    NavGraph --> SplashRoute
    NavGraph --> OnboardingRoute
    NavGraph --> HomeRoute
    NavGraph --> SearchRoute
    NavGraph --> ExploreRoute
    NavGraph --> AlertsRoute
    NavGraph --> SettingsRoute
    
    HomeRoute --> SchemeDetailRoute
    HomeRoute --> MinistryDetailRoute
    
    SearchRoute --> SearchResultsRoute
    SearchResultsRoute --> SchemeDetailRoute
    
    ExploreRoute --> BudgetOverviewRoute
    BudgetOverviewRoute --> MinistryDetailRoute
    MinistryDetailRoute --> SchemeDetailRoute
    SchemeDetailRoute --> MoneyFlowRoute
    
    AlertsRoute --> AlertDetailRoute
    AlertDetailRoute --> SchemeDetailRoute
    
    SettingsRoute --> LanguageRoute
    SettingsRoute --> LocationRoute
    SettingsRoute --> NotificationsRoute
    SettingsRoute --> AccessibilityRoute
    SettingsRoute --> AboutRoute
    
    SchemeDetailRoute --> ShareRoute
    SchemeDetailRoute --> BookmarkRoute
    MinistryDetailRoute --> CompareRoute
```

### 7.2 Deep Link Routing Table

| Pattern | Destination | Required Params | Optional Params |
|---------|-------------|-----------------|-----------------|
| `/` | Home | - | - |
| `/search` | Search | - | query, year |
| `/scheme/{id}` | SchemeDetail | scheme_id | tab |
| `/ministry/{id}` | MinistryDetail | ministry_id | year |
| `/budget/{year}` | BudgetOverview | year | view_type |
| `/moneyflow/{id}` | MoneyFlow | scheme_id | - |
| `/comparison` | Comparison | regions | year, metric |
| `/alert/{id}` | AlertDetail | alert_id | - |
| `/settings/language` | LanguageSettings | - | - |
| `/settings/location` | LocationSettings | - | - |

---

## 8. Information Taxonomy

### 8.1 Content Classification

```
Budget Data
├── By Government Level
│   ├── Union
│   ├── State (28)
│   └── UT (8)
├── By Document Type
│   ├── Budget Estimates (BE)
│   ├── Revised Estimates (RE)
│   └── Actuals
├── By Expenditure Type
│   ├── Revenue Expenditure
│   └── Capital Expenditure
├── By Sector
│   ├── Education
│   ├── Health
│   ├── Infrastructure
│   ├── Agriculture
│   ├── Defense
│   └── ... (all sectors)
└── By Geography
    ├── National
    ├── State
    ├── District
    └── Block/Panchayat

Schemes
├── Central Sector Schemes
├── Centrally Sponsored Schemes
└── State Schemes

Metadata
├── Fiscal Year
├── Ministry/Department
├── Scheme Name
├── Unique ID
├── Source Document
├── Last Updated
└── Verification Status
```

### 8.2 Tagging System

```mermaid
graph TD
    A[Budget Item] --> B[Auto-Generated Tags]
    A --> C[AI-Generated Tags]
    A --> D[Manual Tags]
    
    B --> B1[Year: 2024-25]
    B --> B2[Ministry: Education]
    B --> B3[Sector: Social Services]
    B --> B4[Type: Revenue]
    
    C --> C1[Theme: Digital Learning]
    C --> C2[Beneficiary: Students]
    C --> C3[Region: Pan-India]
    C --> C4[Priority: High]
    
    D --> D1[Verified: Yes]
    D --> D2[Featured: No]
    D --> D3[Controversial: No]
```

---

## 9. Accessibility Flow

### 9.1 Screen Reader Navigation

```mermaid
flowchart LR
    A[Screen Opens] --> B[Announce Screen Title]
    B --> C[Focus First Element]
    C --> D{Element Type?}
    D -->|Button| E[Announce Label + Hint]
    D -->|Text| F[Announce Content]
    D -->|Image| G[Announce Alt Text]
    D -->|Chart| H[Announce Summary + Explore Option]
    D -->|List| I[Announce Count + First Item]
    
    E --> J[Wait for Gesture]
    F --> J
    G --> J
    H --> J
    I --> J
    
    J --> K{Gesture?}
    K -->|Swipe Right| L[Next Element]
    K -->|Swipe Left| M[Previous Element]
    K -->|Double Tap| N[Activate Element]
    K -->|Two-Finger Swipe| O[Scroll Page]
    
    L --> C
    M --> P[Prev Element]
    P --> C
    N --> Q[Perform Action]
    Q --> R[Announce Result]
    R --> J
    O --> S[Update View]
    S --> J
```

### 9.2 Reduced Motion Mode

```
Animation Policy:
├── Standard Mode
│   ├── Screen Transitions: 300ms fade + slide
│   ├── Button Press: 100ms scale
│   ├── Loading: Spinning indicator
│   └── Charts: Animated draw
└── Reduced Motion Mode
    ├── Screen Transitions: Instant cut
    ├── Button Press: Color change only
    ├── Loading: Static progress bar
    └── Charts: Instant render
```

---

## 10. Error Handling Flows

### 10.1 Error State Decision Tree

```mermaid
flowchart TD
    Error[Error Detected] --> Classify{Error Type?}
    
    Classify -->|Network| NetworkErr[Network Error]
    Classify -->|Server| ServerErr[Server Error]
    Classify -->|Client| ClientErr[Client Error]
    Classify -->|Data| DataErr[Data Error]
    
    NetworkErr --> RetryAvail{Retry Possible?}
    RetryAvail -->|Yes| ShowRetry[Show Retry Button]
    RetryAvail -->|No| ShowOffline[Show Offline Mode]
    
    ServerErr --> Severity{Severity?}
    Severity -->|Critical| CriticalMsg[Critical Error Message]
    Severity -->|Temporary| TempMsg[Try Again Later]
    
    ClientErr --> Fixable{User-Fixable?}
    Fixable -->|Yes| GuideUser[Guide to Fix]
    Fixable -->|No| LogAndReport[Log + Report Option]
    
    DataErr --> Action{Action Needed?}
    Action -->|Clear Cache| ClearCacheBtn[Offer Clear Cache]
    Action -->|Contact Support| SupportLink[Show Support Contact]
    
    ShowRetry --> UserRetry[User Taps Retry]
    UserRetry --> RetryAttempt[Retry Request]
    RetryAttempt --> Success{Success?}
    Success -->|Yes| Recover[Recover Normal Flow]
    Success -->|No| Escalate[Escalate Error]
    
    Escalate --> FinalFail[Show Final Error State]
    FinalFail --> ReportOption[Offer Report Bug]
```

---

## 11. Performance Optimization Points

### 11.1 Lazy Loading Strategy

```
Loading Priority Levels:
├── P0 (Immediate)
│   ├── Above-fold content
│   ├── Navigation elements
│   └── Critical text
├── P1 (After Interaction Ready)
│   ├── Images below fold
│   ├── Secondary cards
│   └── Charts
├── P2 (Idle Time)
│   ├── Historical data
│   ├── Related content
│   └── Analytics
└── P3 (On Demand)
    ├── Source documents
    ├── Detailed comparisons
    └── Export functions
```

### 11.2 Caching Strategy Matrix

| Data Type | Cache Location | TTL | Invalidation Trigger |
|-----------|---------------|-----|---------------------|
| Budget Overview | Local DB + Redis | 24 hours | New budget release |
| Scheme Detail | Local DB + Redis | 7 days | Data update webhook |
| Search Results | Local DB + Redis | 5 minutes | User types new query |
| AI Summaries | Local DB + Redis | 30 days | Source data changes |
| User Preferences | Local DB only | Persistent | User updates |
| App Configuration | Local DB + CDN | 1 hour | Config change flag |
| Static Assets | Device Cache + CDN | 1 year | Version change |

---

## Appendix A: URL Routing Specification

### Web Routes

```
/                           # Landing page
/search                     # Search interface
/search?q={query}           # Pre-populated search
/budget/{year}              # Budget overview
/ministry/{slug}            # Ministry page
/scheme/{id}                # Scheme detail
/compare                    # Comparison tool
/data                       # Data explorer
/api                        # API documentation
/about                      # About page
/sources                    # Data sources
/privacy                    # Privacy policy
/terms                      # Terms of service
```

### API Routes

```
GET  /api/v1/health         # Health check
GET  /api/v1/budgets        # List budgets
GET  /api/v1/budgets/{year} # Get budget by year
GET  /api/v1/ministries     # List ministries
GET  /api/v1/ministries/{id}# Get ministry detail
GET  /api/v1/schemes        # List schemes
GET  /api/v1/schemes/{id}   # Get scheme detail
GET  /api/v1/search         # Search endpoint
POST /api/v1/feedback       # Submit feedback
GET  /api/v1/alerts         # User alerts (auth required)
POST /api/v1/alerts         # Create alert (auth required)
```

---

## Appendix B: Component Inventory

### Reusable UI Components

1. **Atoms**: Button, Input, Icon, Text, Badge, Avatar, Divider, Spacer
2. **Molecules**: SearchBar, FilterChip, ResultCard, StatCard, ChartCard, AlertItem
3. **Organisms**: Header, BottomNav, ResultList, BudgetChart, SchemeDetail, AlertList
4. **Templates**: HomePage, SearchPage, DetailPage, SettingsPage
5. **Pages**: All screens listed in Section 5

---

*This Information Architecture document is derived from PRD.md and serves as the blueprint for all Design, Android Architecture, and Backend Architecture documents. Every screen, flow, and component must align with this architecture.*
