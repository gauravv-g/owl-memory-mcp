"""
OWL QA Genome Engine (Pillar 1)
===============================
Treats test flows as chromosomes that reproduce, mutate, and evolve.
"""

import json
import random
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from owl_shared_intelligence import _OWL_DB_PATH

class TestChromosome:
    def __init__(
        self,
        flow_name: str,
        target_url: Optional[str],
        target_app: Optional[str],
        steps: List[Dict[str, Any]],
        fitness_score: float = 0.5,
        bug_catch_count: int = 0,
        false_positive_count: int = 0,
        run_count: int = 0,
        generation: int = 1,
        parent_flow_name: Optional[str] = None,
        mutation_type: Optional[str] = None,
        project: str = "default"
    ):
        self.flow_name = flow_name
        self.target_url = target_url
        self.target_app = target_app
        self.steps = steps
        self.fitness_score = fitness_score
        self.bug_catch_count = bug_catch_count
        self.false_positive_count = false_positive_count
        self.run_count = run_count
        self.generation = generation
        self.parent_flow_name = parent_flow_name
        self.mutation_type = mutation_type
        self.project = project

    def to_dict(self) -> Dict[str, Any]:
        return {
            "flow_name": self.flow_name,
            "target_url": self.target_url,
            "target_app": self.target_app,
            "steps": self.steps,
            "fitness_score": self.fitness_score,
            "bug_catch_count": self.bug_catch_count,
            "false_positive_count": self.false_positive_count,
            "run_count": self.run_count,
            "generation": self.generation,
            "parent_flow_name": self.parent_flow_name,
            "mutation_type": self.mutation_type,
            "project": self.project
        }

def calculate_fitness(bug_catch: int, false_pos: int, run_cnt: int, avg_duration_ms: float = 5000.0) -> float:
    """Computes a fitness score between 0.0 and 1.0."""
    if run_cnt == 0:
        return 0.5
    
    # Raw success rate of catching bugs
    catch_rate = bug_catch / run_cnt
    
    # Penalty for false positives (flaky tests)
    flakiness_penalty = (false_pos / run_cnt) * 0.5
    
    # Speed bonus: faster execution is preferred if they catch the same bugs
    # Normalize duration: 30 seconds (30000ms) is max duration
    duration_penalty = min(avg_duration_ms / 30000.0, 0.2)
    
    score = catch_rate * 0.8 - flakiness_penalty - duration_penalty + 0.3
    return max(0.0, min(1.0, score))

def mutate(chrom: TestChromosome) -> TestChromosome:
    """Creates a mutated copy of a chromosome with randomized variations."""
    mutated_steps = [dict(step) for step in chrom.steps]
    mutation_types = ["input", "selector", "delay", "delete", "shuffle", "viewport"]
    chosen_mutation = random.choice(mutation_types)
    
    if not mutated_steps:
        # Cannot mutate empty steps, just add a dummy wait
        mutated_steps.append({"action_type": "wait", "value": "1000"})
        chosen_mutation = "insert"

    elif chosen_mutation == "input":
        # Mutate type/input value steps
        for step in mutated_steps:
            if step.get("action_type") in ["type", "type_text"]:
                original_val = str(step.get("value", ""))
                # Tweak value to test edge cases
                tweaks = [
                    original_val + "xyz",
                    original_val * 2,
                    "",  # empty string
                    "A" * 1000,  # overflow test
                    "' OR '1'='1",  # injection fuzzer
                    "<script>alert(1)</script>"  # XSS fuzzer
                ]
                step["value"] = random.choice(tweaks)
                break
                
    elif chosen_mutation == "selector":
        # Tweak target selectors slightly to check resilience
        for step in mutated_steps:
            target = step.get("target") or step.get("resource_id")
            if target:
                # E.g. replace id with a class target or text search (healer will trigger if it fails)
                if target.startswith("#"):
                    step["target"] = f"[id='{target[1:]}']"
                break

    elif chosen_mutation == "delay":
        # Insert a delay or adjust an existing wait step
        found_wait = False
        for step in mutated_steps:
            if step.get("action_type") == "wait":
                orig_val = int(step.get("value") or 1000)
                step["value"] = str(max(200, orig_val + random.choice([-500, 500, 1000])))
                found_wait = True
                break
        if not found_wait:
            insert_idx = random.randint(0, len(mutated_steps))
            mutated_steps.insert(insert_idx, {"action_type": "wait", "value": "1500"})

    elif chosen_mutation == "delete" and len(mutated_steps) > 1:
        # Delete a random step to test if previous steps were redundant
        delete_idx = random.randint(0, len(mutated_steps) - 1)
        mutated_steps.pop(delete_idx)

    elif chosen_mutation == "shuffle" and len(mutated_steps) > 2:
        # Shuffle order of two adjacent intermediate steps
        idx = random.randint(1, len(mutated_steps) - 2)
        mutated_steps[idx], mutated_steps[idx+1] = mutated_steps[idx+1], mutated_steps[idx]

    elif chosen_mutation == "viewport":
        # Insert viewport changes to test mobile vs desktop behavior
        viewports = [
            {"action_type": "press_key", "target": "viewport", "value": "375x812"}, # iPhone X
            {"action_type": "press_key", "target": "viewport", "value": "1920x1080"}, # Desktop FHD
            {"action_type": "scroll", "target": "window", "value": "down"}
        ]
        mutated_steps.insert(0, random.choice(viewports))

    # Clean flow name for mutant child
    mutant_id = f"mut_{random.randint(1000, 9999)}"
    clean_flow = chrom.flow_name.split("_gen")[0]
    new_flow_name = f"{clean_flow}_gen{chrom.generation + 1}_{mutant_id}"

    return TestChromosome(
        flow_name=new_flow_name,
        target_url=chrom.target_url,
        target_app=chrom.target_app,
        steps=mutated_steps,
        fitness_score=0.5,  # Needs evaluation
        bug_catch_count=0,
        false_positive_count=0,
        run_count=0,
        generation=chrom.generation + 1,
        parent_flow_name=chrom.flow_name,
        mutation_type=chosen_mutation,
        project=chrom.project
    )

