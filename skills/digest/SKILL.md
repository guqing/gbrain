# Digest Skill

Extract structured knowledge from ChatGPT conversation exports.

## When to Use

When you have a ChatGPT export and want to pull useful learnings into your brain.
This works for learning conversations, research sessions, and problem-solving threads.

## How to Export from ChatGPT

1. Go to ChatGPT → Settings → Data Controls → Export Data
2. Wait for the email with your export zip
3. Unzip and find `conversations.json`

## Workflow

1. **Run digest** on your export:
   ```bash
   gbrain digest ~/Downloads/conversations.json
   ```
   By default, processes the 20 most recent conversations.
   To process all:
   ```bash
   gbrain digest --all ~/Downloads/conversations.json
   ```

2. **Review extracted pages**
   ```bash
   gbrain list --tag digested
   ```

3. **Curate** — same workflow as harvest:
   - Open each page: `gbrain get concepts/X`
   - Improve the compiled_truth
   - Link to related pages: `gbrain link`
   - Remove low-quality extractions: `gbrain delete`

4. **Embed for semantic search**
   ```bash
   gbrain embed
   ```

## What Gets Extracted

The digest command uses Claude Haiku to read each conversation and extract:
- **concepts/** — technical understanding gained
- **learnings/** — practical techniques demonstrated
- **sources/** — references to look up later

Already-digested conversations are skipped (idempotent based on conversation ID).

## Tips

- Run digest monthly as you accumulate ChatGPT conversations
- The best signal: conversations where you learned something surprising
- Delete pages that are too generic or obvious
- The brain is yours — curate aggressively
