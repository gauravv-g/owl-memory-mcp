
// ─── Tool Handlers ───────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const now = new Date().toISOString();

  try {
    // ═══ REMEMBER ═══
    if (name === "remember") {
      const content = args.content;
      const projectId = args.project || "default";
      const eventType = args.event_type || "observation";
      const confidence = args.confidence || 0.8;
      const isExperiential = args.is_experiential !== false;
      const sensoryType = args.sensory_type || "text";
      const emotion = detectEmotionalSalience(content);
      const moodTag = detectMood(content);
      const initialStrength = 0.5 + emotion.salience * 0.5;
      const sensoryDecay = getSensoryDecayRate(sensoryType);
      const nextReview = calculateNextReview(initialStrength, 0, emotion.salience, "raw");
      const memId = generateId(content, projectId);
      const entities = extractEntities(content);

      db.prepare(`INSERT INTO episodic_memories (id, content, event_type, project, location, source, confidence, emotional_valence, emotional_arousal, salience, strength, somatic_weight, somatic_valence, developmental_stage, created_at, updated_at, next_review, review_interval, is_experiential, sensory_type, sensory_fidelity, mood_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(memId, content, eventType, projectId, args.location || null, args.source || "conversation", confidence, emotion.valence, emotion.arousal, emotion.salience, initialStrength, emotion.salience > 0.3 ? emotion.salience * 0.5 : 0, emotion.valence * emotion.arousal, now, now, nextReview, 1.0, isExperiential ? 1 : 0, sensoryType, sensoryDecay, moodTag);

      db.prepare("INSERT INTO memory_mutations (memory_id, mutation_type, new_content, new_confidence, new_stage, reason, created_at) VALUES (?, 'created', ?, ?, 'raw', 'Initial storage', ?)").run(memId, content, confidence, now);

      for (const [eName, eType] of entities) {
        db.prepare("INSERT OR IGNORE INTO entities (name, entity_type, first_seen, last_seen) VALUES (?, ?, ?, ?)").run(eName, eType, now, now);
        const entityRow = db.prepare("SELECT id FROM entities WHERE name = ? AND entity_type = ?").get(eName, eType);
        if (entityRow) {
          db.prepare("INSERT OR IGNORE INTO memory_entities (memory_id, memory_type, entity_id) VALUES (?, 'episodic', ?)").run(memId, entityRow.id);
          db.prepare("UPDATE entities SET mention_count = mention_count + 1, last_seen = ? WHERE id = ?").run(now, entityRow.id);
        }
      }

      const existingMemories = db.prepare("SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1 AND id != ?").all(projectId, memId);
      let contradictionsFound = 0;
      for (const existing of existingMemories) {
        const similarity = calculateSimilarity(content, existing.content);
        if (similarity > 0.5) {
          const negationWords = ["not","don't","doesn't","won't","can't","never","no longer","changed","updated","actually","instead"];
          if (negationWords.some(w => content.toLowerCase().includes(w)) !== negationWords.some(w => existing.content.toLowerCase().includes(w)) && similarity > 0.6) {
            db.prepare("INSERT INTO contradictions (memory_id_1, memory_type_1, memory_id_2, memory_type_2, severity, detected_at) VALUES (?, 'episodic', ?, 'episodic', 'warning', ?)").run(existing.id, memId, now);
            contradictionsFound++;
          }
        }
      }

      if (emotion.salience > 0.3) {
        for (const [eName, eType] of entities) {
          if (eType === "proper_noun" || eType === "quoted") {
            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")
              .run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);
          }
        }
      }

      return { content: [{ type: "text", text: JSON.stringify({ memory_id: memId, event_type: eventType, emotional_valence: emotion.valence, emotional_arousal: emotion.arousal, salience: emotion.salience, strength: initialStrength, developmental_stage: "raw", next_review: nextReview, entities_extracted: entities.length, contradictions_detected: contradictionsFound, mood_tag: moodTag, sensory_type: sensoryType }, null, 2) }] };
    }

    // ═══ RECALL ═══
    if (name === "recall") {
      const query = args.query, projectId = args.project || "default", limit = args.limit || 10;
      const memoryType = args.memory_type || "all", minStrength = args.min_strength || 0;
      const includeWeak = args.include_weak || false, moodContext = args.mood_context || detectMood(query);
      const results = [], queryEntities = extractEntities(query), queryEmotion = detectEmotionalSalience(query);

      if (memoryType === "all" || memoryType === "episodic") {
        const q = includeWeak ? "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1" : "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength >= ?";
        const p = includeWeak ? [projectId] : [projectId, minStrength];
        for (const mem of db.prepare(q).all(...p)) {
          let score = calculateSimilarity(query, mem.content) * 0.25 + mem.strength * 0.15 + mem.salience * 0.1 + Math.min(mem.access_count / 10, 1) * 0.1 + mem.confidence * 0.1;
          if (Math.abs(queryEmotion.valence - mem.emotional_valence) < 0.3) score += 0.1;
          const memEntities = db.prepare("SELECT e.name FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = 'episodic'").all(mem.id);
          score += Math.min(0.15, queryEntities.filter(qe => memEntities.some(me => me.name.toLowerCase() === qe[0].toLowerCase())).length * 0.05);
          if (mem.is_in_working_memory) score += 0.15;
          if (moodContext && mem.mood_tag === moodContext) score += 0.1;
          if (mem.developmental_stage === "abstracted") score += 0.05;
          if (mem.developmental_stage === "consolidated") score += 0.03;
          if (score > 0.1) results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, salience: mem.salience, confidence: mem.confidence, emotional_valence: mem.emotional_valence, developmental_stage: mem.developmental_stage, mood_tag: mem.mood_tag, access_count: mem.access_count, relevance_score: Math.round(score * 1000) / 1000 });
          const hoursSince = mem.last_accessed ? (Date.now() - new Date(mem.last_accessed).getTime()) / 3600000 : 24;
          db.prepare("UPDATE episodic_memories SET access_count = access_count + 1, last_accessed = ?, strength = ? WHERE id = ?").run(now, Math.max(0.1, calculateRetention(mem.strength, hoursSince)), mem.id);
        }
      }
      if (memoryType === "all" || memoryType === "semantic") {
        for (const mem of db.prepare("SELECT * FROM semantic_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          const score = calculateSimilarity(query, mem.content) * 0.4 + mem.importance * 0.3 + mem.confidence * 0.3;
          if (score > 0.1) results.push({ id: mem.id, type: "semantic", content: mem.content, concept_type: mem.concept_type, importance: mem.importance, confidence: mem.confidence, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }
      if (memoryType === "all" || memoryType === "procedural") {
        for (const mem of db.prepare("SELECT * FROM procedural_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          const score = calculateSimilarity(query, mem.content) * 0.3 + mem.mastery_level * 0.3 + (mem.success_count / Math.max(mem.practice_count, 1)) * 0.2;
          if (score > 0.1) results.push({ id: mem.id, type: "procedural", title: mem.title, content: mem.content, mastery_level: mem.mastery_level, practice_count: mem.practice_count, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }
      if (memoryType === "all" || memoryType === "somatic") {
        for (const mem of db.prepare("SELECT * FROM somatic_memories WHERE is_active = 1").all()) {
          const score = calculateSimilarity(query, mem.entity_name) * 0.3 + mem.somatic_weight * 0.4 + Math.abs(mem.somatic_valence) * 0.2;
          if (score > 0.1) results.push({ id: mem.id, type: "somatic", entity_name: mem.entity_name, somatic_valence: mem.somatic_valence, somatic_weight: mem.somatic_weight, note: mem.note, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }
      results.sort((a, b) => b.relevance_score - a.relevance_score);
      return { content: [{ type: "text", text: JSON.stringify(results.slice(0, limit), null, 2) }] };
    }

    // ═══ FOCUS / UNFOCUS / GET_WORKING_MEMORY ═══
    if (name === "focus") {
      db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
      let memoryIds = args.memory_ids || [];
      if (args.query && memoryIds.length === 0) {
        memoryIds = db.prepare("SELECT id FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY strength DESC LIMIT 4").all(args.project || "default").map(m => m.id);
      }
      const limited = memoryIds.slice(0, 4);
      for (let i = 0; i < limited.length; i++) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, limited[i]);
      const loaded = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      return { content: [{ type: "text", text: JSON.stringify({ working_memory: loaded, capacity: 4, used: loaded.length }, null, 2) }] };
    }
    if (name === "unfocus") {
      if (args.clear_all) { db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run(); return { content: [{ type: "text", text: "Working memory cleared." }] }; }
      if (args.memory_ids?.length > 0) { for (const id of args.memory_ids) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL WHERE id = ?").run(id); return { content: [{ type: "text", text: `Removed ${args.memory_ids.length} memories.` }] }; }
      return { content: [{ type: "text", text: "Nothing to unfocus." }] };
    }
    if (name === "get_working_memory") {
      const memories = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      return { content: [{ type: "text", text: JSON.stringify({ working_memory: memories, capacity: 4, used: memories.length }, null, 2) }] };
    }

    // ═══ SESSION CHECKPOINTS ═══
    if (name === "save_checkpoint") {
      const checkpointId = generateId(args.name, "checkpoint");
      const wm = db.prepare("SELECT id FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      db.prepare("INSERT INTO session_checkpoints (id, name, project, working_memory_ids, context_description, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(checkpointId, args.name, args.project || "default", JSON.stringify(wm.map(m => m.id)), args.context_description || null, now);
      return { content: [{ type: "text", text: JSON.stringify({ checkpoint_id: checkpointId, name: args.name, memories_saved: wm.length }, null, 2) }] };
    }
    if (name === "restore_checkpoint") {
      const cp = db.prepare("SELECT * FROM session_checkpoints WHERE id = ?").get(args.checkpoint_id);
      if (!cp) return { content: [{ type: "text", text: "Checkpoint not found." }], isError: true };
      db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
      const ids = JSON.parse(cp.working_memory_ids || "[]");
      for (let i = 0; i < ids.length; i++) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, ids[i]);
      return { content: [{ type: "text", text: JSON.stringify({ restored: true, checkpoint: cp.name, memories_loaded: ids.length }, null, 2) }] };
    }
    if (name === "list_checkpoints") {
      const checkpoints = db.prepare("SELECT id, name, project, context_description, created_at FROM session_checkpoints WHERE project = ? AND is_active = 1 ORDER BY created_at DESC").all(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify(checkpoints, null, 2) }] };
    }

    // ═══ MEMORY PALACE ═══
    if (name === "create_room") {
      const roomId = generateId(args.name, "room");
      db.prepare("INSERT INTO palace_rooms (id, name, description, parent_room_id, position_x, position_y, position_z, sensory_anchors, mood, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(roomId, args.name, args.description || null, args.parent_room_id || null, args.position_x || 0, args.position_y || 0, args.position_z || 0, JSON.stringify(args.sensory_anchors || []), args.mood || "neutral", now);
      return { content: [{ type: "text", text: JSON.stringify({ room_id: roomId, name: args.name }, null, 2) }] };
    }
    if (name === "place_memory") {
      db.prepare("INSERT OR REPLACE INTO memory_placements (memory_id, memory_type, room_id, position_x, position_y, position_z, placement_note, placed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(args.memory_id, args.memory_type || "episodic", args.room_id, args.position_x || 0, args.position_y || 0, args.position_z || 0, args.placement_note || null, now);
      return { content: [{ type: "text", text: JSON.stringify({ placed: true, memory_id: args.memory_id, room_id: args.room_id }, null, 2) }] };
    }
    if (name === "navigate_palace") {
      if (args.list_rooms !== false) {
        const rooms = db.prepare("SELECT id, name, description, parent_room_id, position_x, position_y, position_z, mood FROM palace_rooms ORDER BY name").all();
        return { content: [{ type: "text", text: JSON.stringify({ rooms }, null, 2) }] };
      }
      if (args.room_id) {
        const room = db.prepare("SELECT * FROM palace_rooms WHERE id = ?").get(args.room_id);
        const memories = db.prepare("SELECT mp.*, em.content FROM memory_placements mp LEFT JOIN episodic_memories em ON em.id = mp.memory_id WHERE mp.room_id = ?").all(args.room_id);
        return { content: [{ type: "text", text: JSON.stringify({ room, memories }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: "Provide room_id or list_rooms: true" }) }] };
    }

    // ═══ DREAM CONSOLIDATION ═══
    if (name === "dream") {
      const result = consolidateMemories(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify({ status: "completed", ...result, message: `Dream: processed ${result.processed}, merged ${result.merged}, pruned ${result.pruned}, schemas ${result.schemasCreated}, associations ${result.associationsFormed}, threats ${result.threatsIdentified}, somatic ${result.somaticUpdated}, patterns ${result.patternsDiscovered}, creative ${result.novelConnections}` }, null, 2) }] };
    }
    if (name === "get_consolidation_history") {
      const history = db.prepare("SELECT * FROM consolidation_log ORDER BY started_at DESC LIMIT ?").all(args.limit || 10);
      return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
    }

    // ═══ NARRATIVE MEMORY ═══
    if (name === "create_narrative") {
      const chainId = generateId(args.title, "narrative");
      db.prepare("INSERT INTO narrative_chains (id, title, description, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(chainId, args.title, args.description || null, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ chain_id: chainId, title: args.title }, null, 2) }] };
    }
    if (name === "add_to_narrative") {
      const maxOrder = db.prepare("SELECT MAX(sequence_order) as max FROM narrative_events WHERE chain_id = ?").get(args.chain_id);
      const nextOrder = (maxOrder?.max || 0) + 1;
      db.prepare("INSERT INTO narrative_events (chain_id, memory_id, memory_type, sequence_order, causal_role) VALUES (?, ?, ?, ?, ?)").run(args.chain_id, args.memory_id, args.memory_type || "episodic", nextOrder, args.causal_role || "event");
      db.prepare("UPDATE narrative_chains SET updated_at = ? WHERE id = ?").run(now, args.chain_id);
      return { content: [{ type: "text", text: JSON.stringify({ added: true, chain_id: args.chain_id, position: nextOrder }, null, 2) }] };
    }
    if (name === "get_narrative") {
      const chain = db.prepare("SELECT * FROM narrative_chains WHERE id = ?").get(args.chain_id);
      if (!chain) return { content: [{ type: "text", text: "Narrative not found." }] };
      const events = db.prepare("SELECT ne.*, em.content FROM narrative_events ne LEFT JOIN episodic_memories em ON em.id = ne.memory_id WHERE ne.chain_id = ? ORDER BY ne.sequence_order").all(args.chain_id);
      return { content: [{ type: "text", text: JSON.stringify({ chain, events }, null, 2) }] };
    }
    if (name === "list_narratives") {
      const narratives = db.prepare("SELECT * FROM narrative_chains WHERE project = ? AND is_active = 1 ORDER BY updated_at DESC").all(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify(narratives, null, 2) }] };
    }
    if (name === "imagine") {
      const cfId = generateId(args.counterfactual, "cf");
      db.prepare("INSERT INTO counterfactuals (narrative_id, original_event_id, counterfactual_scenario, plausibility, created_at) VALUES (?, ?, ?, 0.5, ?)").run(args.narrative_id, args.narrative_id, args.counterfactual, now);
      return { content: [{ type: "text", text: JSON.stringify({ imagined: true, scenario: args.counterfactual, message: "Counterfactual recorded. The narrative can now explore 'what if' this had happened differently." }, null, 2) }] };
    }

    // ═══ PROCEDURAL MEMORY ═══
    if (name === "learn_skill") {
      const skillId = generateId(args.title, "skill");
      db.prepare("INSERT INTO procedural_memories (id, title, content, trigger_conditions, action_sequence, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(skillId, args.title, args.content, JSON.stringify(args.trigger_conditions || []), JSON.stringify(args.action_sequence || []), args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ skill_id: skillId, title: args.title, mastery_level: 0.1 }, null, 2) }] };
    }
    if (name === "practice_skill") {
      const skill = db.prepare("SELECT * FROM procedural_memories WHERE id = ?").get(args.skill_id);
      if (!skill) return { content: [{ type: "text", text: "Skill not found." }], isError: true };
      const newPractice = skill.practice_count + 1, newSuccess = skill.success_count + (args.success ? 1 : 0), newFailure = skill.failure_count + (args.success ? 0 : 1);
      const newMastery = Math.max(0, Math.min(1, skill.mastery_level + (args.success ? 0.05 : -0.02)));
      db.prepare("UPDATE procedural_memories SET practice_count = ?, success_count = ?, failure_count = ?, mastery_level = ?, last_practiced = ?, updated_at = ? WHERE id = ?").run(newPractice, newSuccess, newFailure, newMastery, now, now, args.skill_id);
      return { content: [{ type: "text", text: JSON.stringify({ skill_id: args.skill_id, mastery_level: Math.round(newMastery * 100) / 100, practice_count: newPractice, success_rate: Math.round(newSuccess / newPractice * 100) / 100 }, null, 2) }] };
    }

    // ═══ SOMATIC MEMORY ═══
    if (name === "get_somatic") {
      const somatic = db.prepare("SELECT * FROM somatic_memories WHERE entity_name = ? AND is_active = 1").get(args.entity_name);
      if (!somatic) return { content: [{ type: "text", text: JSON.stringify({ entity_name: args.entity_name, found: false, message: "No somatic memory for this entity." }, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ found: true, ...somatic }, null, 2) }] };
    }
    if (name === "list_somatic") {
      const somatic = db.prepare("SELECT entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, trigger_count, note FROM somatic_memories WHERE is_active = 1 AND somatic_weight >= ? ORDER BY somatic_weight DESC").all(args.min_weight || 0);
      return { content: [{ type: "text", text: JSON.stringify({ somatic_map: somatic, count: somatic.length }, null, 2) }] };
    }

    // ═══ TRANSATIVE MEMORY ═══
    if (name === "know_who_knows") {
      db.prepare("INSERT OR REPLACE INTO transactive_memory (agent_name, domain, expertise_level, trust_level, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(args.agent_name, args.domain, args.expertise_level || 0.5, args.trust_level || 0.8, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ recorded: true, agent: args.agent_name, domain: args.domain }, null, 2) }] };
    }
    if (name === "find_expert") {
      const experts = db.prepare("SELECT agent_name, domain, expertise_level, trust_level FROM transactive_memory WHERE domain LIKE ? AND expertise_level >= ? AND project = ? ORDER BY expertise_level DESC").all(`%${args.domain}%`, args.min_expertise || 0.3, args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify({ domain: args.domain, experts, count: experts.length }, null, 2) }] };
    }

    // ═══ THREAT SIMULATION ═══
    if (name === "get_threats") {
      const severityFilter = args.severity === "all" ? "" : ` AND severity = '${args.severity}'`;
      const threats = db.prepare(`SELECT pattern_name, description, severity, hit_count, mitigation FROM threat_patterns WHERE is_active = 1${severityFilter} ORDER BY severity DESC`).all();
      return { content: [{ type: "text", text: JSON.stringify({ threats, count: threats.length }, null, 2) }] };
    }
    if (name === "warn_me") {
      const context = args.context;
      const threats = db.prepare("SELECT * FROM threat_patterns WHERE is_active = 1").all();
      const relevant = threats.filter(t => {
        const triggers = JSON.parse(t.trigger_conditions || "[]");
        return triggers.some(tr => context.toLowerCase().includes(tr.toLowerCase())) || calculateSimilarity(context, t.description) > 0.3;
      });
      return { content: [{ type: "text", text: JSON.stringify({ context, threats_found: relevant.length, threats: relevant, message: relevant.length > 0 ? `⚠️ ${relevant.length} potential threat(s) detected based on past failures.` : "No threats detected for this context." }, null, 2) }] };
    }

    // ═══ PREDICTIVE MEMORY ═══
    if (name === "predict_needs") {
      const context = args.context;
      const mood = detectMood(context);
      const patterns = db.prepare("SELECT * FROM predictive_patterns WHERE (trigger_context LIKE ? OR trigger_context LIKE ?) AND is_active = 1 ORDER BY confidence DESC").all(`%${context.slice(0, 30)}%`, `%mood:${mood}%`);
      const relatedMemories = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE project = ? AND is_active = 1 AND mood_tag = ? ORDER BY strength DESC LIMIT 5").all(args.project || "default", mood);
      return { content: [{ type: "text", text: JSON.stringify({ context, detected_mood: mood, predicted_patterns: patterns, likely_needed_memories: relatedMemories }, null, 2) }] };
    }

    // ═══ MEMORY MUTATIONS ═══
    if (name === "get_mutation_history") {
      const mutations = db.prepare("SELECT * FROM memory_mutations WHERE memory_id = ? ORDER BY created_at ASC").all(args.memory_id);
      return { content: [{ type: "text", text: JSON.stringify({ memory_id: args.memory_id, mutations, count: mutations.length }, null, 2) }] };
    }

    // ═══ METACOGNITION ═══
    if (name === "reflect") {
      db.prepare("INSERT OR REPLACE INTO metacognition (memory_id, memory_type, confidence, source_reliability, knowledge_gap, reflection, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(args.memory_id, args.memory_type || "episodic", args.confidence || 0.8, 0.5, args.knowledge_gap || null, args.reflection || null, now, now);
      return { content: [{ type: "text", text: JSON.stringify({ reflected: true, memory_id: args.memory_id }, null, 2) }] };
    }
    if (name === "health_check") {
      const projectId = args.project || "default";
      const totalEpisodic = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId).c;
      const totalSemantic = db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(projectId).c;
      const totalProcedural = db.prepare("SELECT COUNT(*) as c FROM procedural_memories WHERE project = ? AND is_active = 1").get(projectId).c;
      const totalSomatic = db.prepare("SELECT COUNT(*) as c FROM somatic_memories WHERE is_active = 1").get().c;
      const conflicts = db.prepare("SELECT COUNT(*) as c FROM contradictions c JOIN episodic_memories m ON m.id = c.memory_id_1 WHERE m.project = ? AND c.resolved = 0").get(projectId).c;
      const stale = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength < 0.2").get(projectId).c;
      const wmLoad = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE is_in_working_memory = 1").get().c;
      const avgStrength = db.prepare("SELECT AVG(strength) as avg FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId).avg || 0;
      const lastDream = db.prepare("SELECT * FROM consolidation_log WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1").get();
      const threats = db.prepare("SELECT COUNT(*) as c FROM threat_patterns WHERE is_active = 1").get().c;
      const transactive = db.prepare("SELECT COUNT(*) as c FROM transactive_memory").get().c;
      let healthScore = 100;
      healthScore -= conflicts * 10 + stale * 5 + (1 - avgStrength) * 20;
      healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));
      return { content: [{ type: "text", text: JSON.stringify({ health_score: healthScore, status: healthScore > 80 ? "healthy" : healthScore > 50 ? "needs_attention" : "critical", project: projectId, memories: { episodic: totalEpisodic, semantic: totalSemantic, procedural: totalProcedural, somatic: totalSomatic, total: totalEpisodic + totalSemantic + totalProcedural + totalSomatic }, conflicts, stale_memories: stale, working_memory: `${wmLoad}/4`, avg_strength: Math.round(avgStrength * 100) / 100, threats_tracked: threats, transactive_entries: transactive, last_consolidation: lastDream?.completed_at || "never" }, null, 2) }] };
    }

    // ═══ SPACED REPETITION ═══
    if (name === "review") {
      const due = db.prepare("SELECT id, content, strength, review_interval, access_count FROM episodic_memories WHERE project = ? AND is_active = 1 AND (next_review IS NULL OR next_review <= ?) ORDER BY strength ASC LIMIT ?").all(args.project || "default", now, args.limit || 10);
      return { content: [{ type: "text", text: JSON.stringify({ due_for_review: due, count: due.length }, null, 2) }] };
    }
    if (name === "strengthen") {
      const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ?").get(args.memory_id);
      if (!mem) return { content: [{ type: "text", text: "Memory not found." }], isError: true };
      const quality = args.quality || 1;
      const newStrength = Math.min(1, mem.strength + quality * 0.2);
      const newInterval = mem.review_interval * (1.5 + quality);
      const nextReview = new Date(Date.now() + newInterval * 3600000).toISOString();
      db.prepare("UPDATE episodic_memories SET strength = ?, review_interval = ?, next_review = ?, access_count = access_count + 1, last_accessed = ? WHERE id = ?").run(newStrength, newInterval, nextReview, now, args.memory_id);
      return { content: [{ type: "text", text: JSON.stringify({ memory_id: args.memory_id, new_strength: Math.round(newStrength * 100) / 100, next_review: nextReview }, null, 2) }] };
    }

    // ═══ ASSOCIATIVE RECALL ═══
    if (name === "associations") {
      const assoc = db.prepare("SELECT a.*, e.name as target_name FROM associations a LEFT JOIN entities e ON e.id = a.target_id WHERE a.source_id = ? AND a.source_type = ? AND a.strength >= ? ORDER BY a.strength DESC").all(args.memory_id, args.memory_type || "episodic", args.min_strength || 0.2);
      return { content: [{ type: "text", text: JSON.stringify({ memory_id: args.memory_id, associations: assoc }, null, 2) }] };
    }
    if (name === "find_path") {
      const visited = new Set(), queue = [{ id: args.from_id, path: [] }];
      let found = null;
      while (queue.length > 0 && !found) {
        const current = queue.shift();
        if (current.id === args.to_id) { found = current.path; break; }
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        if (current.path.length >= (args.max_depth || 5)) continue;
        const neighbors = db.prepare("SELECT target_id, target_type, strength, association_type FROM associations WHERE source_id = ? AND strength >= 0.2").all(current.id);
        for (const n of neighbors) {
          if (!visited.has(n.target_id)) queue.push({ id: n.target_id, path: [...current.path, { id: n.target_id, type: n.target_type, strength: n.strength, association_type: n.association_type }] });
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ from: args.from_id, to: args.to_id, path: found || [], found: !!found }, null, 2) }] };
    }

    // ═══ STANDARD OPERATIONS ═══
    if (name === "forget") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : args.memory_type === "somatic" ? "somatic_memories" : "episodic_memories";
      db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(args.memory_id);
      return { content: [{ type: "text", text: `Memory ${args.memory_id} forgotten.` }] };
    }
    if (name === "update_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : "episodic_memories";
      const old = db.prepare(`SELECT content, confidence FROM ${table} WHERE id = ?`).get(args.memory_id);
      const emotion = detectEmotionalSalience(args.new_content);
      db.prepare(`UPDATE ${table} SET content = ?, updated_at = ? WHERE id = ?`).run(args.new_content, now, args.memory_id);
      if (args.memory_type !== "semantic" && args.memory_type !== "procedural") {
        db.prepare("UPDATE episodic_memories SET emotional_valence = ?, emotional_arousal = ?, salience = ? WHERE id = ?").run(emotion.valence, emotion.arousal, emotion.salience, args.memory_id);
      }
      db.prepare("INSERT INTO memory_mutations (memory_id, mutation_type, previous_content, new_content, previous_confidence, new_confidence, reason, created_at) VALUES (?, 'updated', ?, ?, ?, ?, 'User update', ?)").run(args.memory_id, old?.content, args.new_content, old?.confidence, emotion.salience, now);
      return { content: [{ type: "text", text: JSON.stringify({ updated: true, memory_id: args.memory_id }, null, 2) }] };
    }
    if (name === "get_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : args.memory_type === "somatic" ? "somatic_memories" : "episodic_memories";
      const mem = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(args.memory_id);
      if (!mem) return { content: [{ type: "text", text: "Memory not found." }] };
      const entities = db.prepare("SELECT e.name, e.entity_type FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = ?").all(args.memory_id, args.memory_type || "episodic");
      const assoc = db.prepare("SELECT * FROM associations WHERE source_id = ? AND source_type = ?").all(args.memory_id, args.memory_type || "episodic");
      const mutations = db.prepare("SELECT * FROM memory_mutations WHERE memory_id = ? ORDER BY created_at ASC").all(args.memory_id);
      const metacog = db.prepare("SELECT * FROM metacognition WHERE memory_id = ? AND memory_type = ?").get(args.memory_id, args.memory_type || "episodic");
      return { content: [{ type: "text", text: JSON.stringify({ ...mem, entities, associations: assoc, mutations, metacognition: metacog }, null, 2) }] };
    }
    if (name === "list_memories") {
      const projectId = args.project || "default", memoryType = args.memory_type || "all", limit = args.limit || 50;
      const minStrength = args.min_strength || 0, orderBy = args.order_by || "strength";
      const results = { episodic: [], semantic: [], procedural: [], somatic: [] };
      if (memoryType === "all" || memoryType === "episodic") {
        let q = `SELECT id, content, event_type, strength, salience, confidence, emotional_valence, developmental_stage, mood_tag, access_count, created_at FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength >= ?`;
        if (args.developmental_stage) q += ` AND developmental_stage = '${args.developmental_stage}'`;
        if (args.mood_tag) q += ` AND mood_tag = '${args.mood_tag}'`;
        q += ` ORDER BY ${orderBy} DESC LIMIT ?`;
        results.episodic = db.prepare(q).all(projectId, minStrength, limit);
      }
      if (memoryType === "all" || memoryType === "semantic") {
        results.semantic = db.prepare("SELECT id, content, concept_type, importance, confidence, created_at FROM semantic_memories WHERE project = ? AND is_active = 1 ORDER BY importance DESC LIMIT ?").all(projectId, limit);
      }
      if (memoryType === "all" || memoryType === "procedural") {
        results.procedural = db.prepare("SELECT id, title, content, mastery_level, practice_count, success_count FROM procedural_memories WHERE project = ? AND is_active = 1 ORDER BY mastery_level DESC LIMIT ?").all(projectId, limit);
      }
      if (memoryType === "all" || memoryType === "somatic") {
        results.somatic = db.prepare("SELECT entity_name, entity_type, somatic_valence, somatic_weight, trigger_count FROM somatic_memories WHERE is_active = 1 ORDER BY somatic_weight DESC LIMIT ?").all(limit);
      }
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }

    // ═══ CONTRADICTIONS ═══
    if (name === "get_contradictions") {
      const contradictions = db.prepare("SELECT c.*, m1.content as content1, m2.content as content2 FROM contradictions c JOIN episodic_memories m1 ON m1.id = c.memory_id_1 JOIN episodic_memories m2 ON m2.id = c.memory_id_2 WHERE m1.project = ? AND c.resolved = 0 ORDER BY c.detected_at DESC").all(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify(contradictions, null, 2) }] };
    }
    if (name === "resolve_contradiction") {
      const contra = db.prepare("SELECT * FROM contradictions WHERE id = ?").get(args.contradiction_id);
      if (!contra) return { content: [{ type: "text", text: "Contradiction not found." }], isError: true };
      const forgetId = args.keep_memory_id === contra.memory_id_1 ? contra.memory_id_2 : contra.memory_id_1;
      db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(forgetId);
      db.prepare("UPDATE contradictions SET resolved = 1, resolution = ?, resolved_at = ? WHERE id = ?").run(args.resolution || "", now, args.contradiction_id);
      return { content: [{ type: "text", text: JSON.stringify({ resolved: true, kept: args.keep_memory_id, forgot: forgetId }, null, 2) }] };
    }

    // ═══ IMPORT/EXPORT ═══
    if (name === "export_memories") {
      const projectId = args.project || "default", filepath = args.filepath || path.join(DATA_DIR, `export-${projectId}-${Date.now()}.json`);
      const export_data = { project: projectId, exported_at: now, version: "3.0" };
      if (args.memory_type === "all" || args.memory_type === "episodic") export_data.episodic = db.prepare("SELECT * FROM episodic_memories WHERE project = ?").all(projectId);
      if (args.memory_type === "all" || args.memory_type === "semantic") export_data.semantic = db.prepare("SELECT * FROM semantic_memories WHERE project = ?").all(projectId);
      if (args.memory_type === "all" || args.memory_type === "procedural") export_data.procedural = db.prepare("SELECT * FROM procedural_memories WHERE project = ?").all(projectId);
      if (args.memory_type === "all" || args.memory_type === "somatic") export_data.somatic = db.prepare("SELECT * FROM somatic_memories").all();
      export_data.associations = db.prepare("SELECT * FROM associations").all();
      export_data.entities = db.prepare("SELECT * FROM entities").all();
      export_data.narrative_chains = db.prepare("SELECT * FROM narrative_chains WHERE project = ?").all(projectId);
      export_data.mutations = db.prepare("SELECT * FROM memory_mutations").all();
      export_data.transactive = db.prepare("SELECT * FROM transactive_memory").all();
      export_data.threats = db.prepare("SELECT * FROM threat_patterns").all();
      fs.writeFileSync(filepath, JSON.stringify(export_data, null, 2));
      return { content: [{ type: "text", text: `Exported to ${filepath}` }] };
    }
    if (name === "import_memories") {
      const data = JSON.parse(fs.readFileSync(args.filepath, "utf-8"));
      const projectId = args.project || "default";
      let imported = 0;
      for (const mem of (data.episodic || [])) { db.prepare("INSERT OR IGNORE INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, confidence, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(mem.id, mem.content, mem.event_type, projectId, mem.emotional_valence, mem.emotional_arousal, mem.salience, mem.strength, mem.confidence, mem.source || "import", mem.created_at, now); imported++; }
      for (const mem of (data.semantic || [])) { db.prepare("INSERT OR IGNORE INTO semantic_memories (id, content, concept_type, project, importance, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(mem.id, mem.content, mem.concept_type, projectId, mem.importance, mem.confidence, mem.created_at, now); imported++; }
      for (const mem of (data.procedural || [])) { db.prepare("INSERT OR IGNORE INTO procedural_memories (id, title, content, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(mem.id, mem.title, mem.content, projectId, mem.created_at, now); imported++; }
      for (const mem of (data.somatic || [])) { db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(mem.id, mem.entity_name, mem.entity_type, mem.somatic_valence, mem.somatic_arousal, mem.somatic_weight, now); imported++; }
      return { content: [{ type: "text", text: `Imported ${imported} memories.` }] };
    }

    // ═══ STATS ═══
    if (name === "get_stats") {
      const projectId = args.project || "default";
      const episodic = db.prepare("SELECT COUNT(*) as c, AVG(strength) as avg_str, AVG(salience) as avg_sal FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId);
      const semantic = db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(projectId);
      const procedural = db.prepare("SELECT COUNT(*) as c, AVG(mastery_level) as avg_mastery FROM procedural_memories WHERE project = ? AND is_active = 1").get(projectId);
      const somatic = db.prepare("SELECT COUNT(*) as c FROM somatic_memories WHERE is_active = 1").get();
      const entities = db.prepare("SELECT COUNT(*) as c FROM entities").get();
      const associations = db.prepare("SELECT COUNT(*) as c FROM associations").get();
      const contradictions = db.prepare("SELECT COUNT(*) as c FROM contradictions c JOIN episodic_memories m ON m.id = c.memory_id_1 WHERE m.project = ? AND c.resolved = 0").get(projectId);
      const wm = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE is_in_working_memory = 1").get();
      const rooms = db.prepare("SELECT COUNT(*) as c FROM palace_rooms").get();
      const narratives = db.prepare("SELECT COUNT(*) as c FROM narrative_chains WHERE project = ? AND is_active = 1").get(projectId);
      const mutations = db.prepare("SELECT COUNT(*) as c FROM memory_mutations").get();
      const transactive = db.prepare("SELECT COUNT(*) as c FROM transactive_memory").get();
      const threats = db.prepare("SELECT COUNT(*) as c FROM threat_patterns WHERE is_active = 1").get();
      const patterns = db.prepare("SELECT COUNT(*) as c FROM predictive_patterns WHERE is_active = 1").get();
      const checkpoints = db.prepare("SELECT COUNT(*) as c FROM session_checkpoints WHERE project = ? AND is_active = 1").get(projectId);
      return { content: [{ type: "text", text: JSON.stringify({ project: projectId, memories: { episodic: episodic?.c || 0, semantic: semantic?.c || 0, procedural: procedural?.c || 0, somatic: somatic?.c || 0, total: (episodic?.c || 0) + (semantic?.c || 0) + (procedural?.c || 0) + (somatic?.c || 0) }, avg_strength: Math.round((episodic?.avg_str || 0) * 100) / 100, avg_salience: Math.round((episodic?.avg_sal || 0) * 100) / 100, avg_mastery: Math.round((procedural?.avg_mastery || 0) * 100) / 100, entities: entities?.c || 0, associations: associations?.c || 0, contradictions: contradictions?.c || 0, working_memory: `${wm?.c || 0}/4`, palace_rooms: rooms?.c || 0, narratives: narratives?.c || 0, mutations: mutations?.c || 0, transactive: transactive?.c || 0, threats: threats?.c || 0, predictive_patterns: patterns?.c || 0, checkpoints: checkpoints?.c || 0, database: DB_PATH }, null, 2) }] };
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
  console.error("OWL Memory MCP v3.0 — Brain-inspired agent memory running on stdio");
}

main().catch(console.error);
