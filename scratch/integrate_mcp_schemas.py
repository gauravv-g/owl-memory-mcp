import asyncio
import json
import os
import sys

# Ensure workspace is on path
WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, WORKSPACE)

# Import the servers
import owl_qa_mcp
import creative_studio_mcp

def save_tool_schemas(server_name, list_tools_func, target_dir):
    print(f"Generating schemas for {server_name} under {target_dir}...")
    os.makedirs(target_dir, exist_ok=True)
    
    # Run the async list_tools function to get tools
    tools = asyncio.run(list_tools_func())
    
    for tool in tools:
        schema = {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.inputSchema
        }
        file_path = os.path.join(target_dir, f"{tool.name}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(schema, f, ensure_ascii=False)
        print(f"  Saved {tool.name}.json")

def update_mcp_config():
    config_path = r"C:\Users\shiva\.gemini\config\mcp_config.json"
    print(f"Updating configuration file: {config_path}...")
    
    if not os.path.exists(config_path):
        print(f"ERROR: {config_path} not found.")
        return
        
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
        
    mcp_servers = config.setdefault("mcpServers", {})
    
    # Update or add owl-qa
    mcp_servers["owl-qa"] = {
        "command": "npx",
        "args": [
            "-y",
            "mcp-remote",
            "http://localhost:3710/qa/sse"
        ]
    }
    
    # Update or add creative-studio
    mcp_servers["creative-studio"] = {
        "command": "npx",
        "args": [
            "-y",
            "mcp-remote",
            "http://localhost:3710/creative/sse"
        ]
    }
    
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print("mcp_config.json updated successfully!")

def main():
    # 1. Save schemas for owl-qa
    qa_dir = r"C:\Users\shiva\.gemini\antigravity\mcp\owl-qa"
    save_tool_schemas("owl-qa", owl_qa_mcp.list_tools, qa_dir)
    
    # 2. Save schemas for creative-studio
    creative_dir = r"C:\Users\shiva\.gemini\antigravity\mcp\creative-studio"
    save_tool_schemas("creative-studio", creative_studio_mcp.list_tools, creative_dir)
    
    # 3. Update mcp_config.json
    update_mcp_config()
    print("Integration complete!")

if __name__ == "__main__":
    main()
