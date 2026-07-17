import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { Download, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { textToHex, hexToText } from "@/lib/hex";
import { sendCommandAwait } from "@/lib/encoderCommand";
import type { Card, CardTemplate } from "@/types";

const MIFARE_BLOCK_BYTES = 16;
const DEFAULT_KEY = "FFFFFFFFFFFF";

interface DataBlock {
  block: number;
  sector: number;
  purpose: string;
}

type BlockState = "idle" | "pending" | "success" | "failed";

// Turns a card template's labeled MIFARE blocks (Templates page: sector ->
// blocks -> purpose, e.g. "Full Name", "Student ID") into a plain form:
// one text field per label, read/written across the card in one action
// using its stored per-sector key. This is what makes the platform usable
// as a business/university ID system — the operator fills in fields, not
// hex bytes, and never needs to know which physical block anything lives in.
export function CardDataPanel({
  card,
  socket,
  encoderId,
  disabled,
  onCardUpdated,
}: {
  card: Card;
  socket: Socket | null;
  encoderId: string;
  disabled?: boolean;
  // Template assignment below updates the card in place — the caller
  // typically holds its own copy of the matched card (from a live tap, not
  // a query), so it needs to be told about the change to re-render with it.
  onCardUpdated?: (card: Card) => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<Record<number, { state: BlockState; error?: string }>>({});
  const [busy, setBusy] = useState<"read" | "write" | null>(null);
  const [pickedTemplateId, setPickedTemplateId] = useState("");

  const { data: template } = useQuery({
    queryKey: ["template", card.templateId],
    queryFn: async () => (await api.get<CardTemplate>(`/templates/${card.templateId}`)).data,
    enabled: Boolean(card.templateId),
  });

  const { data: allTemplates } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<CardTemplate[]>("/templates")).data,
  });
  const assignableTemplates = allTemplates?.filter((t) => t.cardType === card.cardType) ?? [];

  const assignTemplate = useMutation({
    mutationFn: async () => (await api.patch<Card>(`/cards/${card.id}`, { templateId: pickedTemplateId })).data,
    onSuccess: (updated) => {
      toast.success("Template assigned");
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      onCardUpdated?.(updated);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not assign template")),
  });

  const blocks: DataBlock[] =
    template?.layout.sectors?.flatMap((s) =>
      (s.blocks ?? []).map((b) => ({ block: b.block, sector: s.sector, purpose: b.purpose }))
    ) ?? [];

  if (!card.templateId || blocks.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Card data</h3>
        <p className="mb-3 text-xs text-slate-400">
          {card.templateId
            ? "This card's template has no labeled data blocks, so there's nothing to fill in here. Add block purposes (e.g. \"Full Name\", \"ID Number\") to it on the Templates page."
            : "This card has no template, so there's nothing to fill in here yet. Assign one below to turn writing to this card into a plain form instead of raw hex."}
        </p>
        {assignableTemplates.length > 0 && (
          <div className="flex items-center gap-2">
            <select className="input" value={pickedTemplateId} onChange={(e) => setPickedTemplateId(e.target.value)}>
              <option value="">Select a template…</option>
              {assignableTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary whitespace-nowrap"
              disabled={!pickedTemplateId || assignTemplate.isPending}
              onClick={() => assignTemplate.mutate()}
            >
              Assign
            </button>
          </div>
        )}
      </div>
    );
  }

  async function runAll(direction: "read" | "write") {
    if (!socket) return;
    setBusy(direction);

    let keys: Record<string, string> | null = null;
    try {
      keys = (await api.get<{ keys: Record<string, string> | null }>(`/cards/${card.id}/keys`)).data.keys;
    } catch {
      // Fall through — MANAGER_UP-only endpoint; a VIEWER/OPERATOR simply
      // won't have stored keys available and falls back to the default below.
    }

    let failures = 0;

    for (const b of blocks) {
      setStatus((prev) => ({ ...prev, [b.block]: { state: "pending" } }));
      const key = keys?.[`${b.sector}A`] ?? DEFAULT_KEY;

      try {
        const outcome =
          direction === "read"
            ? await sendCommandAwait(socket, encoderId, "READ_BLOCK", { block: b.block, key, keyType: "A" }, card.id)
            : await sendCommandAwait(
                socket,
                encoderId,
                "WRITE_BLOCK",
                { block: b.block, data: textToHex(values[b.block] ?? "", MIFARE_BLOCK_BYTES), key, keyType: "A" },
                card.id
              );

        if (!outcome.success) {
          failures++;
          setStatus((prev) => ({ ...prev, [b.block]: { state: "failed", error: outcome.error } }));
          continue;
        }

        if (direction === "read") {
          const data = (outcome.data as { block: number; data: string }).data;
          setValues((prev) => ({ ...prev, [b.block]: hexToText(data) }));
        }
        setStatus((prev) => ({ ...prev, [b.block]: { state: "success" } }));
      } catch (err) {
        failures++;
        setStatus((prev) => ({
          ...prev,
          [b.block]: { state: "failed", error: err instanceof Error ? err.message : "Unknown error" },
        }));
      }
    }

    setBusy(null);
    const verb = direction === "read" ? "Read" : "Wrote";
    if (failures === 0) toast.success(`${verb} card data`);
    else if (failures === blocks.length) toast.error(`Failed to ${direction} any card data — see field errors below`);
    else toast.error(`${verb} ${blocks.length - failures}/${blocks.length} fields — ${failures} failed, see below`);
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Card data</h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled || Boolean(busy)}
            onClick={() => runAll("read")}
          >
            <Download size={14} /> {busy === "read" ? "Reading..." : "Read from card"}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={disabled || Boolean(busy)}
            onClick={() => runAll("write")}
          >
            <Upload size={14} /> {busy === "write" ? "Writing..." : "Write to card"}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {blocks.map((b) => (
          <div key={b.block}>
            <label className="label">
              {b.purpose} <span className="text-slate-400">(sector {b.sector}, block {b.block})</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                className="input"
                maxLength={MIFARE_BLOCK_BYTES}
                value={values[b.block] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [b.block]: e.target.value }))}
                placeholder={`Up to ${MIFARE_BLOCK_BYTES} characters`}
              />
              {status[b.block]?.state === "success" && <span className="text-xs text-emerald-600">OK</span>}
              {status[b.block]?.state === "pending" && <span className="text-xs text-slate-400">...</span>}
              {status[b.block]?.state === "failed" && (
                <span className="text-xs text-red-600" title={status[b.block]?.error}>
                  Failed
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
