# Product Philosophy

## Our Beliefs About Building Public Finance Tools

---

## 1. Information Should Be Understandable, Not Just Available

**Belief**: Publishing raw data is not enough. Data becomes useful only when people can comprehend it.

**Practice**:
- Translate budget jargon into plain language
- Provide context: "This amount equals X schools or Y kilometers of road"
- Use visualizations that reveal patterns, not just decorate numbers
- Offer multiple explanation levels for different expertise

**Example**: Instead of showing "₹5,000 crore allocated to MNREGA," show "₹5,000 crore for rural employment—enough to fund 200 million person-days of work, or approximately ₹2,500 per rural household."

---

## 2. Trust Is Built Through Verification, Not Claims

**Belief**: Users should never have to trust us blindly. Every claim must be verifiable.

**Practice**:
- Link every number to its source document with page references
- Show calculation formulas transparently
- Publish data processing code as open source
- Enable users to download raw datasets
- Acknowledge uncertainties and limitations explicitly

**Example**: A budget comparison chart includes a "Sources" tab listing exact PDF URLs, page numbers, and extraction dates for every data point.

---

## 3. Accessibility Is a Feature, Not Compliance

**Belief**: Designing for disabilities and constraints makes the product better for everyone.

**Practice**:
- High contrast modes help users in bright sunlight, not just visually impaired users
- Screen reader optimization improves SEO and machine parsing
- Simple language helps non-native speakers, not just low-literacy users
- Offline capability helps travelers and rural users, not just those without internet

**Example**: Voice navigation designed for illiterate users also enables hands-free use for journalists interviewing sources.

---

## 4. Multilingual Is Not Translation—It's Cultural Adaptation

**Belief**: True multilingual support requires understanding cultural contexts, not just translating words.

**Practice**:
- Hire native speakers who understand public finance terminology in each language
- Adapt examples and analogies to regional contexts
- Support right-to-left scripts properly (for Urdu, Arabic)
- Test comprehension in each language, not just linguistic accuracy
- Allow mixed-language queries (Hinglish, Tanglish, etc.)

**Example**: Explaining "fiscal deficit" in Tamil uses local metaphors about household budgets, not literal translations of English economic terms.

---

## 5. Offline-First Respects User Reality

**Belief**: Assuming constant connectivity is privileged design. Most Indians face intermittent internet.

**Practice**:
- Core features work completely offline
- Background sync when connectivity resumes
- Clear indicators showing data freshness
- Graceful degradation, not error messages
- Minimize data transfer costs for users paying per MB

**Example**: A user downloads their state's budget on WiFi at work, then explores it fully during commute without internet.

---

## 6. AI Augments Human Understanding, Not Replaces It

**Belief**: AI should make complex information accessible while preserving accuracy and nuance.

**Practice**:
- AI generates summaries; humans verify before publication
- All AI outputs include confidence scores and source citations
- Users can toggle between AI summary and original text
- AI explains its reasoning, not just conclusions
- Numerical claims from AI are cross-validated against source data

**Example**: An AI-powered answer to "How much was spent on education?" shows the summary, links to budget documents, displays confidence level, and offers to show the calculation steps.

---

## 7. Progressive Disclosure Serves Both Novices and Experts

**Belief**: Users have varying expertise levels. Good design serves all without condescension or overwhelm.

**Practice**:
- Default view: Simple answer to the user's question
- One tap deeper: Context and comparisons
- Two taps deeper: Detailed breakdowns and methodology
- Expert mode: Raw data, SQL queries, API access

**Example**: A citizen sees "Your district received ₹50 crore for health." A researcher sees breakdowns by scheme, month, and facility. A data scientist accesses the API for custom analysis.

---

## 8. Performance Is a Feature

**Belief**: Slow products exclude users. Speed is equity.

**Practice**:
- Set performance budgets for every feature
- Test on low-end devices, not development machines
- Optimize for 3G networks, not fiber broadband
- Measure real-world performance continuously
- Treat regressions as bugs, not trade-offs

**Example**: The app loads in under 2 seconds on a ₹5,000 Android phone with 3G connection, not just on developer's MacBook with WiFi.

---

## 9. Modularity Enables Long-Term Evolution

**Belief**: Products that last are built from independent, composable parts.

**Practice**:
- Separate data ingestion from analysis from presentation
- Design APIs that allow swapping implementations
- Avoid tight coupling between features
- Document module boundaries clearly
- Plan for deprecation from the start

**Example**: Today's budget explorer module can be replaced tomorrow with a policy simulation engine without rewriting the entire platform.

---

## 10. Openness Amplifies Impact

**Belief**: We cannot solve this problem alone. Enable others to build on our work.

**Practice**:
- Publish comprehensive API documentation
- Release tools and libraries as open source
- Share methodologies and learnings publicly
- Welcome contributions from civil society and academia
- Design for interoperability with government systems

**Example**: A journalism school builds a custom investigation tool using our API, reaching audiences we never could directly.

---

## 11. Neutrality Preserves Credibility

**Belief**: Once perceived as partisan, we lose utility for all users.

**Practice**:
- Present facts without editorializing
- Cite sources across political spectrums
- Decline funding with strings attached
- Separate news reporting from analysis clearly
- Correct errors prominently regardless of political implication

**Example**: When reporting budget cuts, we present the numbers, historical context, and government rationale—not whether the cuts are "good" or "bad."

---

## 12. Sustainability Over Growth-at-All-Costs

**Belief**: Building for 100 million users requires thinking in decades, not quarters.

**Practice**:
- Choose proven technologies over trendy ones
- Invest in technical debt reduction continuously
- Build diverse revenue streams (grants, institutional licensing, donations)
- Plan leadership succession early
- Measure impact, not just engagement metrics

**Example**: We prioritize retaining users who return monthly for genuine utility over maximizing daily active users through gamification.

---

## Applying This Philosophy

Every product decision should reference this philosophy:

- **Design Review**: "Does this design reflect our accessibility beliefs?"
- **Architecture Decision**: "Does this support modularity and long-term evolution?"
- **Feature Prioritization**: "Does this advance our mission of understandable information?"
- **Partnership Evaluation**: "Does this compromise our neutrality?"

When philosophy conflicts with short-term metrics, philosophy wins.

---

*This Product Philosophy translates Vision, Mission, and Core Values into concrete design and engineering principles. Reference this document in product reviews, design critiques, and architecture discussions.*
