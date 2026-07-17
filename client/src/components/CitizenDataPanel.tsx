import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { Download, Upload, Lock } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { sendCommandAwait } from "@/lib/encoderCommand";
import type { Card, CardTemplate } from "@/types";

const DEFAULT_KEY = "FFFFFFFFFFFF";

// Companion to CardDataPanel, for templates that configure an encrypted
// "citizen record" (national ID, employee PII, etc). Unlike CardDataPanel,
// which hex-encodes text locally in the browser, all encryption happens
// server-side — this panel only ever sees opaque per-block hex, never the
// plaintext-to-ciphertext mapping or the data key itself.
export function CitizenDataPanel({
  card,
  socket,
  encoderId,
  disabled,
}: {
  card: Card;
  socket: Socket | null;
  encoderId: string;
  disabled?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"read" | "write" | null>(null);

  const { data: template } = useQuery({
    queryKey: ["template", card.templateId],
    queryFn: async () => (await api.get<CardTemplate>(`/templates/${card.templateId}`)).data,
    enabled: Boolean(card.templateId),
  });

  const record = template?.layout.citizenRecord;
  if (!record) return null;

  async function writeToCard() {
    if (!socket) return;
    setBusy("write");
    try {
      const { data } = await api.post<{ blocks: { sector: number; block: number; dataHex: string }[] }>(
        `/cards/${card.id}/citizen-data/prepare-write`,
        { fields: values }
      );

      const keys = (await api.get<{ keys: Record<string, string> | null }>(`/cards/${card.id}/keys`)).data.keys;

      for (const b of data.blocks) {
        const key = keys?.[`${b.sector}A`] ?? DEFAULT_KEY;
        const outcome = await sendCommandAwait(
          socket,
          encoderId,
          "WRITE_BLOCK",
          { block: b.block, data: b.dataHex, key, keyType: "A" },
          card.id
        );
        if (!outcome.success) throw new Error(outcome.error ?? `Failed writing block ${b.block}`);
      }
      toast.success("Encrypted citizen data written to card");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not write citizen data"));
    } finally {
      setBusy(null);
    }
  }

  async function readFromCard() {
    if (!socket || !record) return;
    setBusy("read");
    try {
      const keys = (await api.get<{ keys: Record<string, string> | null }>(`/cards/${card.id}/keys`)).data.keys;

      const blocks: { block: number; dataHex: string }[] = [];
      for (const b of record.blocks) {
        const key = keys?.[`${b.sector}A`] ?? DEFAULT_KEY;
        const outcome = await sendCommandAwait(socket, encoderId, "READ_BLOCK", { block: b.block, key, keyType: "A" }, card.id);
        if (!outcome.success) throw new Error(outcome.error ?? `Failed reading block ${b.block}`);
        blocks.push({ block: b.block, dataHex: (outcome.data as { block: number; data: string }).data });
      }

      const { data } = await api.post<{ fields: Record<string, string> }>(`/cards/${card.id}/citizen-data/decode-read`, { blocks });
      setValues(data.fields);
      toast.success("Decrypted citizen data from card");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not read citizen data"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
          <Lock size={14} /> Encrypted citizen data
        </h3>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={disabled || Boolean(busy)} onClick={readFromCard}>
            <Download size={14} /> {busy === "read" ? "Reading..." : "Read from card"}
          </button>
          <button type="button" className="btn-primary" disabled={disabled || Boolean(busy)} onClick={writeToCard}>
            <Upload size={14} /> {busy === "write" ? "Encrypting..." : "Encrypt & write"}
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-400">
        These fields are combined and encrypted on the server before anything is written — the encryption key never
        reaches this browser.
      </p>

      <div className="space-y-3">
        {record.fields.map((field) => (
          <div key={field}>
            <label className="label">{field}</label>
            <input
              className="input"
              value={values[field] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