def crossover(parent_a: TestChromosome, parent_b: TestChromosome) -> TestChromosome:
    """Combines steps from two parents to make a hybrid chromosome."""
    steps_a = parent_a.steps
    steps_b = parent_b.steps
    
    # Single-point crossover on steps list
    split_a = random.randint(1, max(1, len(steps_a) - 1))
    split_b = random.randint(1, max(1, len(steps_b) - 1))
    
    hybrid_steps = steps_a[:split_a] + steps_b[split_b:]
    
    hybrid_id = f"cross_{random.randint(1000, 9999)}"
    clean_flow = parent_a.flow_name.split("_gen")[0]
    new_flow_name = f"{clean_flow}_gen{max(parent_a.generation, parent_b.generation) + 1}_{hybrid_id}"
    
    return TestChromosome(
        flow_name=new_flow_name,
        target_url=parent_a.target_url,
        target_app=parent_a.target_app,
        steps=hybrid_steps,
        fitness_score=0.5,
        bug_catch_count=0,
        false_positive_count=0,
        run_count=0,
        generation=max(parent_a.generation, parent_b.generation) + 1,
        parent_flow_name=f"{parent_a.flow_name}+{parent_b.flow_name}",
        mutation_type="crossover",
        project=parent_a.project
    )

def load_chromosomes(project: str = "default") -> List[TestChromosome]:
    """Loads all test chromosomes from the SQLite database."""
    chromosomes = []
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            # Check if flow_steps_json column exists
            cursor = conn.execute("PRAGMA table_info(qa_test_genome)")
            columns = [row["name"] for row in cursor.fetchall()]
            if "flow_steps_json" not in columns:
                conn.execute("ALTER TABLE qa_test_genome ADD COLUMN flow_steps_json TEXT")
                conn.commit()

            cursor = conn.execute(
                "SELECT * FROM qa_test_genome WHERE project = ?", (project,)
            )
            rows = cursor.fetchall()
            for r in rows:
                steps = []
                if r["flow_steps_json"]:
                    try:
                        steps = json.loads(r["flow_steps_json"])
                    except Exception:
                        pass
                
                chromosomes.append(
                    TestChromosome(
                        flow_name=r["flow_name"],
                        target_url=r["target_url"],
                        target_app=r["target_app"],
                        steps=steps,
                        fitness_score=r["fitness_score"],
                        bug_catch_count=r["bug_catch_count"],
                        false_positive_count=r["false_positive_count"],
                        run_count=r["run_count"],
                        generation=r["generation"],
                        parent_flow_name=r["parent_flow_name"],
                        mutation_type=r["mutation_type"],
                        project=r["project"]
                    )
                )
    except Exception as e:
        print(f"[Genome] Error loading chromosomes: {e}", file=sys.stderr)
    return chromosomes

