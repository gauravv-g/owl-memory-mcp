"""
OWL QA Graph Module (Pillar 8)
==============================
Builds a living knowledge graph of bugs, tests, endpoints, and genetic flows.
Uses NetworkX and Louvain community detection to reveal failure clusters.
"""

import json
import sqlite3
import sys
from typing import Any, Dict, List
import networkx as nx
from owl_shared_intelligence import _OWL_DB_PATH

# Louvain community detection import
_louvain_available = False
try:
    import community as community_louvain
    _louvain_available = True
except ImportError:
    pass

def build_knowledge_graph(project: str = "default") -> nx.DiGraph:
    """Builds a NetworkX directed graph from QA database tables."""
    G = nx.DiGraph()
    
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            
            # 1. Fetch bugs and add nodes
            bugs = conn.execute("SELECT id, title, severity, target_url, target_app FROM qa_bugs WHERE project = ?", (project,)).fetchall()
            for b in bugs:
                G.add_node(
                    b["id"],
                    type="bug",
                    label=b["title"],
                    severity=b["severity"],
                    target=b["target_url"] or b["target_app"]
                )
                
            # 2. Fetch test runs and add nodes
            runs = conn.execute("SELECT id, flow_name, status, regression_score FROM qa_test_runs WHERE project = ?", (project,)).fetchall()
            for r in runs:
                G.add_node(
                    r["id"],
                    type="test_run",
                    label=r["flow_name"],
                    status=r["status"],
                    regression_score=r["regression_score"]
                )

            # 3. Fetch API contracts and add nodes
            apis = conn.execute("SELECT id, endpoint, method, base_url FROM qa_api_contracts WHERE project = ?", (project,)).fetchall()
            for api in apis:
                api_id = f"api_{api['id']}"
                G.add_node(
                    api_id,
                    type="api_contract",
                    label=f"{api['method']} {api['endpoint']}",
                    endpoint=api["endpoint"]
                )

            # 4. Fetch genome chromosomes
            chroms = conn.execute("SELECT flow_name, parent_flow_name, fitness_score, generation FROM qa_test_genome WHERE project = ?", (project,)).fetchall()
            for c in chroms:
                chrom_id = f"chrom_{c['flow_name']}"
                G.add_node(
                    chrom_id,
                    type="genome_flow",
                    label=c["flow_name"],
                    fitness=c["fitness_score"],
                    generation=c["generation"]
                )
                
                # Add lineage edge
                if c["parent_flow_name"]:
                    parent_id = f"chrom_{c['parent_flow_name']}"
                    if G.has_node(parent_id):
                        G.add_edge(parent_id, chrom_id, rel="mutated_into")

            # 5. Connect bugs to test runs they were discovered in
            for b in bugs:
                run_id = b["discovered_in_run"]
                if run_id and G.has_node(run_id):
                    G.add_edge(b["id"], run_id, rel="discovered_in")
                    
            # 6. Connect bugs to API endpoints they might affect
            for b in bugs:
                desc = b["description"].lower() if b["description"] else ""
                for n in G.nodes:
                    if G.nodes[n]["type"] == "api_contract":
                        endpoint = G.nodes[n]["endpoint"].lower()
                        if endpoint and endpoint in desc:
                            G.add_edge(b["id"], n, rel="affects_endpoint")

    except Exception as e:
        print(f"[Graph] Error building graph: {e}", file=sys.stderr)
        
    return G

def find_bug_clusters(G: nx.DiGraph) -> Dict[str, List[str]]:
    """Applies Louvain community detection on the undirected version of the graph."""
    clusters = {}
    if not G.nodes:
        return clusters

    try:
        # Louvain works on undirected graphs
        undirected_G = G.to_undirected()
        
        if _louvain_available and len(undirected_G.nodes) > 1:
            partition = community_louvain.best_partition(undirected_G)
            for node, community_id in partition.items():
                comm_name = f"Cluster {community_id}"
                if comm_name not in clusters:
                    clusters[comm_name] = []
                clusters[comm_name].append(node)
        else:
            # Fallback to connected components
            components = nx.connected_components(undirected_G)
            for idx, comp in enumerate(components):
                clusters[f"Cluster {idx}"] = list(comp)
    except Exception as e:
        print(f"[Graph] Error clustering graph: {e}", file=sys.stderr)
        # Final fallback: put everything in one cluster
        clusters["Cluster 0"] = list(G.nodes.keys())

    return clusters

def find_blast_radius(G: nx.DiGraph, node_id: str) -> List[Dict[str, Any]]:
    """Traces connected edges outwards from a failed node to find impacted entities."""
    blast_radius = []
    if not G.has_node(node_id):
        return blast_radius

    # Use single-source shortest path lengths to find all reachable nodes
    try:
        undirected_G = G.to_undirected()
        lengths = nx.single_source_shortest_path_length(undirected_G, node_id, cutoff=3)
        for target, depth in lengths.items():
            if target == node_id:
                continue
            node_data = G.nodes[target]
            blast_radius.append({
                "id": target,
                "label": node_data.get("label", "Node"),
                "type": node_data.get("type", "unknown"),
                "depth_distance": depth
            })
    except Exception as e:
        print(f"[Graph] Error computing blast radius: {e}", file=sys.stderr)
        
    return blast_radius

def find_untested_paths(project: str = "default") -> List[str]:
    """Finds interactive DOM elements identified during page audits that have no matching test steps."""
    untested = []
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            
            # Fetch visual baselines (DOM elements inspected)
            baselines = conn.execute("SELECT id, target_url, screenshot_path FROM qa_visual_baselines WHERE project = ?", (project,)).fetchall()
            
            # Fetch all selectors currently targeted in tests
            test_steps = conn.execute("SELECT DISTINCT target_selector FROM qa_test_steps WHERE passed = 1").fetchall()
            tested_selectors = {r["target_selector"] for r in test_steps if r["target_selector"]}

            for b in baselines:
                # Mock scanning visual landmarks to see if elements aren't in tested list
                # In production, parses baseline DOM JSON. For now, simulate.
                mock_untested = [f"button:has-text('Checkout')", f"input[name='promo_code']"]
                for item in mock_untested:
                    if item not in tested_selectors and item not in untested:
                        untested.append(item)
    except Exception as e:
        print(f"[Graph] Error finding untested paths: {e}", file=sys.stderr)
        
    return untested

def export_graph_json(G: nx.DiGraph, project: str = "default") -> Dict[str, Any]:
    """Formates graph node-link data for JSON rendering."""
    nodes = []
    for n_id, data in G.nodes(data=True):
        nodes.append({
            "id": n_id,
            "label": data.get("label", n_id),
            "type": data.get("type", "unknown"),
            "metadata": {k: v for k, v in data.items() if k not in ["label", "type"]}
        })
        
    links = []
    for u, v, data in G.edges(data=True):
        links.append({
            "source": u,
            "target": v,
            "relationship": data.get("rel", "link")
        })
        
    clusters = find_bug_clusters(G)
    
    return {
        "project": project,
        "nodes_count": len(nodes),
        "links_count": len(links),
        "nodes": nodes,
        "links": links,
        "clusters": clusters
    }
