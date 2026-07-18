import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, CreditCard, Send, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { CardDataPanel } from "@/components/CardDataPanel";
import { CitizenDataPanel } from "@/components/CitizenDataPanel";
import { useSocket } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";
import { hasModule } from "@/lib/modules";
import { CARD_TYPE_OPTIONS, formatEnum } from "@/lib/constants";
import type { Card, CardTemplate, CardType, DesfireFileType, Encoder, EncoderStatus, PaginatedResponse } from "@/types";

interface LogEntry {
  id: string;
  at: Date;
  message: string;
  tone?: "SUCCESS" | "FAILED" | "PENDING";
}

const COMMANDS = [
  { value: "READ_UID", label: "Read UID" },
  { value: "READ_BLOCK", label: "Read MIFARE Classic block" },
  { value: "WRITE_BLOCK", label: "Write MIFARE Classic block" },
  { value: "READ_NTAG", label: "Read NTAG page(s)" },
  { value: "WRITE_NTAG", label: "Write NTAG page" },
  { value: "LIST_APPLICATIONS", label: "DESFire: list applications" },
  { value: "SELECT_APPLICATION", label: "DESFire: select application" },
  { value: "AUTH_APPLICATION", label: "DESFire: authenticate (AES)" },
  { value: "READ_FILE", label: "DESFire: read file" },
  { value: "WRITE_FILE", label: "DESFire: write file" },
  { value: "CREATE_APPLICATION", label: "DESFire: create application (admin)" },
  { value: "CREATE_FILE", label: "DESFire: create file (admin)" },
  { value: "DELETE_FILE", label: "DESFire: delete file (admin)" },
  { value: "DELETE_APPLICATION", label: "DESFire: delete application (admin)" },
  { value: "FORMAT_PICC", label: "DESFire: format card (admin, destructive)" },
];

const DESTRUCTIVE_COMMANDS = new Set(["CREATE_APPLICATION", "DELETE_APPLICATION", "DELETE_FILE", "FORMAT_PICC"]);
const DESFIRE_FILE_TYPES: DesfireFileType[] = ["STANDARD_DATA", "BACKUP_DATA", "VALUE", "LINEAR_RECORD", "CYCLIC_RECORD"];

