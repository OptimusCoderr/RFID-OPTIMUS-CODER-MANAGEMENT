import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { formatKeyLabel } from "@/lib/mifare";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import type { Card } from "@/types";

const MIFARE_CLASSIC_TYPES = new Set(["MIFARE_CLASSIC_1K", "MIFARE_CLASSIC_4K", "MIFARE_CLASSIC_MINI"]);
// Matches KEY_MANAGER_ROLES in CardDetailPage.tsx — viewing/regenerating a
// card's key is at least as sensitive there as it is here.
const KEY_MANAGER_ROLES = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"]);

// Companion to CardDataPanel/CitizenDataPanel: both of those silently read
// whichever key is already stored for this card (or fall back to the
// factory default FFFFFFFFFFFF) with no indication of which is happening,
// and generating a fresh one previously meant leaving Live Encode for the
// card's detail page. This surfaces that choice right where the tap
// happens — keep using the key already on file, or generate a new one —
// before any read/write below it runs.
export function CardKeysPanel({ card, onCardUpdated }: { card: Card; onCardUpdated?: (card: Card) => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManageKeys = Boolean(user && KEY_MANAGER_ROLES.has(user.role));
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string> | null>(null);

  const viewKeys = useMutation({
    mutationFn: async () => (await api.get<{ keys: Record<string, string> | null }>(`/cards/${card.id}/keys`)).data.keys,
    onSuccess: (keys) => setRevealedKeys(keys ?? {}),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not load the stored key")),
  });

  const generateKeys = useMutation({
    mutationFn: async () => (await api.post<{ keys: Record<string, string> }>(`/cards/${card.id}/keys/generate`)).data.keys,
    onSuccess: (keys) => {
      setRevealedKeys(keys);
      toast.success("Generated a new key for this card");
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      onCardUpdated?.({ ...card, hasStoredKeys: true });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not generate a new key")),
  });

  if (!canManageKeys || !MIFARE_CLASSIC_TYPES.has(card.cardType)) return null;

  function handleGenerate() {
    const message = card.hasStoredKeys
      ? "This card already has a key on file. Generating a new one replaces it — every sector will need re-writing (and any encrypted citizen data re-encrypted) with the new key before this app can read/write this card again. Continue?"
      : "Generate a new random key for this card?";
    if (confirm(message)) generateKeys.mutate();
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
          <KeyRound size={14} /> Card key
        </h3>
        <Badge tone={card.hasStoredKeys ? "ACTIVE" : "PENDING"}>{card.hasStoredKeys ? "Key on file" : "Factory default"}</Badge>
      </div>

      {card.writeProtected && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          This card is write-protected — remove write protection on its detail page before generating a new key, or
          the app's stored key would no longer match what's actually on the physical card.
        </p>
      )}

      <p className="mb-3 text-xs text-slate-400">
        {card.hasStoredKeys
          ? "Reads and writes below already use the key on file automatically — no action needed to keep using it."
          : "No key has been generated for this card yet — reads and writes below fall back to the factory default (FFFFFFFFFFFF)."}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={!card.hasStoredKeys || viewKeys.isPending}
          title={card.hasStoredKeys ? undefined : "No key on file yet for this card"}
          onClick={() => viewKeys.mutate()}
        >
          <Eye size={14} /> {viewKeys.isPending ? "Loading..." : "Use previous key"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={generateKeys.isPending || card.writeProtected}
          title={card.writeProtected ? "Remove write protection first" : undefined}
          onClick={handleGenerate}
        >
          <KeyRound size={14} /> {generateKeys.isPending ? "Generating..." : "Generate new key"}
        </button>
      </div>

      {revealedKeys && (
        <div className="mt-3 rounded-lg border border-slate-100 p-3 font-mono text-xs dark:border-slate-800">
          {Object.keys(revealedKeys).length === 0 ? (
            <p className="text-slate-400">No keys stored yet.</p>
          ) : (
            Object.entries(revealedKeys).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-4 py-0.5">
                <span className="text-slate-400">{formatKeyLabel(name)}</span>
                <span>{value}</span>
              </div>
            ))
          )}
          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            onClick={() => setRevealedKeys(null)}
          >
            <EyeOff size={12} /> Hide
          </button>
        </div>
      )}
    </div>
  );
}
