import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, UserRound, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useCommandPalette } from "@/context/CommandPaletteContext";
import { formatEnum } from "@/lib/constants";
import type { Card, CardHolder, PaginatedResponse } from "@/types";

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  const { data: cards } = useQuery({
    queryKey: ["search-cards", debounced],
    queryFn: async () => (await api.get<PaginatedResponse<Card>>("/cards", { params: { search: debounced, pageSize: 6 } })).data.data,
    enabled: isOpen && debounced.length > 0,
  });

  const { data: matchedHolders } = useQuery({
    queryKey: ["search-holders", debounced],
    queryFn: async () => (await api.get<CardHolder[]>("/holders", { params: { search: debounced, limit: 6 } })).data,
    enabled: isOpen && debounced.length > 0,
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" onClick={close}>
      <div className="card w-full max-w-lg overflow-hidden p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <Search size={16} className="text-slate-400" />
          <input
            autoFocus
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search cards or card holders..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700">Esc</kbd>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {debounced.length === 0 && <p className="p-4 text-sm text-slate-400">Start typing to search across your cards and card holders.</p>}

          {debounced.length > 0 && cards && cards.length > 0 && (
            <div className="py-2">
              <div className="px-4 py-1 text-xs font-semibold uppercase text-slate-400">Cards</div>
              {cards.map((c) => (
                <button
                  key={c.id}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => {
                    navigate(`/cards/${c.id}`);
                    close();
                  }}
                >
                  <CreditCard size={15} className="text-slate-400" />
                  <span className="font-mono">{c.uid}</span>
                  {c.label && <span className="text-slate-400">· {c.label}</span>}
                  <span className="ml-auto text-xs text-slate-400">{formatEnum(c.cardType)}</span>
                </button>
              ))}
            </div>
          )}

          {debounced.length > 0 && matchedHolders && matchedHolders.length > 0 && (
            <div className="border-t border-slate-100 py-2 dark:border-slate-800">
              <div className="px-4 py-1 text-xs font-semibold uppercase text-slate-400">Card Holders</div>
              {matchedHolders.map((h) => (
                <button
                  key={h.id}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => {
                    navigate(`/holders/${h.id}`);
                    close();
                  }}
                >
                  <UserRound size={15} className="text-slate-400" />
                  {h.fullName}
                  {h.department && <span className="text-slate-400">· {h.department}</span>}
                </button>
              ))}
            </div>
          )}

          {debounced.length > 0 && cards?.length === 0 && matchedHolders?.length === 0 && (
            <p className="p-4 text-sm text-slate-400">No matches for "{debounced}".</p>
          )}
        </div>
      </div>
    </div>
  );
}
