import { useEffect, useState } from "react";
import type { Section, SearchScope } from "../types";
import { parseSection, parseSearchScope, buildUrl } from "../lib/url";

export function useUrlSync() {
  const initialParams = new URLSearchParams(window.location.search);

  const [section, setSection] = useState<Section>(parseSection(initialParams.get("section")));
  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [searchScope, setSearchScope] = useState<SearchScope>(parseSearchScope(initialParams.get("scope")));
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(initialParams.get("slug"));
  const [selectedReaderSlug, setSelectedReaderSlug] = useState<string | null>(initialParams.get("slug"));

  // Sync URL → state on browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setSection(parseSection(params.get("section")));
      setQuery(params.get("q") ?? "");
      setSearchScope(parseSearchScope(params.get("scope")));
      setSelectedItemKey(params.get("slug"));
      setSelectedReaderSlug(params.get("slug"));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Sync state → URL
  useEffect(() => {
    window.history.replaceState(null, "", buildUrl(section, selectedReaderSlug, query, searchScope));
  }, [query, searchScope, section, selectedReaderSlug]);

  return {
    section, setSection,
    query, setQuery,
    searchScope, setSearchScope,
    selectedItemKey, setSelectedItemKey,
    selectedReaderSlug, setSelectedReaderSlug,
  };
}