export default function LiveEncodePage() {
  const { socket, connected } = useSocket();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: encoders } = useQuery({
    queryKey: ["encoders"],
    queryFn: async () => (await api.get<Encoder[]>("/encoders")).data,
  });
  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<CardTemplate[]>("/templates")).data,
  });

  const [statusOverrides, setStatusOverrides] = useState<Record<string, EncoderStatus>>({});
  const [encoderId, setEncoderId] = useState("");
  const [detectedUid, setDetectedUid] = useState<string | null>(null);
  const [matchedCard, setMatchedCard] = useState<Card | null | undefined>(undefined);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [command, setCommand] = useState("READ_UID");
  const [block, setBlock] = useState(4);
  const [page, setPage] = useState(4);
  const [pageCount, setPageCount] = useState(1);
  const [key, setKey] = useState("FFFFFFFFFFFF");
  const [keyType, setKeyType] = useState<"A" | "B">("A");
  const [writeData, setWriteData] = useState("");

  const [regType, setRegType] = useState<CardType>("MIFARE_CLASSIC_1K");
  const [regLabel, setRegLabel] = useState("");
  const [regTemplateId, setRegTemplateId] = useState("");
  const registerableTemplates = templates?.filter((t) => t.cardType === regType) ?? [];

  // DESFire application/file partitioning
  const [aid, setAid] = useState("F00001");
  const [desfireKeyNo, setDesfireKeyNo] = useState(0);
  const [desfireKey, setDesfireKey] = useState("00000000000000000000000000000000");
  const [fileId, setFileId] = useState(1);
  const [fileOffset, setFileOffset] = useState(0);
  const [fileLength, setFileLength] = useState(0);
  const [fileWriteData, setFileWriteData] = useState("");
  const [createAppKeyCount, setCreateAppKeyCount] = useState(1);
  const [createFileType, setCreateFileType] = useState<DesfireFileType>("STANDARD_DATA");
  const [createFileSize, setCreateFileSize] = useState(32);
  const [createFileRecordSize, setCreateFileRecordSize] = useState(16);
  const [createFileMaxRecords, setCreateFileMaxRecords] = useState(10);

  useEffect(() => {
    if (!encoders || encoders.length === 0) return;
    if (!encoderId) setEncoderId(encoders[0].id);
  }, [encoders, encoderId]);

  function pushLog(message: string, tone?: LogEntry["tone"]) {
    setLogs((prev) => [{ id: crypto.randomUUID(), at: new Date(), message, tone }, ...prev].slice(0, 50));
  }

  useEffect(() => {
    if (!socket) return;

    function onStatus(payload: { encoderId: string; status: EncoderStatus }) {
      setStatusOverrides((prev) => ({ ...prev, [payload.encoderId]: payload.status }));
      queryClient.invalidateQueries({ queryKey: ["encoders"] });
    }

    function onCardDetected(payload: { encoderId: string; uid?: string; cardType?: string; atr?: string }) {
      if (payload.encoderId !== encoderId) return;
      if (!payload.uid) {
        pushLog("Card detected but the reader didn't report a UID — try tapping again", "FAILED");
        return;
      }
      setDetectedUid(payload.uid);
      pushLog(`Card detected: ${payload.uid}`, "SUCCESS");
      lookupCard(payload.uid);
    }

    function onCommandResult(payload: {
      encoderId: string;
      commandId: string;
      command: string;
      success: boolean;
      data?: unknown;
      error?: string;
    }) {
      if (payload.encoderId !== encoderId) return;
      if (payload.success) {
        pushLog(`${payload.command} succeeded: ${JSON.stringify(payload.data)}`, "SUCCESS");
      } else {
        pushLog(`${payload.command} failed: ${payload.error}`, "FAILED");
      }
    }

    socket.on("encoder:status", onStatus);
    socket.on("card:detected", onCardDetected);
    socket.on("encoder:commandResult", onCommandResult);
    return () => {
      socket.off("encoder:status", onStatus);
      socket.off("card:detected", onCardDetected);
      socket.off("encoder:commandResult", onCommandResult);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, encoderId]);

  async function lookupCard(uid: string) {
    setMatchedCard(undefined);
    try {
      const { data } = await api.get<PaginatedResponse<Card>>("/cards", { params: { search: uid, pageSize: 1 } });
      const match = data.data.find((c) => c.uid.toLowerCase() === uid.toLowerCase());
      setMatchedCard(match ?? null);
    } catch {
      setMatchedCard(null);
    }
  }

  const registerCard = useMutation({
    mutationFn: async () =>
      (
        await api.post<Card>("/cards", {
          uid: detectedUid,
          cardType: regType,
          label: regLabel || undefined,
          templateId: regTemplateId || undefined,
          registeredByEncoderId: encoderId,
        })
      ).data,
    onSuccess: (card) => {
      toast.success("Card registered");
      setMatchedCard(card);
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      // Clear the per-card label so it can't be silently reused on the next
      // tap — cardType/template stay selected since batches of cards (e.g.
      // a stack of employee badges) are usually all the same kind.
      setRegLabel("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not register card")),
  });

  const selectedEncoder = useMemo(() => encoders?.find((e) => e.id === encoderId), [encoders, encoderId]);
  const liveStatus = (selectedEncoder && statusOverrides[selectedEncoder.id]) ?? selectedEncoder?.status;

  // Mirrors the server's check (websocket/index.ts): a matching allocation
  // that's expired counts the same as no match — restricted, not allowed.
  const cardRestrictedToOtherEncoders = Boolean(
    matchedCard &&
      matchedCard.encoderAllocations &&
      matchedCard.encoderAllocations.length > 0 &&
      !matchedCard.encoderAllocations.some(
        (a) => a.encoder.id === encoderId && (!a.expiresAt || new Date(a.expiresAt) > new Date())
      )
  );

  const allowedEncoderNames = useMemo(
    () =>
      (matchedCard?.encoderAllocations ?? [])
        .filter((a) => !a.expiresAt || new Date(a.expiresAt) > new Date())
        .map((a) => a.encoder.name),
    [matchedCard]
  );

  function sendCommand(e: FormEvent) {
    e.preventDefault();
    if (!socket || !encoderId) return;

    if (DESTRUCTIVE_COMMANDS.has(command) && !confirm(`${command.replace(/_/g, " ")} cannot be undone. Continue?`)) {
      return;
    }

    let args: Record<string, unknown> = {};
    if (command === "READ_BLOCK") args = { block, key, keyType };
    if (command === "WRITE_BLOCK") args = { block, data: writeData, key, keyType };
    if (command === "READ_NTAG") args = { page, pageCount };
    if (command === "WRITE_NTAG") args = { page, data: writeData };
    if (command === "SELECT_APPLICATION") args = { aid };
    if (command === "AUTH_APPLICATION") args = { keyNo: desfireKeyNo, key: desfireKey };
    if (command === "READ_FILE") args = { fileId, offset: fileOffset, length: fileLength };
    if (command === "WRITE_FILE") args = { fileId, data: fileWriteData, offset: fileOffset };
    if (command === "CREATE_APPLICATION") args = { aid, keyCount: createAppKeyCount };
    if (command === "CREATE_FILE")
      args = {
        fileId,
        fileType: createFileType,
        size: createFileSize,
        recordSize: createFileRecordSize,
        maxRecords: createFileMaxRecords,
      };
    if (command === "DELETE_FILE") args = { fileId };
    if (command === "DELETE_APPLICATION") args = { aid };

    pushLog(`Sending ${command}...`, "PENDING");
    socket.emit(
      "encoder:command",
      { encoderId, command, args, cardId: matchedCard?.id },
      (res: { ok: boolean; error?: string }) => {
        if (!res.ok) pushLog(`${command} rejected: ${res.error}`, "FAILED");
      }
    );
  }

  return (
    <div>
      <PageHeader title="Live Encode" description="Trigger real-time read/write operations against a connected encoder." />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Encoder</h3>
          <select className="input mb-3" value={encoderId} onChange={(e) => setEncoderId(e.target.value)}>
            {encoders?.map((enc) => (
              <option key={enc.id} value={enc.id}>
                {enc.name}
                {enc.location ? ` (${enc.location})` : ""}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <Badge tone={liveStatus}>{liveStatus ?? "—"}</Badge>
            <span className="text-xs text-slate-400">{connected ? "Live updates connected" : "Connecting..."}</span>
          </div>
          {selectedEncoder?.accessZones && selectedEncoder.accessZones.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Installed in: {selectedEncoder.accessZones.map((g) => g.zone.name).join(", ")}
            </p>
          )}

          <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
            <Radio size={15} className={detectedUid ? "text-emerald-500" : "text-slate-300"} />
            {detectedUid ? `Card present: ${detectedUid}` : "Waiting for a card..."}
          </div>

          {detectedUid && matchedCard === null && (
            <div className="mt-4 space-y-2 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
              <p className="text-xs text-slate-500">Unknown card — register it:</p>
              <select
                className="input"
                value={regType}
                onChange={(e) => {
                  setRegType(e.target.value as CardType);
                  setRegTemplateId("");
                }}
              >
                {CARD_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {formatEnum(t)}
                  </option>
                ))}
              </select>
              {registerableTemplates.length > 0 && (
                <select className="input" value={regTemplateId} onChange={(e) => setRegTemplateId(e.target.value)}>
                  <option value="">No template</option>
                  {registerableTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.layout.citizenRecord ? " (encrypted record)" : ""}
                    </option>
                  ))}
                </select>
              )}
              <input className="input" placeholder="Label (optional)" value={regLabel} onChange={(e) => setRegLabel(e.target.value)} />
              <button className="btn-primary w-full" onClick={() => registerCard.mutate()} disabled={registerCard.isPending}>
                <CreditCard size={14} /> Register card
              </button>
              {registerableTemplates.length > 0 && !regTemplateId && (
                <p className="text-xs text-slate-400">
                  Pick a template to fill in data with a plain form after registering — you can also assign one later.
                </p>
              )}
            </div>
          )}

          {matchedCard && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-900/20">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{matchedCard.label ?? matchedCard.uid}</span>
                <Badge tone={matchedCard.status}>{matchedCard.status}</Badge>
              </div>
              {matchedCard.template && <p className="text-xs text-slate-500">Template: {matchedCard.template.name}</p>}
              {matchedCard.accessZones && matchedCard.accessZones.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Zone access: {matchedCard.accessZones.map((g) => g.zone.name).join(", ")}
                </p>
              )}
              <Link to={`/cards/${matchedCard.id}`} className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline dark:text-brand-400">
                Open card <ExternalLink size={12} />
              </Link>
            </div>
          )}

          {cardRestrictedToOtherEncoders && (
            <p className="mt-3 text-xs text-amber-600">
              This card is restricted to a different encoder — commands sent from here will be rejected.
              {allowedEncoderNames.length > 0 && <> Allowed: {allowedEncoderNames.join(", ")}.</>}
            </p>
          )}
        </div>

        <div className="lg:col-span-2">
          {matchedCard ? (
            <div className="space-y-6">
              <CardDataPanel
                card={matchedCard}
                socket={socket}
                encoderId={encoderId}
                disabled={liveStatus !== "ONLINE" || cardRestrictedToOtherEncoders}
                onCardUpdated={setMatchedCard}
              />
              {hasModule(user, "CITIZEN_DATA") && (
                <CitizenDataPanel
                  card={matchedCard}
                  socket={socket}
                  encoderId={encoderId}
                  disabled={liveStatus !== "ONLINE" || cardRestrictedToOtherEncoders}
                  onCardUpdated={setMatchedCard}
                />
              )}
            </div>
          ) : (
            <div className="card flex h-full min-h-[200px] items-center justify-center p-5 text-center">
              <p className="max-w-xs text-sm text-slate-400">
                {detectedUid
                  ? "Register the card using the form on the left, then fill in its data here as a plain form."
                  : "Tap a card on the selected encoder to start writing data to it."}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="card mb-6 p-5">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowAdvanced((s) => !s)}
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Advanced: raw commands</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Block numbers, hex keys, and DESFire application/file plumbing — most writing is easier with the
              template-based form above.
            </p>
          </div>
          {showAdvanced ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
        </button>

        {showAdvanced && (
          <form onSubmit={sendCommand} className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <select className="input" value={command} onChange={(e) => setCommand(e.target.value)}>
              {COMMANDS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            {(command === "READ_BLOCK" || command === "WRITE_BLOCK") && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Block</label>
                  <input type="number" className="input" value={block} onChange={(e) => setBlock(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Key (hex)</label>
                  <input className="input font-mono" value={key} onChange={(e) => setKey(e.target.value)} />
                </div>
                <div>
                  <label className="label">Key type</label>
                  <select className="input" value={keyType} onChange={(e) => setKeyType(e.target.value as "A" | "B")}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </select>
                </div>
              </div>
            )}

            {command === "WRITE_BLOCK" && (
              <div>
                <label className="label">Data (16 bytes hex)</label>
                <input className="input font-mono" value={writeData} onChange={(e) => setWriteData(e.target.value)} />
              </div>
            )}

            {(command === "READ_NTAG" || command === "WRITE_NTAG") && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Page</label>
                  <input type="number" className="input" value={page} onChange={(e) => setPage(Number(e.target.value))} />
                </div>
                {command === "READ_NTAG" && (
                  <div>
                    <label className="label">Page count</label>
                    <input type="number" className="input" value={pageCount} onChange={(e) => setPageCount(Number(e.target.value))} />
                  </div>
                )}
              </div>
            )}

            {command === "WRITE_NTAG" && (
              <div>
                <label className="label">Data (4 bytes hex)</label>
                <input className="input font-mono" value={writeData} onChange={(e) => setWriteData(e.target.value)} />
              </div>
            )}

            {(command === "SELECT_APPLICATION" || command === "CREATE_APPLICATION" || command === "DELETE_APPLICATION") && (
              <div>
                <label className="label">AID (3 bytes hex)</label>
                <input className="input font-mono" value={aid} onChange={(e) => setAid(e.target.value)} />
              </div>
            )}

            {command === "CREATE_APPLICATION" && (
              <div>
                <label className="label">Key count</label>
                <input
                  type="number"
                  min={1}
                  max={14}
                  className="input"
                  value={createAppKeyCount}
                  onChange={(e) => setCreateAppKeyCount(Number(e.target.value))}
                />
              </div>
            )}

            {command === "AUTH_APPLICATION" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Key index</label>
                  <input
                    type="number"
                    min={0}
                    max={13}
                    className="input"
                    value={desfireKeyNo}
                    onChange={(e) => setDesfireKeyNo(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">AES key (32 hex chars)</label>
                  <input className="input font-mono" value={desfireKey} onChange={(e) => setDesfireKey(e.target.value)} />
                </div>
              </div>
            )}

            {(command === "READ_FILE" || command === "WRITE_FILE" || command === "DELETE_FILE") && (
              <div>
                <label className="label">File ID</label>
                <input type="number" min={0} max={31} className="input" value={fileId} onChange={(e) => setFileId(Number(e.target.value))} />
              </div>
            )}

            {(command === "READ_FILE" || command === "WRITE_FILE") && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Offset (bytes)</label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={fileOffset}
                    onChange={(e) => setFileOffset(Number(e.target.value))}
                  />
                </div>
                {command === "READ_FILE" && (
                  <div>
                    <label className="label">Length (0 = all)</label>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={fileLength}
                      onChange={(e) => setFileLength(Number(e.target.value))}
                    />
                  </div>
                )}
              </div>
            )}

            {command === "WRITE_FILE" && (
              <div>
                <label className="label">Data (hex)</label>
                <input className="input font-mono" value={fileWriteData} onChange={(e) => setFileWriteData(e.target.value)} />
              </div>
            )}

            {command === "CREATE_FILE" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">File ID</label>
                    <input
                      type="number"
                      min={0}
                      max={31}
                      className="input"
                      value={fileId}
                      onChange={(e) => setFileId(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="label">File type</label>
                    <select className="input" value={createFileType} onChange={(e) => setCreateFileType(e.target.value as DesfireFileType)}>
                      {DESFIRE_FILE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {formatEnum(t)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {(createFileType === "STANDARD_DATA" || createFileType === "BACKUP_DATA" || createFileType === "VALUE") && (
                  <div>
                    <label className="label">Size (bytes)</label>
                    <input
                      type="number"
                      min={1}
                      className="input"
                      value={createFileSize}
                      onChange={(e) => setCreateFileSize(Number(e.target.value))}
                    />
                  </div>
                )}
                {(createFileType === "LINEAR_RECORD" || createFileType === "CYCLIC_RECORD") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Record size (bytes)</label>
                      <input
                        type="number"
                        min={1}
                        className="input"
                        value={createFileRecordSize}
                        onChange={(e) => setCreateFileRecordSize(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label className="label">Max records</label>
                      <input
                        type="number"
                        min={1}
                        className="input"
                        value={createFileMaxRecords}
                        onChange={(e) => setCreateFileMaxRecords(Number(e.target.value))}
                      />
                    </div>
                  </div>
                )}
                <p className="text-xs text-slate-400">
                  Created with Plain communication mode and access rights locked to the authenticating key — this
                  platform doesn't support MAC/Encrypted file communication.
                </p>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={liveStatus !== "ONLINE" || cardRestrictedToOtherEncoders}>
              <Send size={15} /> Send to encoder
            </button>
            {liveStatus !== "ONLINE" && <p className="text-xs text-amber-600">Encoder is offline — start its local agent to send commands.</p>}
            {liveStatus === "ONLINE" && cardRestrictedToOtherEncoders && (
              <p className="text-xs text-amber-600">This card isn't allocated to the selected encoder.</p>
            )}
          </form>
        )}
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Live event log</h3>
        <div className="space-y-1 font-mono text-xs">
          {logs.map((log) => (
            <div key={log.id} className="flex items-center gap-2">
              <span className="text-slate-400">{log.at.toLocaleTimeString()}</span>
              <span
                className={
                  log.tone === "SUCCESS"
                    ? "text-emerald-600"
                    : log.tone === "FAILED"
                    ? "text-red-600"
                    : "text-slate-500"
                }
              >
                {log.message}
              </span>
            </div>
          ))}
          {logs.length === 0 && <p className="text-slate-400">No events yet.</p>}
        </div>
      </div>
    </div>
  );
}
