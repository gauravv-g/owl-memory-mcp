import json
import os

def main():
    config_path = r"C:\Users\shiva\.gemini\config\mcp_config.json"
    print(f"Loading config from {config_path}...")
    
    if not os.path.exists(config_path):
        print(f"ERROR: {config_path} not found.")
        return
        
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
        
    mcp_servers = config.setdefault("mcpServers", {})
    
    # 1. Configure owl-memory (Node)
    mcp_servers["owl-memory"] = {
        "command": "node",
        "args": [
            "c:/Users/shiva/hermes-custom-mcps/owl_memory_v5.js"
        ]
    }
    
    # 2. Configure owl-web (Python)
    mcp_servers["owl-web"] = {
        "command": "python",
        "args": [
            "c:/Users/shiva/hermes-custom-mcps/owl_web_mcp.py"
        ]
    }
    
    # 3. Configure owl-research (Python)
    mcp_servers["owl-research"] = {
        "command": "python",
        "args": [
            "c:/Users/shiva/hermes-custom-mcps/owl_research_mcp.py"
        ]
    }
    
    # 4. Configure owl-qa (Python)
    mcp_servers["owl-qa"] = {
        "command": "python",
        "args": [
            "c:/Users/shiva/hermes-custom-mcps/owl_qa_mcp.py"
        ]
    }
    
    # 5. Configure creative-studio (Python)
    mcp_servers["creative-studio"] = {
        "command": "python",
        "args": [
            "c:/Users/shiva/hermes-custom-mcps/creative_studio_mcp.py"
        ]
    }
    
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print("mcp_config.json updated to direct stdio mode successfully!")

if __name__ == "__main__":
    main()
