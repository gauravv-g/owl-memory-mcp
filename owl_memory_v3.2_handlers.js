
// ─── Tool Handlers ───────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const now = new Date().toISOString();

  try {
    // ═══ REMEMBER ═══
    if (name === "remember") {
      const content = args.content, projectId = args.project || "default", eventType = args.event_type || "observation";
      const confidence = args.confidence || 0.8, sensoryType = args.sensory_type || "text";
      const emotion = detectEmotionalSalience(content), moodTag = detectMood(content);
      const initialStrength = 0.5 + emotion.salience * 0.5, nextReview = calculateNextReview(initialStrength, 0, emotion.salience, "raw");
      const memId = generateId(content, projectId);
      const entities = await extractEntitiesNER(content);

      db.prepare(`INSERT INTO episodic_memories (id, content, event_type, project, source, confidence, emotional_valence, emotional_arousal, salience, strength, somatic_weight, somatic_valence, developmental_stage, created_at, updated_at, next_review, review_interval, sensory_type, mood_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?, ?, ?)`)
        .run(memId, content, eventType, projectId, args.source || "conversation", confidence, emotion.valence, emotion.arousal, emotion.salience, initialStrength, emotion.salience > 0.3 ? emotion.salience * 0.5 : 0, emotion.valence * emotion.arousal, now, now, nextReview, 1.0, sensoryType, moodTag);

      for (const [eName, eType, eScore] of entities) {
        db.prepare("INSERT OR IGNORE INTO entities (name, entity_type, first_seen, last_seen) VALUES (?, ?, ?, ?)").run(eName, eType, now, now);
        const er = db.prepare("SELECT id FROM entities WHERE name = ? AND entity_type = ?").get(eName, eType);
        if (er) { db.prepare("INSERT OR IGNORE INTO memory_entities (memory_id, memory_type, entity_id) VALUES (?, 'episodic', ?)").run(memId, er.id); db.prepare("UPDATE entities SET mention_count = mention_count + 1, last_seen = ? WHERE id = ?").run(now, er.id); }
      }

      const existing = db.prepare("SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1 AND id != ?").all(projectId, memId);
      let contradictionsFound = 0;
      for (const ex of existing) {
        const sim = calculateSimilarity(content, ex.content);
        if (sim > 0.3) {
          const neg = ["not","don't","doesn't","won't","can't","never","no longer","changed","updated","actually","instead"];
          if (neg.some(w => content.toLowerCase().includes(w)) !== neg.some(w => ex.content.toLowerCase().includes(w))) {
            db.prepare("INSERT INTO contradictions (memory_id_1, memory_type_1, memory_id_2, memory_type_2, severity, detected_at) VALUES (?, 'episodic', ?, 'episodic', 'warning', ?)").run(ex.id, memId, now);
            contradictionsFound++;
          }
        }
      }

      if (emotion.salience > 0.3) {
        for (const [eName, eType] of entities) {
          if (eType === "proper_noun" || eType === "quoted") {
            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)").run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);
          }
        }
      }

      // Store vector embedding (async, non-blocking)
      generateEmbedding(content).then(emb => storeEmbedding(db, memId, emb)).catch(() => {});

      const entitySummary = {};
      for (const [n, t, s] of entities) { entitySummary[t] = (entitySummary[t] || 0) + 1; }

      return { content: [{ type: "text", text: JSON.stringify({ memory_id: memId, event_type: eventType, emotional_valence: emotion.valence, salience: emotion.salience, strength: initialStrength, developmental_stage: "raw", next_review: nextReview, entities_extracted: entities.length, entity_summary: entitySummary, ner_model: hasNER, contradictions_detected: contradictionsFound, mood_tag: moodTag, vector_embedding: hasVectors }, null, 2) }] };
    }

    // ═══ RECALL (HYBRID: Vector + BM25) ═══
    if (name === "recall") {
      const query = args.query, projectId = args.project || "default", limit = args.limit || 10;
      const memoryType = args.memory_type || "all", moodContext = args.mood_context || detectMood(query);
      const results = [], queryEntities = await extractEntitiesNER(query), queryEmotion = detectEmotionalSalience(query);

      if (memoryType === "all" || memoryType === "episodic") {
        // Phase 1: Vector search
        let vectorScores = new Map();
        if (hasVectors) {
          const queryEmb = await generateEmbedding(query);
          if (queryEmb && queryEmb.length === 384) {
            try {
              const vecRows = db.prepare("SELECT rowid, distance FROM episodic_embeddings WHERE embedding MATCH ? AND k = 50 ORDER BY distance").all(JSON.stringify(queryEmb));
              for (const vr of vecRows) vectorScores.set(vr.rowid, 1 - Math.min(vr.distance, 1));
            } catch (e) { /* ignore */ }
          }
        }

        // Phase 2: BM25 + metadata
        const candidates = new Set();
        for (const mem of db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          candidates.add(mem.id);
          let bm25 = calculateSimilarity(query, mem.content) * 0.3 + mem.strength * 0.15 + mem.salience * 0.1 + Math.min(mem.access_count / 10, 1) * 0.1 + mem.confidence * 0.1;
          if (Math.abs(queryEmotion.valence - mem.emotional_valence) < 0.3) bm25 += 0.1;
          const memEnts = db.prepare("SELECT e.name FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = 'episodic'").all(mem.id);
          bm25 += Math.min(0.15, queryEntities.filter(qe => memEnts.some(me => me.name.toLowerCase() === qe[0].toLowerCase())).length * 0.05);
          if (mem.is_in_working_memory) bm25 += 0.1;
          if (moodContext && mem.mood_tag === moodContext) bm25 += 0.1;
          if (mem.developmental_stage === "abstracted") bm25 += 0.05;

          const vecScore = vectorScores.get(mem.id) || 0;
          const finalScore = bm25 * 0.4 + vecScore * 0.6;

          if (finalScore > 0.05 || vecScore > 0.3) {
            results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, relevance_score: Math.round(finalScore * 1000) / 1000, vector_score: Math.round(vecScore * 1000) / 1000, bm25_score: Math.round(bm25 * 1000) / 1000 });
          }

          const hs = mem.last_accessed ? (Date.now() - new Date(mem.last_accessed).getTime()) / 3600000 : 24;
          db.prepare("UPDATE episodic_memories SET access_count = access_count + 1, last_accessed = ?, strength = ? WHERE id = ?").run(now, Math.max(0.1, calculateRetention(mem.strength, hs)), mem.id);
        }

        // Phase 3: Vector-only hits
        for (const [memId, vecScore] of vectorScores) {
          if (!candidates.has(memId) && vecScore > 0.3) {
            const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ? AND project = ? AND is_active = 1").get(memId, projectId);
            if (mem) results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, relevance_score: Math.round(vecScore * 0.6 * 1000) / 1000, vector_score: Math.round(vecScore * 1000) / 1000, bm25_score: 0 });
          }
        }
      }

      if (memoryType === "all" || memoryType === "semantic") {
        for (const mem of db.prepare("SELECT * FROM semantic_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          const score = calculateSimilarity(query, mem.content) * 0.4 + mem.importance * 0.3 + mem.confidence * 0.3;
          if (score > 0.1) results.push({ id: mem.id, type: "semantic", content: mem.content, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }

      if (memoryType === "all" || memoryType === "procedural") {
        for (const mem of db.prepare("SELECT * FROM procedural_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          const score = calculateSimilarity(query, mem.content) * 0.3 + mem.mastery_level * 0.3 + (mem.success_count / Math.max(mem.practice_count, 1)) * 0.2;
          if (score > 0.1) results.push({ id: mem.id, type: "procedural", title: mem.title, mastery_level: mem.mastery_level, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }

      if (memoryType === "all" || memoryType === "somatic") {
        for (const mem of db.prepare("SELECT * FROM somatic_memories WHERE is_active = 1").all()) {
          const score = calculateSimilarity(query, mem.entity_name) * 0.3 + mem.somatic_weight * 0.4;
          if (score > 0.1) results.push({ id: mem.id, type: "somatic", entity_name: mem.entity_name, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }

      results.sort((a, b) => b.relevance_score - a.relevance_score);
      return { content: [{ type: "text", text: JSON.stringify(results.slice(0, limit), null, 2) }] };
    }

    // ═══ FOCUS / UNFOCUS / GET_WORKING_MEMORY ═══
    if (name === "focus") {
      db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
      let ids = args.memory_ids || [];
      if (args.query && ids.length === 0) ids = db.prepare("SELECT id FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY strength DESC LIMIT 4").all(args.project || "default").map(m => m.id);
      const lim = ids.slice(0, 4);
      for (let i = 0; i < lim.length; i++) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, lim[i]);
      const loaded = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      return { content: [{ type: "text", text: JSON.stringify({ working_memory: loaded, capacity: 4, used: loaded.length }, null, 2) }] };
    }
    if (name === "unfocus") {
      if (args.clear_all) { db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run(); return { content: [{ type: "text", text: "Working memory cleared." }] }; }
      if (args.memory_ids?.length > 0) { for (const id of args.memory_ids) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL WHERE id = ?").run(id); return { content: [{ type: "text", text: `Removed ${args.memory_ids.length}.` }] }; }
      return { content: [{ type: "text", text: "Nothing to unfocus." }] };
    }
    if (name === "get_working_memory") {
      const mems = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      return { content: [{ type: "text", text: JSON.stringify({ working_memory: mems, capacity: 4, used: mems.length }, null, 2) }] };
    }

    // ═══ SESSION CHECKPOINTS ═══
    if (name === "save_checkpoint") {
      const cpId = generateId(args.name, "checkpoint");
      const wm = db.prepare("SELECT id FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      db.prepare("INSERT INTO session_checkpoints (id, name, project, working_memory_ids, created_at) VALUES (?, ?, ?, ?, ?)").run(cpId, args.name, args.project || "default", JSON.stringify(wm.map(m => m.id)), now);
      return { content: [{ type: "text", text: JSON.stringify({ checkpoint_id: cpId, memories_saved: wm.length }, null, 2) }] };
    }
    if (name === "restore_checkpoint") {
      const cp = db.prepare("SELECT * FROM session_checkpoints WHERE id = ?").get(args.checkpoint_id);
      if (!cp) return { content: [{ type: "text", text: "Checkpoint not found." }], isError: true };
      db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
      for (let i = 0; i < (JSON.parse(cp.working_memory_ids || "[]")).length; i++) {
        const id = JSON.parse(cp.working_memory_ids)[i];
        if (id) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, id);
      }
      return { content: [{ type: "text", text: JSON.stringify({ restored: true }, null, 2) }] };
    }
    if (name === "list_checkpoints") {
      return { content: [{ type: "text", text: JSON.stringify(db.prepare("SELECT id, name, created_at FROM session_checkpoints WHERE project = ? AND is_active = 1 ORDER BY created_at DESC").all(args.project || "default"), null, 2) }] };
    }

    // ═══ MEMORY PALACE ═══
    if (name === "create_room") {
      const rid = generateId(args.name, "room");
      db.prepare("INSERT INTO palace_rooms (id, name, description, parent_room_id, sensory_anchors, mood, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(rid, args.name, args.description || null, args.parent_room_id || null, JSON.stringify(args.sensory_anchors || []), args.mood || "neutral", now);
      return { content: [{ type: "text", text: JSON.stringify({ room_id: rid }, null, 2) }] };
    }
    if (name === "place_memory") {
      db.prepare("INSERT OR REPLACE INTO memory_placements (memory_id, memory_type, room_id, placed_at) VALUES (?, ?, ?, ?)").run(args.memory_id, args.memory_type || "episodic", args.room_id, now);
      return { content: [{ type: "text", text: JSON.stringify({ placed: true }, null, 2) }] };
    }
    if (name === "navigate_palace") {
      if (args.list_rooms !== false) return { content: [{ type: "text", text: JSON.stringify({ rooms: db.prepare("SELECT id, name, mood FROM palace_rooms ORDER BY name").all() }, null, 2) }] };
      if (args.room_id) return { content: [{ type: "text", text: JSON.stringify({ room: db.prepare("SELECT * FROM palace_rooms WHERE id = ?").get(args.room_id), memories: db.prepare("SELECT mp.*, em.content FROM memory_placements mp LEFT JOIN episodic_memories em ON em.id = mp.memory_id WHERE mp.room_id = ?").all(args.room_id) }, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ error: "Provide room_id" }) }] };
    }

    // ═══ DREAM ═══
    if (name === "dream") {
      const r = consolidateMemories(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify({ status: "completed", ...r, vector_reindexed: hasVectors }, null, 2) }] };
    }
    if (name === "get_consolidation_history") {
      return { content: [{ type: "text", text: JSON.stringify(db.prepare("SELECT * FROM consolidation_log ORDER BY started_at DESC LIMIT ?").all(args.limit || 10), null, 2) }] };
    }

    // ═══ NARRATIVE ═══
    if (name === "create_narrative") {
      const cid = generateId(args.title, "narrative");
      db.prepare("INSERT INTO narrative_chains (id, title, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(cid, args.title, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ chain_id: cid }, null, 2) }] };
    }
    if (name === "add_to_narrative") {
      const mo = db.prepare("SELECT MAX(sequence_order) as max FROM narrative_events WHERE chain_id = ?").get(args.chain_id);
      db.prepare("INSERT INTO narrative_events (chain_id, memory_id, memory_type, sequence_order, causal_role) VALUES (?, ?, ?, ?, ?)").run(args.chain_id, args.memory_id, args.memory_type || "episodic", (mo?.max || 0) + 1, args.causal_role || "event");
      return { content: [{ type: "text", text: JSON.stringify({ added: true }, null, 2) }] };
    }
    if (name === "get_narrative") {
      const chain = db.prepare("SELECT * FROM narrative_chains WHERE id = ?").get(args.chain_id);
      if (!chain) return { content: [{ type: "text", text: "Not found." }] };
      return { content: [{ type: "text", text: JSON.stringify({ chain, events: db.prepare("SELECT ne.*, em.content FROM narrative_events ne LEFT JOIN episodic_memories em ON em.id = ne.memory_id WHERE ne.chain_id = ? ORDER BY ne.sequence_order").all(args.chain_id) }, null, 2) }] };
    }
    if (name === "list_narratives") {
      return { content: [{ type: "text", text: JSON.stringify(db.prepare("SELECT * FROM narrative_chains WHERE project = ? AND is_active = 1 ORDER BY updated_at DESC").all(args.project || "default"), null, 2) }] };
    }
    if (name === "imagine") {
      db.prepare("INSERT INTO counterfactuals (narrative_id, counterfactual_scenario, created_at) VALUES (?, ?, ?)").run(args.narrative_id, args.counterfactual, now);
      return { content: [{ type: "text", text: JSON.stringify({ imagined: true }, null, 2) }] };
    }

    // ═══ PROCEDURAL ═══
    if (name === "learn_skill") {
      const sid = generateId(args.title, "skill");
      db.prepare("INSERT INTO procedural_memories (id, title, content, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(sid, args.title, args.content, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ skill_id: sid, mastery_level: 0.1 }, null, 2) }] };
    }
    if (name === "practice_skill") {
      const s = db.prepare("SELECT * FROM procedural_memories WHERE id = ?").get(args.skill_id);
      if (!s) return { content: [{ type: "text", text: "Skill not found." }], isError: true };
      const np = s.practice_count + 1, ns = s.success_count + (args.success ? 1 : 0), nm = Math.max(0, Math.min(1, s.mastery_level + (args.success ? 0.05 : -0.02)));
      db.prepare("UPDATE procedural_memories SET practice_count = ?, success_count = ?, mastery_level = ?, last_practiced = ?, updated_at = ? WHERE id = ?").run(np, ns, nm, now, now, args.skill_id);
      return { content: [{ type: "text", text: JSON.stringify({ mastery_level: Math.round(nm * 100) / 100 }, null, 2) }] };
    }

    // ═══ SOMATIC ═══
    if (name === "get_somatic") {
      const s = db.prepare("SELECT * FROM somatic_memories WHERE entity_name = ? AND is_active = 1").get(args.entity_name);
      return { content: [{ type: "text", text: JSON.stringify(s ? { found: true, ...s } : { found: false }, null, 2) }] };
    }
    if (name === "list_somatic") {
      return { content: [{ type: "text", text: JSON.stringify({ somatic_map: db.prepare("SELECT entity_name, somatic_valence, somatic_weight FROM somatic_memories WHERE is_active = 1 AND somatic_weight >= ? ORDER BY somatic_weight DESC").all(args.min_weight || 0) }, null, 2) }] };
    }

    // ═══ TRANSATIVE ═══
    if (name === "know_who_knows") {
      db.prepare("INSERT OR REPLACE INTO transactive_memory (agent_name, domain, expertise_level, trust_level, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(args.agent_name, args.domain, args.expertise_level || 0.5, args.trust_level || 0.8, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ recorded: true }, null, 2) }] };
    }
    if (name === "find_expert") {
      const ex = db.prepare("SELECT agent_name, domain, expertise_level, trust_level FROM transactive_memory WHERE domain LIKE ? AND expertise_level >= ? AND project = ? ORDER BY expertise_level DESC").all(`%${args.domain}%`, args.min_expertise || 0.3, args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify({ experts: ex, count: ex.length }, null, 2) }] };
    }

    // ═══ THREATS ═══
    if (name === "get_threats") {
      return { content: [{ type: "text", text: JSON.stringify({ threats: db.prepare("SELECT pattern_name, description, severity FROM threat_patterns WHERE is_active = 1").all() }, null, 2) }] };
    }
    if (name === "warn_me") {
      const threats = db.prepare("SELECT * FROM threat_patterns WHERE is_active = 1").all();
      const rel = threats.filter(t => calculateSimilarity(args.context, t.description) > 0.3);
      return { content: [{ type: "text", text: JSON.stringify({ threats_found: rel.length, threats: rel }, null, 2) }] };
    }

    // ═══ PREDICTIVE ═══
    if (name === "predict_needs") {
      const mood = detectMood(args.context);
      const mems = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE project = ? AND is_active = 1 AND mood_tag = ? ORDER BY strength DESC LIMIT 5").all(args.project || "default", mood);
      return { content: [{ type: "text", text: JSON.stringify({ detected_mood: mood, likely_needed_memories: mems }, null, 2) }] };
    }

    // ═══ MUTATIONS ═══
    if (name === "get_mutation_history") {
      return { content: [{ type: "text", text: JSON.stringify({ mutations: db.prepare("SELECT * FROM memory_mutations WHERE memory_id = ? ORDER BY created_at ASC").all(args.memory_id) }, null, 2) }] };
    }

    // ═══ METACOGNITION ═══
    if (name === "reflect") {
      db.prepare("INSERT OR REPLACE INTO metacognition (memory_id, memory_type, confidence, knowledge_gap, reflection, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(args.memory_id, args.memory_type || "episodic", args.confidence || 0.8, args.knowledge_gap || null, args.reflection || null, now, now);
      return { content: [{ type: "text", text: JSON.stringify({ reflected: true }, null, 2) }] };
    }
    if (name === "health_check") {
      const pid = args.project || "default";
      const te = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1").get(pid).c;
      const ts = db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(pid).c;
      const tp = db.prepare("SELECT COUNT(*) as c FROM procedural_memories WHERE project = ? AND is_active = 1").get(pid).c;
      const tso = db.prepare("SELECT COUNT(*) as c FROM somatic_memories WHERE is_active = 1").get().c;
      const avgS = db.prepare("SELECT AVG(strength) as avg FROM episodic_memories WHERE project = ? AND is_active = 1").get(pid).avg || 0;
      let score = 100 - (1 - avgS) * 20;
      score = Math.max(0, Math.min(100, Math.round(score)));
      return { content: [{ type: "text", text: JSON.stringify({ health_score: score, memories: { episodic: te, semantic: ts, procedural: tp, somatic: tso, total: te + ts + tp + tso }, vector_search: hasVectors }, null, 2) }] };
    }

    // ═══ SPACED REPETITION ═══
    if (name === "review") {
      const due = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE project = ? AND is_active = 1 AND (next_review IS NULL OR next_review <= ?) ORDER BY strength ASC LIMIT ?").all(args.project || "default", now, args.limit || 10);
      return { content: [{ type: "text", text: JSON.stringify({ due_for_review: due, count: due.length }, null, 2) }] };
    }
    if (name === "strengthen") {
      const m = db.prepare("SELECT * FROM episodic_memories WHERE id = ?").get(args.memory_id);
      if (!m) return { content: [{ type: "text", text: "Memory not found." }], isError: true };
      const ns = Math.min(1, m.strength + (args.quality || 1) * 0.2);
      db.prepare("UPDATE episodic_memories SET strength = ?, access_count = access_count + 1, last_accessed = ? WHERE id = ?").run(ns, now, args.memory_id);
      return { content: [{ type: "text", text: JSON.stringify({ new_strength: Math.round(ns * 100) / 100 }, null, 2) }] };
    }

    // ═══ ASSOCIATIVE RECALL ═══
    if (name === "associations") {
      return { content: [{ type: "text", text: JSON.stringify({ associations: db.prepare("SELECT * FROM associations WHERE source_id = ? AND strength >= ? ORDER BY strength DESC").all(args.memory_id, args.min_strength || 0.2) }, null, 2) }] };
    }
    if (name === "find_path") {
      const visited = new Set(), queue = [{ id: args.from_id, path: [] }];
      let found = null;
      while (queue.length > 0 && !found) {
        const c = queue.shift();
        if (c.id === args.to_id) { found = c.path; break; }
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        if (c.path.length >= (args.max_depth || 5)) continue;
        for (const n of db.prepare("SELECT target_id, strength FROM associations WHERE source_id = ? AND strength >= 0.2").all(c.id)) {
          if (!visited.has(n.target_id)) queue.push({ id: n.target_id, path: [...c.path, { id: n.target_id, strength: n.strength }] });
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ path: found || [], found: !!found }, null, 2) }] };
    }

    // ═══ STANDARD OPERATIONS ═══
    if (name === "forget") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : args.memory_type === "somatic" ? "somatic_memories" : "episodic_memories";
      db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(args.memory_id);
      if (hasVectors && table === "episodic_memories") try { db.exec(`DELETE FROM episodic_embeddings WHERE rowid = ${args.memory_id}`); } catch (e) { /* ignore */ }
      return { content: [{ type: "text", text: `Memory ${args.memory_id} forgotten.` }] };
    }
    if (name === "update_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : "episodic_memories";
      db.prepare(`UPDATE ${table} SET content = ?, updated_at = ? WHERE id = ?`).run(args.new_content, now, args.memory_id);
      if (hasVectors && table === "episodic_memories") generateEmbedding(args.new_content).then(emb => storeEmbedding(db, args.memory_id, emb)).catch(() => {});
      return { content: [{ type: "text", text: JSON.stringify({ updated: true }, null, 2) }] };
    }
    if (name === "get_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : args.memory_type === "somatic" ? "somatic_memories" : "episodic_memories";
      const m = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(args.memory_id);
      if (!m || !m.is_active) return { content: [{ type: "text", text: "Memory not found." }] };
      return { content: [{ type: "text", text: JSON.stringify({ ...m, mutations: db.prepare("SELECT * FROM memory_mutations WHERE memory_id = ? ORDER BY created_at").all(args.memory_id) }, null, 2) }] };
    }
    if (name === "list_memories") {
      const pid = args.project || "default", mt = args.memory_type || "all", lim = args.limit || 50;
      const r = { episodic: [], semantic: [], procedural: [], somatic: [] };
      if (mt === "all" || mt === "episodic") r.episodic = db.prepare(`SELECT id, content, event_type, strength, mood_tag FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY strength DESC LIMIT ?`).all(pid, lim);
      if (mt === "all" || mt === "semantic") r.semantic = db.prepare("SELECT id, content, importance FROM semantic_memories WHERE project = ? AND is_active = 1 LIMIT ?").all(pid, lim);
      if (mt === "all" || mt === "procedural") r.procedural = db.prepare("SELECT id, title, mastery_level FROM procedural_memories WHERE project = ? AND is_active = 1 LIMIT ?").all(pid, lim);
      if (mt === "all" || mt === "somatic") r.somatic = db.prepare("SELECT entity_name, somatic_valence, somatic_weight FROM somatic_memories WHERE is_active = 1 LIMIT ?").all(lim);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    }

    // ═══ CONTRADICTIONS ═══
    if (name === "get_contradictions") {
      return { content: [{ type: "text", text: JSON.stringify(db.prepare("SELECT c.*, m1.content as c1, m2.content as c2 FROM contradictions c JOIN episodic_memories m1 ON m1.id = c.memory_id_1 JOIN episodic_memories m2 ON m2.id = c.memory_id_2 WHERE m1.project = ? AND c.resolved = 0").all(args.project || "default"), null, 2) }] };
    }
    if (name === "resolve_contradiction") {
      const c = db.prepare("SELECT * FROM contradictions WHERE id = ?").get(args.contradiction_id);
      if (!c) return { content: [{ type: "text", text: "Not found." }], isError: true };
      db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(args.keep_memory_id === c.memory_id_1 ? c.memory_id_2 : c.memory_id_1);
      db.prepare("UPDATE contradictions SET resolved = 1, resolved_at = ? WHERE id = ?").run(now, args.contradiction_id);
      return { content: [{ type: "text", text: JSON.stringify({ resolved: true }, null, 2) }] };
    }

    // ═══ IMPORT/EXPORT ═══
    if (name === "export_memories") {
      const pid = args.project || "default", fp = args.filepath || path.join(DATA_DIR, `export-${pid}-${Date.now()}.json`);
      const exp = { project: pid, exported_at: now, version: "3.1", episodic: db.prepare("SELECT * FROM episodic_memories WHERE project = ?").all(pid), semantic: db.prepare("SELECT * FROM semantic_memories WHERE project = ?").all(pid), procedural: db.prepare("SELECT * FROM procedural_memories WHERE project = ?").all(pid) };
      fs.writeFileSync(fp, JSON.stringify(exp, null, 2));
      return { content: [{ type: "text", text: `Exported to ${fp}` }] };
    }
    if (name === "import_memories") {
      const data = JSON.parse(fs.readFileSync(args.filepath, "utf-8")), pid = args.project || "default";
      let n = 0;
      for (const m of (data.episodic || [])) { db.prepare("INSERT OR IGNORE INTO episodic_memories (id, content, event_type, project, created_at) VALUES (?, ?, ?, ?, ?)").run(m.id, m.content, m.event_type, pid, m.created_at || now); n++; }
      return { content: [{ type: "text", text: `Imported ${n} memories.` }] };
    }

    // ═══ STATS ═══
    if (name === "get_stats") {
      const pid = args.project || "default";
      return { content: [{ type: "text", text: JSON.stringify({ project: pid, episodic: db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1").get(pid).c, semantic: db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(pid).c, procedural: db.prepare("SELECT COUNT(*) as c FROM procedural_memories WHERE project = ? AND is_active = 1").get(pid).c, somatic: db.prepare("SELECT COUNT(*) as c FROM somatic_memories WHERE is_active = 1").get().c, vector_search: hasVectors }, null, 2) }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`OWL Memory MCP v3.1 — Brain-inspired agent memory ${hasVectors ? "+ vector embeddings" : "(no vector extension)"} running on stdio`);
}

main().catch(console.error);
