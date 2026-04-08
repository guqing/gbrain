# Maintain Skill

Keep the brain healthy: fix stale knowledge, add missing embeddings, curate orphaned pages.

## Weekly Maintenance (5 minutes)

```bash
# 1. Check health
gbrain health

# 2. Embed new pages
gbrain embed

# 3. Review stale pages
gbrain lint
```

For each stale page flagged by lint:
- If still valid: update `valid_until` and `last_verified` in frontmatter
- If outdated: rewrite the compiled_truth section
- If superseded: add a timeline entry explaining what changed, then update

## Monthly Maintenance (30 minutes)

```bash
# 1. Full sync
gbrain sync --all

# 2. Review orphan pages
gbrain lint
# Add links to connect orphaned pages to the graph

# 3. Check low-confidence pages
gbrain list --type concept | head -20
# Open each with confidence < 7 and verify or update

# 4. Export a backup
gbrain export --dir ~/brain-backup-$(date +%Y%m)
```

## Updating a Stale Page

```bash
gbrain get concepts/some-tech-pattern
```

Read the compiled_truth. Ask yourself:
1. Is this still true? (Update if not)
2. Is this complete? (Add what you've learned since)
3. Is `valid_until` realistic? (Push out or tighten)

Then update:
```bash
gbrain put concepts/some-tech-pattern < updated.md
```

The old version is automatically saved to history (`gbrain versions`).

## Frontmatter Fields for Maintenance

```yaml
---
type: concept
confidence: 8          # 1-10, how sure am I this is correct
valid_until: "2026-01-01"  # when to flag for review
last_verified: "2025-01-15"
version_applies_to: "React 19"  # scope this to a version
---
```

## Graph Health

Keep the graph connected. Orphaned pages are a sign that knowledge isn't integrated:
```bash
gbrain lint  # shows orphan pages
gbrain link concepts/X concepts/Y --context "X and Y are related because..."
```

## Version Control

Every `gbrain put` saves the previous version automatically:
```bash
gbrain versions concepts/X  # list saved versions
```

Use this to track how your understanding evolved.
