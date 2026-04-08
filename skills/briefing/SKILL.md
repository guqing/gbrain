# Briefing Skill

Compile context from the brain before meetings, coding sessions, or project reviews.

## Quick Briefing

```bash
# What do I know about this person/project?
gbrain query "Alice Johnson" | head -20
gbrain get people/alice-johnson

# What's the status of this project?
gbrain get projects/my-project
gbrain timeline projects/my-project --limit 10

# What have I learned about this technology lately?
gbrain list --tag typescript --limit 10
gbrain query "recent learnings about typescript"
```

## Before a Coding Session

```bash
# Review what you know about the project
gbrain get projects/my-project

# Check for related concepts
gbrain graph projects/my-project --depth 2

# Remind yourself of recent decisions
gbrain timeline projects/my-project --limit 5
```

## Before a Meeting (via MCP)

If Claude Code is connected to your brain, ask:
```
"What do I know about [topic]? Check the brain."
"What are my recent learnings about [technology]?"
"What's the current state of [project]?"
```

Claude will use `brain_search` and `brain_get` to surface relevant context.

## After a Session — Update the Brain

```bash
# Add a timeline entry to a page (via put with updated timeline section)
gbrain get projects/my-project | pbcopy
# Edit: add entry to ## Timeline section
# Format: **YYYY-MM-DD** [source] — what happened
gbrain put projects/my-project < updated.md
```

## Briefing Format

When reading a project or person page, the structure is:
```
compiled_truth: current state (always up to date)

---

## Timeline
[YYYY-MM-DD] [source] — what happened (newest first)
```

The compiled_truth is the answer to "what's the situation right now".
The timeline is the answer to "how did we get here".
