import { Database } from "bun:sqlite";

// Extract [[wiki-link]] style refs from content
export function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
  return [...matches].map((m) => m[1]!.trim());
}

export function createLink(
  db: Database,
  fromSlug: string,
  toSlug: string,
  context = ""
): { ok: boolean; error?: string } {
  const from = db
    .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1")
    .get(fromSlug);
  if (!from) return { ok: false, error: `Page not found: ${fromSlug}` };

  const to = db
    .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1")
    .get(toSlug);
  if (!to) return { ok: false, error: `Page not found: ${toSlug}` };

  try {
    db.run(
      "INSERT OR IGNORE INTO links (from_page_id, to_page_id, context) VALUES (?,?,?)",
      [from.id, to.id, context]
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function removeLink(
  db: Database,
  fromSlug: string,
  toSlug: string
): boolean {
  const from = db
    .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1")
    .get(fromSlug);
  const to = db
    .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1")
    .get(toSlug);
  if (!from || !to) return false;

  db.run(
    "DELETE FROM links WHERE from_page_id = ? AND to_page_id = ?",
    [from.id, to.id]
  );
  return true;
}

export function getBacklinks(
  db: Database,
  slug: string
): { slug: string; context: string }[] {
  const page = db
    .query<{ id: number }, [string]>("SELECT id FROM pages WHERE slug = ? LIMIT 1")
    .get(slug);
  if (!page) return [];

  return db
    .query<{ slug: string; context: string }, [number]>(
      `SELECT p.slug, l.context
       FROM links l JOIN pages p ON l.from_page_id = p.id
       WHERE l.to_page_id = ?
       ORDER BY p.slug`
    )
    .all(page.id);
}
