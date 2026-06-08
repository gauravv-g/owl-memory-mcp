import asyncio, json, os, sys, sqlite3, traceback, csv
from datetime import datetime, timezone

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

def _now():
    return datetime.now(timezone.utc).isoformat() + "Z"

def _connect(db):
    conn = sqlite3.connect(db, timeout=10)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.row_factory = sqlite3.Row
    return conn

async def handle_sql_execute(args):
    db = args.get("database",""); query = args.get("query",""); params = args.get("params",[])
    if not db: return {"error": "database path required"}
    try:
        conn = _connect(db); rows = conn.execute(query, params).fetchall()
        cols = [d[0] for d in rows[0].description] if rows else []
        data = [dict(zip(cols, row)) for row in rows[:1000]]
        conn.close()
        return {"columns": cols, "rows": data, "row_count": len(rows), "truncated": len(rows) > 1000}
    except Exception as e: return {"error": str(e)}

async def handle_sql_migrate(args):
    db = args.get("database",""); migrations = args.get("migrations",[])
    if not db: return {"error": "database path required"}
    try:
        conn = _connect(db)
        conn.execute("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT)")
        applied = {r[0] for r in conn.execute("SELECT id FROM _migrations").fetchall()}
        results = []
        for m in migrations:
            mid = m.get("id",""); sql = m.get("sql","")
            if mid in applied:
                results.append({"id": mid, "status": "skipped"})
                continue
            try:
                conn.executescript(sql)
                conn.execute("INSERT INTO _migrations VALUES (?,?)", (mid, _now()))
                conn.commit()
                results.append({"id": mid, "status": "applied"})
            except Exception as e:
                results.append({"id": mid, "status": "failed", "error": str(e)})
        conn.close()
        return {"results": results, "applied": sum(1 for r in results if r["status"]=="applied")}
    except Exception as e: return {"error": str(e)}

async def handle_schema_design(args):
    tables = args.get("tables",[]); dialect = args.get("dialect","sqlite")
    schemas = []
    for t in tables:
        name = t.get("name",""); columns = t.get("columns",[])
        col_defs = ["id INTEGER PRIMARY KEY AUTOINCREMENT"]
        for c in columns:
            cn = c.get("name",""); ct = c.get("type","TEXT"); cons = c.get("constraints","")
            col_defs.append(cn + " " + ct + " " + cons)
        col_defs.append("created_at TEXT")
        sql = "CREATE TABLE IF NOT EXISTS " + name + " ("
        sql += ", ".join(col_defs) + ");"
        schemas.append({"table": name, "sql": sql})
    return {"schemas": schemas}

async def handle_csv_import(args):
    db = args.get("database",""); table = args.get("table",""); csv_path = args.get("csv_file","")
    csv_path = os.path.abspath(csv_path)
    if not os.path.exists(csv_path): return {"error": "File not found: " + csv_path}
    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f); rows = list(reader)
    if not rows: return {"error": "CSV is empty"}
    cols = list(rows[0].keys())
    conn = _connect(db)
    col_defs = ", ".join([c + " TEXT" for c in cols])
    conn.execute("CREATE TABLE IF NOT EXISTS " + table + " (" + col_defs + ")")
    ph = ", ".join(["?"] * len(cols))
    for row in rows:
        conn.execute("INSERT INTO " + table + " VALUES (" + ph + ")", [row.get(c,"") for c in cols])
    conn.commit(); conn.close()
    return {"table": table, "rows_imported": len(rows), "columns": cols}

async def handle_csv_export(args):
    db = args.get("database",""); query = args.get("query",""); output = args.get("output","output.csv")
    try:
        conn = _connect(db); rows = conn.execute(query).fetchall(); conn.close()
        if not rows: return {"error": "Query returned no rows"}
        cols = [d[0] for d in rows[0].description]
        output = os.path.abspath(output)
        with open(output, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f); w.writerow(cols)
            for row in rows: w.writerow(list(row))
        return {"output": output, "rows": len(rows), "columns": cols}
    except Exception as e: return {"error": str(e)}

