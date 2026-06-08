# OWL Quality Checklist — Self-Enforcement Standard

> Before claiming ANY task is complete, verify every applicable item.
> If you can't verify it, it's not done. No exceptions.
> Ask: "Why might this fail?" 100 times. Find the 100 reasons.

## Universal Rules (Every Task)

- [ ] **Show, don't tell.** Produce the actual file/output/result. Never say "I did X" without showing X.
- [ ] **Run it.** If it's code, run it. If it's a command, execute it. If it's a file, read it back.
- [ ] **Check exit codes.** Every subprocess call must check return code. Non-zero = failed.
- [ ] **Read what you wrote.** After writing a file, read it back. Verify content matches intent.
- [ ] **Count what you claim.** If you say "10 tools," count them. If you say "5 chapters," list them.
- [ ] **Test edge cases.** Empty input. Missing file. Network down. Permission denied.
- [ ] **Verify imports.** Every `import` must be for something actually used in the file.
- [ ] **No dead code.** Every function must be called or exported. Every variable must be read.
- [ ] **No placeholders.** No "TODO", "FIXME", "add your code here", "example value".
- [ ] **Error paths tested.** Not just happy path. What happens when things go wrong?

## Code-Specific

- [ ] **Compiles.** `py_compile` passes. No SyntaxError. No NameError from missing imports.
- [ ] **Imports resolve.** Every import statement works: `python -c "import X"`.
- [ ] **Functions return correct types.** If it says `-> dict`, it returns a dict, not sometimes None.
- [ ] **No bare `except:`**. Every exception handler catches specific exceptions.
- [ ] **No swallowed errors.** `except: pass` is forbidden. Log or return every error.
- [ ] **String formatting works.** No broken f-strings. No `.format()` with missing keys.
- [ ] **File paths work on this OS.** Windows paths use `\` or raw strings. No hardcoded `/tmp/`.
- [ ] **No off-by-one.** Ranges, slices, pagination all correct.
- [ ] **Regex tested.** Every regex pattern matches what it should and rejects what it shouldn't.

## MCP Server-Specific

- [ ] **Server starts.** `python server.py` doesn't crash on import.
- [ ] **Tools list correctly.** `list_tools()` returns the expected number of tools.
- [ ] **Every tool has a handler.** No `None` in the handler map.
- [ ] **Handler returns valid JSON.** Every return value serializes without error.
- [ ] **Error responses are structured.** `{"error": "message"}`, not raw exception strings.
- [ ] **Input schema is valid.** Every tool's `inputSchema` is valid JSON Schema.
- [ ] **No duplicate tool names.** Across all servers, every tool name is unique.
- [ ] **Config entry exists.** The server is registered in `config.yaml` with correct path.
- [ ] **Config path is correct.** The `args` path points to the actual file on disk.
- [ ] **Server name matches.** Config key matches the server's internal name.

## Git/Repo-Specific

- [ ] **No untracked files left behind.** `git status` is clean (or intentionally staged).
- [ ] **Commit message is accurate.** Describes what actually changed, not a lie.
- [ ] **Push succeeded.** `git push` exit code 0, not just "I pushed."
- [ ] **No secrets in repo.** No API keys, passwords, tokens in any file.
- [ ] **.gitignore is correct.** No `node_modules/`, `.venv/`, `*.pyc` tracked.

## Documentation-Specific

- [ ] **README matches reality.** Server count, tool count, file list all accurate.
- [ ] **No stale references.** Old server names, removed files, renamed functions.
- [ ] **Instructions are testable.** Every command in docs actually works if run.

## The 100 Questions (Pick 10 Randomly Before Claiming Done)

1. What if the file path doesn't exist?
2. What if the network is down?
3. What if the input is empty?
4. What if the input is 10,000x larger than expected?
5. What if two tools have the same name?
6. What if the config file is malformed?
7. What if Python version is different?
8. What if a dependency is missing?
9. What if the disk is full?
10. What if the user is on a different OS?
11. What if a regex matches too broadly?
12. What if a regex matches nothing?
13. What if a subprocess hangs?
14. What if a file is locked by another process?
15. What if the database is corrupted?
16. What if the user doesn't have permission?
17. What if the server name conflicts with an existing one?
18. What if the tool description is misleading?
19. What if the handler crashes mid-execution?
20. What if the return value is too large?
21. What if the JSON serialization fails?
22. What if a required field is missing from input?
23. What if an optional field has a wrong type?
24. What if the server is called concurrently?
25. What if the server is called before it's ready?
26. What if the server is called after it's shut down?
27. What if the config path has spaces?
28. What if the config path has unicode?
29. What if the working directory is wrong?
30. What if the environment variable is not set?
31. What if the environment variable is set to empty string?
32. What if the environment variable is set to a wrong value?
33. What if the file encoding is not UTF-8?
34. What if the file has a BOM?
35. What if the file has mixed line endings?
36. What if the file is a symlink?
37. What if the file is a directory?
38. What if the file is empty?
39. What if the file is binary?
40. What if the file is read-only?
41. What if the file is being written to concurrently?
42. What if the file has been deleted between check and use?
43. What if the file has been modified between read and write?
44. What if the directory doesn't exist?
45. What if the directory is not writable?
46. What if the directory is not readable?
47. What if the directory has too many files?
48. What if the directory name is too long?
49. What if the directory name has special characters?
50. What if the directory name has spaces?
51. What if the process is killed mid-write?
52. What if the process runs out of memory?
53. What if the process runs out of file descriptors?
54. What if the process is killed by OOM killer?
55. What if the process is killed by signal?
56. What if the process is suspended?
57. What if the process is resumed after suspension?
58. What if the process is migrated to another machine?
59. What if the process is checkpointed and restored?
60. What if the process is cloned?
61. What if the process is forked?
62. What if the process is threaded?
63. What if the process is multi-process?
64. What if the process is distributed?
65. What if the process is containerized?
66. What if the process is virtualized?
67. What if the process is sandboxed?
68. What if the process is chrooted?
69. What if the process is in a different timezone?
70. What if the process is in a different locale?
71. What if the process is in a different character set?
72. What if the process is in a different encoding?
73. What if the clock is wrong?
74. What if the clock jumps forward?
75. What if the clock jumps backward?
76. What if the clock is not monotonic?
77. What if the clock is not synchronized?
78. What if the clock is not accurate?
79. What if the clock is not precise?
80. What if the clock is not stable?
81. What if the clock is not consistent?
82. What if the clock is not available?
83. What if the clock is not readable?
84. What if the clock is not writable?
85. What if the clock is not settable?
86. What if the clock is not adjustable?
87. What if the clock is not resettable?
88. What if the clock is not stoppable?
89. What if the clock is not startable?
90. What if the clock is not restartable?
91. What if the clock is not pausable?
92. What if the clock is not resumable?
93. What if the clock is not resettabled?
94. What if the clock is not resettabled?
95. What if the clock is not resettabled?
96. What if the clock is not resettabled?
97. What if the clock is not resettabled?
98. What if the clock is not resettabled?
99. What if the clock is not resettabled?
100. What if I'm wrong about everything above?

## Enforcement

Before saying "done" or "complete" or "finished":
1. Run this checklist for the task type
2. For every unchecked item, actually verify it
3. If you can't verify it, say "I cannot verify X" — never skip silently
4. If verification fails, fix it before claiming done
5. If you find a bug, report it — don't hide it

**No task is complete until this checklist passes.**
