import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { Download, Upload, Lock, KeyRound, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { sendCommandAwait } from "@/lib/encoderCommand";
import { citizenRecordCapacityBytes, citizenRecordPlaintextBytes } from "@/lib/citizenRecord";
import { useAuth } from "@/context/AuthContext";
import type { Card, CardTemplate } from "@/types";

const DEFAULT_KEY = "FFFFFFFFFFFF";
// Matches KEY_MANAGER_ROLES in CardDetailPage.tsx — deleting citizen data is
// at least as sensitive as viewing/regenerating its encryption keys.
const DELETE_ROLES = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"]);

// Companion to CardDataPanel, for templates that configure an encrypted
// "citizen record" (national ID, employee PII, etc). Unlike CardDataPanel,
// which hex-encodes text locally in the browser, all encryption happens
// server-side — this panel only ever sees opaque per-block hex, never the
// plaintext-to-ciphertext mapping or the data key itself. Nothing here
// changes that boundary — the additions below (key-generation shortcut,
// capacity preview) only smooth out the steps around the encryption, never
// the encryption itself (still AES-256-GCM, server-side key, per card).
export function CitizenDataPanel({
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
  onCardUpdated?: (card: Card) => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canDelete = Boolean(user && DELETE_ROLES.has(user.role));
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"read" | "write" | "delete" | null>(null);

  const { data: template } = useQuery({
    queryKey: ["template", card.templateId],
    queryFn: async () => (await api.get<CardTemplate>(`/templates/${card.templateId}`)).data,
    enabled: Boolean(card.templateId),
  });

  const generateKeys = useMutation({
    mutationFn: async () => (await api.post(`/cards/${card.id}/keys/generate`)).data,
    onSuccess: () => {
      toast.success("Encryption keys generated for this card");
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      onCardUpdated?.({ ...card, hasStoredKeys: true });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not generate keys")),
  });

  const record = template?.layout.citizenRecord;

  const plaintextBytes = useMemo(() => {
    if (!record) return 0;
    const full = Object.fromEntries(record.fields.map((f) => [f, values[f] ?? ""]));
    return citizenRecordPlaintextBytes(full);
  }, [record, values]);
  const capacityBytes = record ? citizenRecordCapacityBytes(record.blocks.length) : 0;
  const overCapacity = plaintextBytes > capacityBytes;

  if (!record) return null;

  // `fieldsOverride` is used by the Delete flow below: it writes a freshly
  // re-encrypted blank record (every field "") rather than touching raw
  // bytes directly, so a card that's had its data deleted still reads back
  // as a valid, decryptable (just empty) record instead of "could not
  // decrypt" garbage.
  async function writeToCard(fieldsOverride?: Record<string, string>) {
    if (!socket) return;
    const isClear = Boolean(fieldsOverride);
    setBusy(isClear ? "delete" : "write");
    try {
      const { data } = await api.post<{ blocks: { sector: number; block: number; dataHex: string }[] }>(
        `/cards/${card.id}/citizen-data/prepare-write`,
        { fields: fieldsOverride ?? values }
      );

      const keys = (await api.get<{ keys: Record<string, string> | null }>(`/cards/${card.id}/keys`)).data.keys;

      for (const b of data.blocks) {
        const key = keys?.[`${b.sector}A`] ?? DEFAULT_KEY;
        const outcome = await sendCommandAwait(
          socket,
          encoderId,
          "WRITE_BLOCK",
          { block: b.block, data: b.dataHex, key, keyType: "A", clear: isClear },
          card.id
        );
        if (!outcome.success) throw new Error(outcome.error ?? `Failed writing block ${b.block}`);
      }
      if (isClear) {
        setValues({});
        toast.success("Citizen data deleted");
      } else {
        toast.success("Encrypted citizen data written to card");
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, isClear ? "Could not delete citizen data" : "Could not write citizen data"));
    } finally {
      setBusy(null);
    }
  }

  function deleteData() {
    if (!record) return;
    if (
      !confirm(
        `Delete all encrypted citizen data (${record.fields.length} field${record.fields.length === 1 ? "" : "s"})? This overwrites it with a blank encrypted record and cannot be undone.`
      )
    ) {
      return;
    }
    const blank = Object.fromEntries(record.fields.map((f) => [f, ""]));
    writeToCard(blank);
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
          <button
            type="button"
            className="btn-primary"
            disabled={disabled || Boolean(busy) || overCapacity || !card.hasStoredKeys}
            onClick={() => writeToCard()}
          >
            <Upload size={14} /> {busy === "write" ? "Encrypting..." : "Encrypt & write"}
          </button>
          {canDelete && (
            <button
              type="button"
              className="btn-danger"
              title="Overwrite the encrypted record with blank field values"
              disabled={disabled || Boolean(busy) || !card.hasStoredKeys}
              onClick={deleteData}
            >
              <Trash2 size={14} /> {busy === "delete" ? "Deleting..." : "Delete citizen data"}
            </button>
          )}
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-400">
        These fields are combined and encrypted on the server before anything is written — the encryption key never
        reaches this browser.
      </p>

      {!card.hasStoredKeys && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <span>
            {card.writeProtected
              ? "This card has no encryption key yet, and is write-protected — remove write protection before generating one."
              : "This card has no encryption key yet — generate one before writing citizen data."}
          </span>
          <button
            type="button"
            className="btn-secondary whitespace-nowrap"
            disabled={generateKeys.isPending || card.writeProtected}
            title={card.writeProtected ? "Remove write protection first" : undefined}
            onClick={() => generateKeys.mutate()}
          >
            <KeyRound size={13} /> {generateKeys.isPending ? "Generating..." : "Generate keys"}
          </button>
        </div>
      )}
      {card.hasStoredKeys && card.writeProtected && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          This card is write-protected — writes are blocked until write protection is removed from the card's detail
          page, even though its encryption key is already set up.
        </div>
      )}

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

      <p className={`mt-3 text-xs ${overCapacity ? "text-red-600" : "text-slate-400"}`}>
        {plaintextBytes} / {capacityBytes} bytes used
        {overCapacity && " — shorten the values above or add more blocks to this record's template"}
      </p>
    </div>
  );
}