async def handle_db_inspect(args):
    db = args.get("database","")
    if not os.path.exists(db): return {"error": "Not found: " + db}
    conn = _connect(db)
    tables = conn.execute("SELECT name FROM sqlite_master WHERE type=\'table\'").fetchall()
    result = {"database": db, "tables": []}
    for t in tables:
        tname = t[0]
        cols = conn.execute("PRAGMA table_info(" + tname + ")").fetchall()
        count = conn.execute("SELECT COUNT(*) FROM " + tname).fetchone()[0]
        result["tables"].append({"name": tname, "columns": [{"name":c[1],"type":c[2]} for c in cols], "row_count": count})
    conn.close(); return result

async def handle_db_create(args):
    path = os.path.abspath(args.get("path",""))
    conn = _connect(path); conn.execute("SELECT 1"); conn.close()
    return {"created": path}

async def handle_etl_pipeline(args):
    src = args.get("source",""); dst = args.get("destination",""); tf = args.get("transform","")
    steps = ["Read from " + src, "Parse and validate rows"]
    if tf: steps.append("Apply transform: " + tf)
    else: steps.append("Apply default transforms")
    steps.append("Write to " + dst)
    steps.append("Validate row counts")
    return {"source": src, "destination": dst, "steps": steps}

server = Server("owl-data")

@server.list_tools()
async def list_tools():
    return [
        Tool(name="data_sql_execute",description="Execute SELECT query on SQLite database.",
            inputSchema={"type":"object","properties":{"database":{"type":"string"},"query":{"type":"string"},"params":{"type":"array","items":{}}},"required":["database","query"]}),
        Tool(name="data_sql_migrate",description="Run SQL migrations (DDL/DML).",
            inputSchema={"type":"object","properties":{"database":{"type":"string"},"migrations":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"sql":{"type":"string"}}}}},"required":["database","migrations"]}),
        Tool(name="data_schema_design",description="Generate CREATE TABLE SQL.",
            inputSchema={"type":"object","properties":{"tables":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"columns":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"type":{"type":"string"},"constraints":{"type":"string"}}}}}}},"dialect":{"type":"string","default":"sqlite"}},"required":["tables"]}),
        Tool(name="data_csv_import",description="Import CSV into SQLite table.",
            inputSchema={"type":"object","properties":{"database":{"type":"string"},"table":{"type":"string"},"csv_file":{"type":"string"}},"required":["database","table","csv_file"]}),
        Tool(name="data_csv_export",description="Export query results to CSV.",
            inputSchema={"type":"object","properties":{"database":{"type":"string"},"query":{"type":"string"},"output":{"type":"string","default":"output.csv"}},"required":["database","query"]}),
        Tool(name="data_db_inspect",description="Inspect database schema.",
            inputSchema={"type":"object","properties":{"database":{"type":"string"}},"required":["database"]}),
        Tool(name="data_db_create",description="Create new SQLite database.",
            inputSchema={"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
        Tool(name="data_etl_pipeline",description="Generate ETL pipeline plan.",
            inputSchema={"type":"object","properties":{"source":{"type":"string"},"destination":{"type":"string"},"transform":{"type":"string"}},"required":["source","destination"]}),
    ]

@server.call_tool()
async def call_tool(name, arguments):
    try:
        h = {"data_sql_execute":handle_sql_execute,"data_sql_migrate":handle_sql_migrate,
             "data_schema_design":handle_schema_design,"data_csv_import":handle_csv_import,
             "data_csv_export":handle_csv_export,"data_db_inspect":handle_db_inspect,
             "data_db_create":handle_db_create,"data_etl_pipeline":handle_etl_pipeline}
        r = await h[name](arguments)
        return [TextContent(type="text",text=json.dumps(r, ensure_ascii=False))]
    except Exception as e:
        return [TextContent(type="text",text=json.dumps({"error":str(e),"trace":traceback.format_exc()}))]

async def main():
    async with stdio_server() as (r,w):
        await server.run(r,w,server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