def save_chromosome(chrom: TestChromosome):
    """Saves or updates a chromosome in the SQLite database."""
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            # Check for column existence first
            cursor = conn.execute("PRAGMA table_info(qa_test_genome)")
            columns = [row["name"] for row in cursor.fetchall()]
            if "flow_steps_json" not in columns:
                conn.execute("ALTER TABLE qa_test_genome ADD COLUMN flow_steps_json TEXT")
                conn.commit()

            conn.execute(
                """
                INSERT OR REPLACE INTO qa_test_genome
                  (id, flow_name, target_url, target_app, fitness_score, bug_catch_count,
                   false_positive_count, run_count, generation, parent_flow_name,
                   mutation_type, project, flow_steps_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"chrom_{chrom.flow_name}",
                    chrom.flow_name,
                    chrom.target_url,
                    chrom.target_app,
                    chrom.fitness_score,
                    chrom.bug_catch_count,
                    chrom.false_positive_count,
                    chrom.run_count,
                    chrom.generation,
                    chrom.parent_flow_name,
                    chrom.mutation_type,
                    chrom.project,
                    json.dumps(chrom.steps),
                    datetime.now(timezone.utc).isoformat(),
                    datetime.now(timezone.utc).isoformat()
                )
            )
            conn.commit()
    except Exception as e:
        print(f"[Genome] Error saving chromosome: {e}", file=sys.stderr)

def evolve_generation(project: str = "default") -> List[str]:
    """Runs a complete generational evolution step (nightly target)."""
    chromosomes = load_chromosomes(project)
    if not chromosomes:
        return ["No chromosomes found to evolve."]

    # 1. Update fitness scores based on run database data
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            for chrom in chromosomes:
                # Fetch average test run duration
                cursor = conn.execute(
                    "SELECT AVG(duration_ms) as avg_dur FROM qa_test_runs WHERE flow_name = ? AND project = ?",
                    (chrom.flow_name, project)
                )
                r = cursor.fetchone()
                avg_dur = r["avg_dur"] if r and r["avg_dur"] else 5000.0
                
                chrom.fitness_score = calculate_fitness(
                    chrom.bug_catch_count,
                    chrom.false_positive_count,
                    chrom.run_count,
                    avg_dur
                )
                save_chromosome(chrom)
    except Exception as e:
        print(f"[Genome] Error updating fitness: {e}", file=sys.stderr)

    # 2. Separate elites and weak ones
    chromosomes.sort(key=lambda x: x.fitness_score, reverse=True)
    elites = [c for c in chromosomes if c.fitness_score >= 0.5]
    weaklings = [c for c in chromosomes if c.fitness_score < 0.2]

    # Delete weaklings from DB if they have been executed enough times (e.g. run_count > 3)
    deleted_flows = []
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            for w in weaklings:
                if w.run_count >= 3:
                    conn.execute("DELETE FROM qa_test_genome WHERE flow_name = ?", (w.flow_name,))
                    deleted_flows.append(w.flow_name)
            conn.commit()
    except Exception as e:
        print(f"[Genome] Error pruning weak chromosomes: {e}", file=sys.stderr)

    # 3. Breed new offspring from elites
    new_mutants = []
    if len(elites) >= 1:
        # Mutate the top elites
        for parent in elites[:5]:
            child = mutate(parent)
            save_chromosome(child)
            new_mutants.append(child.flow_name)
            
        # If we have at least 2 elites, perform crossovers
        if len(elites) >= 2:
            for i in range(min(3, len(elites) - 1)):
                parent_a = elites[i]
                parent_b = elites[i + 1]
                child = crossover(parent_a, parent_b)
                save_chromosome(child)
                new_mutants.append(child.flow_name)

    results = []
    if deleted_flows:
        results.append(f"Pruned {len(deleted_flows)} weak flows: {', '.join(deleted_flows[:3])}...")
    if new_mutants:
        results.append(f"Bred {len(new_mutants)} new mutations: {', '.join(new_mutants[:3])}...")
    return results or ["No evolution changes needed."]
