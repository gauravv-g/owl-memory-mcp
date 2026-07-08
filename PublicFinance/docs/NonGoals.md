# Non-Goals

## Explicitly Out of Scope

This document defines what we will NOT build. Revisiting these decisions requires explicit discussion and documentation update.

---

## 1. Political Advocacy

**What We Won't Do**:
- Endorse political parties, candidates, or policy positions
- Frame budget data as "good" or "bad" based on ideological立场
- Partner with organizations that require editorial control
- Accept funding from politically-affiliated sources

**Why**: Trust requires neutrality. Once perceived as partisan, we lose credibility across the spectrum.

**Boundary**: We can report factual statements like "X scheme received 20% less funding than proposed" but not "This cut is harmful."

---

## 2. Real-Time Transaction Monitoring

**What We Won't Do**:
- Track individual government transactions in real-time
- Provide minute-by-minute expenditure updates
- Integrate with treasury systems for live feeds

**Why**: Government financial systems do not expose real-time data. Attempting this would require unrealistic partnerships and create false expectations about data freshness.

**Boundary**: We provide data updated within 24-48 hours of official publication, clearly marked with timestamps.

---

## 3. Grievance Redressal Platform

**What We Won't Do**:
- Accept citizen complaints about corruption or mismanagement
- File RTI applications on behalf of users
- Connect users directly to government helplines
- Track individual complaint resolution

**Why**: This requires legal infrastructure, government partnerships, and operational capacity beyond our scope. We focus on information access, not case management.

**Boundary**: We can link to existing grievance portals (CPGRAMS, state portals) but won't build our own.

---

## 4. Government Portal Replacement

**What We Won't Do**:
- Compete with official government websites
- Claim to be the "official" source of budget data
- Host primary data that should live on government servers
- Prevent users from accessing original sources

**Why**: We are a layer on top of government data, not a replacement. Citizens should always be able to verify against official sources.

**Boundary**: We aggregate, simplify, and link back to originals. Every data point cites its source.

---

## 5. Financial Advice or Investment Recommendations

**What We Won't Do**:
- Suggest which stocks to buy based on budget allocations
- Recommend mutual funds focused on government contracts
- Provide tax planning advice
- Predict market movements from fiscal policy

**Why**: This requires SEBI registration, creates liability, and distracts from our core mission of public finance transparency.

**Boundary**: We present factual budget data. Users make their own investment decisions.

---

## 6. Paywalled Premium Features

**What We Won't Do**:
- Charge citizens for access to basic data
- Create tiered access levels (free vs. premium)
- Sell user data or analytics to third parties
- Accept advertising that compromises editorial independence

**Why**: Public finance data is a public good. Monetization through user fees contradicts our mission of universal access.

**Boundary**: We explore institutional licensing (universities, corporations), grants, and donations—not user fees.

---

## 7. Global Expansion (Before Year 6)

**What We Won't Do**:
- Build features for countries other than India in phases 1-4
- Generalize architecture prematurely for international use
- Dilute India-specific optimizations for generic solutions

**Why**: Doing India well requires deep focus. Premature globalization creates shallow products everywhere.

**Boundary**: Architecture should allow future expansion, but implementation focuses 100% on India until Phase 5.

---

## 8. AI-Generated Content Without Verification

**What We Won't Do**:
- Publish AI-summarized budget analysis without human review
- Allow AI to answer factual questions without source citations
- Trust LLMs for numerical accuracy without validation layers
- Present AI inferences as established facts

**Why**: Hallucinations destroy trust. AI assists human analysis; it doesn't replace verification.

**Boundary**: AI generates drafts and suggestions; humans verify before publication. All AI outputs include confidence scores and sources.

---

## 9. Social Media Features

**What We Won't Do**:
- Build in-app social networks or discussion forums
- Enable user-to-user messaging
- Create shareable memes or viral content tools
- Gamify engagement with leaderboards or badges

**Why**: Social features require moderation infrastructure, create harassment risks, and distract from core utility. Let existing social platforms handle sharing.

**Boundary**: We provide clean share links (WhatsApp, Twitter, etc.) but no native social features.

---

## 10. Hardware or IoT Integration

**What We Won't Do**:
- Build dedicated hardware devices
- Integrate with smart speakers (Alexa, Google Home)
- Develop wearable app versions
- Create offline kiosks or physical installations

**Why**: Software-only focus allows rapid iteration and wide distribution. Hardware diverts resources from core platform quality.

**Boundary**: Optimize mobile web and Android app. Let others build hardware integrations using our APIs.

---

## Decision Criteria for Future Non-Goals

When evaluating new feature proposals, ask:

1. Does this advance our core mission of democratizing access to public finance data?
2. Do we have unique capability or right to build this?
3. Does this distract from higher-priority work?
4. Does this create legal, ethical, or operational risks we're not equipped to manage?

If answers suggest "no," add to this Non-Goals document.

---

*This Non-Goals document protects focus. Features here may be revisited only with explicit rationale, leadership approval, and documentation update.*
