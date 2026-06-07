# c:\Users\shiva\hermes-custom-mcps\owl_python_runner.py
"""
Bridge Runner to call Python MCP tools from Node.js runtime.
"""
import sys
import json
import asyncio

async def run_tool():
    try:
        input_data = json.loads(sys.stdin.read())
        tool_name = input_data.get("tool")
        arguments = input_data.get("arguments", {})
        
        if tool_name == "research":
            import owl_research_mcp
            # topic, depth, project, active_file
            topic = arguments.get("topic")
            depth = arguments.get("depth", "medium")
            project = arguments.get("project", "default")
            active_file = arguments.get("active_file", "")
            
            res = await owl_research_mcp._tool_research_deep({
                "topic": topic,
                "depth": depth,
                "project": project,
                "active_file": active_file,
                "extract_articles": True
            })
            print(res[0].text)
            
        elif tool_name == "fetch":
            import owl_web_mcp
            url = arguments.get("url")
            mode = arguments.get("mode", "static")
            
            if mode == "stealth":
                res = await owl_web_mcp.call_tool("web_fetch_stealthy", {"url": url})
            elif mode == "dynamic":
                res = await owl_web_mcp.call_tool("web_fetch_dynamic", {"url": url})
            else:
                res = await owl_web_mcp.call_tool("web_fetch", {"url": url})
            print(res[0].text)
            
        else:
            print(json.dumps({"error": f"Unknown tool: {tool_name}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(run_tool())
