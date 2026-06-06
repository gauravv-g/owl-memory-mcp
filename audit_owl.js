const fs = require('fs');
const code = fs.readFileSync('owl_memory_v5.js', 'utf8');
const web = fs.readFileSync('owl_web_mcp.py', 'utf8');
const research = fs.readFileSync('owl_research_mcp.py', 'utf8');
const daemon = fs.readFileSync('owl_daemon.js', 'utf8');

const all = [
  // v5 — Innovation B
  ['v5', 'B: predictive_cache table', code.includes('predictive_cache')],
  ['v5', 'B: resurrect checks predictive_cache', code.includes('pcRow') && code.includes('pre_retrieved_memories')],
  ['v5', 'B: get_prediction action', code.includes('get_prediction')],
  // v5 — Innovation C full
  ['v5', 'C: agent_handoff action', code.includes('agent_handoff')],
  ['v5', 'C: other_agent_activity in resurrect', code.includes('other_agent_activity')],
  ['v5', 'C: incoming_handoff in resurrect', code.includes('incoming_handoff')],
  // v5 — Innovation D
  ['v5', 'D: cognitive_fingerprint table', code.includes('cognitive_fingerprint')],
  ['v5', 'D: updateCognitiveFingerprint function', code.includes('updateCognitiveFingerprint')],
  ['v5', 'D: get_fingerprint action', code.includes('get_fingerprint')],
  ['v5', 'D: cognitive_context in resurrect', code.includes('cognitive_context')],
  ['v5', 'D: dream calls fingerprint update', code.includes('updateCognitiveFingerprint(projectId)')],
  // v5 — Innovation F
  ['v5', 'F: archaeology action', code.includes('archaeology')],
  ['v5', 'F: succession_export action', code.includes('succession_export')],
  ['v5', 'F: succession_import action', code.includes('succession_import')],
  ['v5', 'F: onboarding brief for new projects', code.includes('onboarding')],
  // v5 — Phase 4 Unification
  ['v5', 'Unify: do action router', code.includes('"do"') || code.includes("=== 'do'")],
  // daemon — Innovation B
  ['daemon', 'B: writePredictiveCache function exists', daemon.includes('writePredictiveCache')],
  ['daemon', 'B: called on file save', daemon.includes('writePredictiveCache(relPath')],
  // web
  ['web', 'web_diff tool', web.includes('web_diff')],
  ['web', 'web_monitor_start tool', web.includes('web_monitor_start')],
  ['web', 'web_session_scrape tool', web.includes('web_session_scrape')],
  ['web', 'web_research_crawl tool', web.includes('web_research_crawl')],
  // research
  ['research', 'research_deep tool', research.includes('research_deep')],
  ['research', 'research_quick tool', research.includes('research_quick')],
  ['research', 'research_follow_up tool', research.includes('research_follow_up')],
  ['research', 'research_on_file tool', research.includes('research_on_file')],
  ['research', 'get_research_history tool', research.includes('get_research_history')],
  ['research', 'DuckDuckGo integration', research.includes('DDGS') || research.includes('duckduckgo_search')],
  ['research', 'Scrapling fetch in research', research.includes('Fetcher')],
  ['research', 'Markdown report output', research.includes('##') || research.includes('report') || research.includes('markdown')],
];

let pass = 0, fail = 0;
all.forEach(([file, name, result]) => {
  console.log((result ? 'OK  ' : 'FAIL') + ' [' + file + '] ' + name);
  result ? pass++ : fail++;
});
console.log('');
console.log('RESULT: ' + pass + '/' + all.length + ' passed, ' + fail + ' FAILED');
if (fail > 0) process.exit(1);
