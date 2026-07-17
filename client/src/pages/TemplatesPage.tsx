import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { hasModule } from "@/lib/modules";
import { CARD_TYPE_OPTIONS, formatEnum, NATIONAL_ID_PRESET_FIELDS, PATIENT_ID_PRESET_FIELDS } from "@/lib/constants";
import { CITIZEN_RECORD_OVERHEAD_BYTES, estimateNeededBlocks, pickFreeCitizenBlocks } from "@/lib/citizenRecord";
import { INDUSTRY_PRESET_LABELS, TEMPLATE_PRESETS } from "@/lib/templatePresets";
import { mifareBlockIssue, nextFreeMifareBlock } from "@/lib/mifare";
import type {
  CardTemplate,
  CardType,
  CitizenRecordLayout,
  Company,
  DesfireApplicationLayout,
  DesfireFileLayout,
  DesfireFileType,
  MifareSectorLayout,
  NtagPageLayout,
} from "@/types";

const isMifareClassic = (t: CardType) => t.startsWith("MIFARE_CLASSIC");
const isPageBased = (t: CardType) => t.startsWith("NTAG") || t.startsWith("MIFARE_ULTRALIGHT");
const isDesfire = (t: CardType) => t.startsWith("MIFARE_DESFIRE");

const DESFIRE_FILE_TYPES: DesfireFileType[] = ["STANDARD_DATA", "BACKUP_DATA", "VALUE", "LINEAR_RECORD", "CYCLIC_RECORD"];

export default function TemplatesPage() {
  const { user } = useAuth();
  const citizenDataEnabled = hasModule(user, "CITIZEN_DATA");
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cardType, setCardType] = useState<CardType>("MIFARE_CLASSIC_1K");
  const [sectors, setSectors] = useState<MifareSectorLayout[]>([]);
  const [pages, setPages] = useState<NtagPageLayout[]>([]);
  const [applications, setApplications] = useState<DesfireApplicationLayout[]>([]);
  const [citizenFields, setCitizenFields] = useState<string[]>([]);
  const [citizenBlocks, setCitizenBlocks] = useState<{ sector: number; block: number }[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [presetId, setPresetId] = useState("");

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<CardTemplate[]>("/templates")).data,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Company[]>("/companies")).data,
    enabled: user?.role === "SUPER_ADMIN",
  });

  const createTemplate = useMutation({
    mutationFn: async () =>
      (
        await api.post("/templates", {
          name,
          cardType,
          description: description || undefined,
          isDefault,
          companyId: user?.role === "SUPER_ADMIN" ? companyId : undefined,
          layout: {
            sectors: isMifareClassic(cardType) ? sectors : undefined,
            pages: isPageBased(cardType) ? pages : undefined,
            applications: isDesfire(cardType) ? applications : undefined,
            citizenRecord:
              isMifareClassic(cardType) && citizenFields.length > 0 && citizenBlocks.length > 0
                ? { fields: citizenFields, blocks: citizenBlocks }
                : undefined,
          },
        })
      ).data,
    onSuccess: () => {
      toast.success("Template created");
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      resetForm();
      setModalOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create template")),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => api.delete(`/templates/${id}`),
    onSuccess: () => {
      toast.success("Template deleted");
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  function resetForm() {
    setName("");
    setDescription("");
    setCardType("MIFARE_CLASSIC_1K");
    setSectors([]);
    setPages([]);
    setApplications([]);
    setCitizenFields([]);
    setCitizenBlocks([]);
    setIsDefault(false);
    setCompanyId("");
    setPresetId("");
  }

  // Pre-fills the same editable fields below from a starter preset — nothing
  // about the result is locked, it's just a head start. Picking "Start from
  // scratch" clears the layout back to blank.
  function applyPreset(id: string) {
    setPresetId(id);
    const preset = TEMPLATE_PRESETS.find((p) => p.id === id);
    if (!preset) {
      setSectors([]);
      setPages([]);
      setApplications([]);
      setCitizenFields([]);
      setCitizenBlocks([]);
      return;
    }
    setName(preset.name);
    setDescription(preset.description);
    setCardType(preset.cardType);
    setSectors(preset.sectors ?? []);
    setPages(preset.pages ?? []);
    setApplications(preset.applications ?? []);
    if (preset.citizenFields) {
      setCitizenFields(preset.citizenFields);
      setCitizenBlocks(pickFreeCitizenBlocks(estimateNeededBlocks(preset.citizenFields), []));
    } else {
      setCitizenFields([]);
      setCitizenBlocks([]);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const plainBlocks = sectors.flatMap((s) => (s.blocks ?? []).map((b) => b.block));
    const encryptedBlocks = citizenBlocks.map((b) => b.block);
    const badBlock = [...plainBlocks, ...encryptedBlocks].find((block) => mifareBlockIssue(block) !== null);
    if (badBlock !== undefined) {
      toast.error(mifareBlockIssue(badBlock) ?? `Block ${badBlock} can't be written to`);
      return;
    }
    createTemplate.mutate();
  }

  if (isLoading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        title="Card Templates"
        description="Define the sector/key layout for MIFARE Classic or the page map for NTAG/Ultralight tags."
        actions={
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> New template
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates?.map((t) => (
          <div key={t.id} className="card p-5">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{t.name}</h3>
                <p className="text-xs text-slate-400">{formatEnum(t.cardType)}</p>
              </div>
              <button className="text-slate-400 hover:text-red-600" onClick={() => deleteTemplate.mutate(t.id)}>
                <Trash2 size={15} />
              </button>
            </div>
            {t.isDefault && <Badge tone="ACTIVE">Default for type</Badge>}
            {t.description && <p className="mt-2 text-sm text-slate-500">{t.description}</p>}
            {t.layout.sectors && (
              <p className="mt-3 text-xs text-slate-400">{t.layout.sectors.length} configured sector(s)</p>
            )}
            {t.layout.pages && <p className="mt-3 text-xs text-slate-400">{t.layout.pages.length} page range(s)</p>}
            {citizenDataEnabled && t.layout.citizenRecord && <CitizenRecordSummary record={t.layout.citizenRecord} />}
            {t.layout.applications && (
              <p className="mt-3 text-xs text-slate-400">
                {t.layout.applications.length} application(s),{" "}
                {t.layout.applications.reduce((sum, a) => sum + a.files.length, 0)} file(s)
              </p>
            )}
          </div>
        ))}
        {templates?.length === 0 && <p className="text-sm text-slate-400">No templates yet.</p>}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New card template" wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <label className="label">Start from a preset (optional)</label>
            <select className="input" value={presetId} onChange={(e) => applyPreset(e.target.value)}>
              <option value="">Start from scratch</option>
              {(Object.keys(INDUSTRY_PRESET_LABELS) as (keyof typeof INDUSTRY_PRESET_LABELS)[]).map((industry) => {
                const options = TEMPLATE_PRESETS.filter(
                  (p) => p.industry === industry && (!p.citizenFields || citizenDataEnabled)
                );
                if (options.length === 0) return null;
                return (
                  <optgroup key={industry} label={INDUSTRY_PRESET_LABELS[industry]}>
                    {options.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Fills in a name, card type, and a starting set of labeled blocks for a common use case — everything
              below stays fully editable, and you can always add, remove, or delete templates afterward.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Card type</label>
              <select className="input" value={cardType} onChange={(e) => setCardType(e.target.value as CardType)}>
                {CARD_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {formatEnum(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {user?.role === "SUPER_ADMIN" && (
            <div>
              <label className="label">Company</label>
              <select className="input" required value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="" disabled>
                  Select a company
                </option>
                {companies?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isMifareClassic(cardType) && (
            <SectorEditor sectors={sectors} setSectors={setSectors} />
          )}
          {isMifareClassic(cardType) && citizenDataEnabled && (
            <CitizenRecordEditor
              fields={citizenFields}
              setFields={setCitizenFields}
              blocks={citizenBlocks}
              setBlocks={setCitizenBlocks}
              plainSectors={sectors}
            />
          )}
          {isPageBased(cardType) && <PageEditor pages={pages} setPages={setPages} />}
          {isDesfire(cardType) && <ApplicationEditor applications={applications} setApplications={setApplications} />}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Make this the default template for {formatEnum(cardType)}
          </label>

          <button type="submit" className="btn-primary w-full" disabled={createTemplate.isPending}>
            Create template
          </button>
        </form>
      </Modal>
    </div>
  );
}

function CitizenRecordSummary({ record }: { record: CitizenRecordLayout }) {
  return (
    <p className="mt-3 text-xs text-slate-400">
      Encrypted record: {record.fields.join(", ")} ({record.blocks.length} block{record.blocks.length === 1 ? "" : "s"})
    </p>
  );
}

function SectorEditor({
  sectors,
  setSectors,
}: {
  sectors: MifareSectorLayout[];
  setSectors: (s: MifareSectorLayout[]) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">Sectors</label>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setSectors([...sectors, { sector: sectors.length, keyA: "FFFFFFFFFFFF" }])}
        >
          <Plus size={14} /> Add sector
        </button>
      </div>
      <div className="space-y-3">
        {sectors.map((s, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="input w-20"
                title="Sector number"
                value={s.sector}
                onChange={(e) => setSectors(sectors.map((row, idx) => (idx === i ? { ...row, sector: Number(e.target.value) } : row)))}
              />
              <input
                className="input font-mono"
                placeholder="Key A (hex)"
                value={s.keyA ?? ""}
                onChange={(e) => setSectors(sectors.map((row, idx) => (idx === i ? { ...row, keyA: e.target.value } : row)))}
              />
              <input
                className="input font-mono"
                placeholder="Key B (hex, optional)"
                value={s.keyB ?? ""}
                onChange={(e) => setSectors(sectors.map((row, idx) => (idx === i ? { ...row, keyB: e.target.value } : row)))}
              />
              <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setSectors(sectors.filter((_, idx) => idx !== i))}>
                <X size={16} />
              </button>
            </div>

            <BlockEditor
              sector={s.sector}
              blocks={s.blocks ?? []}
              setBlocks={(blocks) => setSectors(sectors.map((row, idx) => (idx === i ? { ...row, blocks } : row)))}
            />
          </div>
        ))}
        {sectors.length === 0 && <p className="text-xs text-slate-400">No sectors configured — factory default keys will be assumed.</p>}
      </div>
    </div>
  );
}

// Labels specific data blocks within a sector (e.g. block 4 = "Full name",
// the first data block of sector 1 — block numbers are absolute across the
// card, see client/src/lib/mifare.ts) so Live Encode's Card Data panel can
// show a plain-text field for it instead of requiring raw hex. Every
// sector's last block is a key/access-bits trailer, and block 0 is the
// card's manufacturer block — writing card data to either would corrupt the
// card, so both are flagged inline and rejected on submit.
function BlockEditor({
  sector,
  blocks,
  setBlocks,
}: {
  sector: number;
  blocks: { block: number; purpose: string }[];
  setBlocks: (b: { block: number; purpose: string }[]) => void;
}) {
  return (
    <div className="mt-2 ml-2 space-y-1.5 border-l border-slate-100 pl-3 dark:border-slate-800">
      {blocks.map((b, i) => {
        const issue = mifareBlockIssue(b.block);
        return (
          <div key={i}>
            <div className="flex items-center gap-2 text-sm">
              <input
                type="number"
                className={`input w-16 ${issue ? "border-red-400" : ""}`}
                title="Block number"
                value={b.block}
                onChange={(e) => setBlocks(blocks.map((row, idx) => (idx === i ? { ...row, block: Number(e.target.value) } : row)))}
              />
              <input
                className="input flex-1"
                placeholder="Purpose (e.g. Full name)"
                value={b.purpose}
                onChange={(e) => setBlocks(blocks.map((row, idx) => (idx === i ? { ...row, purpose: e.target.value } : row)))}
              />
              <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setBlocks(blocks.filter((_, idx) => idx !== i))}>
                <X size={14} />
              </button>
            </div>
            {issue && <p className="mt-1 text-xs text-red-600">{issue}</p>}
          </div>
        );
      })}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setBlocks([...blocks, { block: nextFreeMifareBlock(sector, blocks), purpose: "" }])}
      >
        <Plus size={12} /> Label a data block
      </button>
      {blocks.length === 0 && (
        <p className="text-xs text-slate-400">
          No labeled blocks yet — add one to let Live Encode read/write plain text here instead of raw hex.
        </p>
      )}
    </div>
  );
}

function CitizenRecordEditor({
  fields,
  setFields,
  blocks,
  setBlocks,
  plainSectors,
}: {
  fields: string[];
  setFields: (f: string[]) => void;
  blocks: { sector: number; block: number }[];
  setBlocks: (b: { sector: number; block: number }[]) => void;
  plainSectors: MifareSectorLayout[];
}) {
  const capacity = blocks.length * 16 - CITIZEN_RECORD_OVERHEAD_BYTES;

  // Picks free blocks for the given field set, avoiding anything already
  // claimed by the template's plain labeled blocks above. In append mode
  // (the standalone "Auto-fill blocks" button) it tops up the existing
  // block list rather than replacing it, so re-running it after adding one
  // more field doesn't reshuffle blocks already in use.
  function autoFillBlocksFor(fieldList: string[], appendMode: boolean) {
    const needed = estimateNeededBlocks(fieldList);
    const usedFromPlainSectors = plainSectors.flatMap((s) => (s.blocks ?? []).map((b) => ({ sector: s.sector, block: b.block })));
    const baseBlocks = appendMode ? blocks : [];
    const stillNeeded = Math.max(0, needed - baseBlocks.length);
    const picked = pickFreeCitizenBlocks(stillNeeded, [...usedFromPlainSectors, ...baseBlocks]);
    setBlocks([...baseBlocks, ...picked]);
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <label className="label mb-1">Encrypted citizen record (optional)</label>
      <p className="mb-3 text-xs text-slate-400">
        For national ID / citizen-info use cases: the fields below are combined, AES-256-GCM encrypted, and split
        across the blocks you list — the card only ever holds ciphertext, and the encryption key never leaves the
        server. Independent from the plain labeled blocks above.
      </p>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Fields</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              title="Fill in the standard National ID field set and pick blocks to fit it"
              onClick={() => {
                setFields(NATIONAL_ID_PRESET_FIELDS);
                autoFillBlocksFor(NATIONAL_ID_PRESET_FIELDS, false);
              }}
            >
              Load National ID preset
            </button>
            <button
              type="button"
              className="btn-secondary"
              title="Fill in a patient identification field set and pick blocks to fit it"
              onClick={() => {
                setFields(PATIENT_ID_PRESET_FIELDS);
                autoFillBlocksFor(PATIENT_ID_PRESET_FIELDS, false);
              }}
            >
              Load Patient ID preset
            </button>
            <button type="button" className="btn-secondary" onClick={() => setFields([...fields, ""])}>
              <Plus size={12} /> Add field
            </button>
          </div>
        </div>
        <p className="mb-1.5 text-xs text-amber-600">
          Neither preset includes fingerprint data — this platform talks to RFID/NFC encoders, not fingerprint
          scanners, so there's no hardware to capture or verify a print. Add it yourself only once you've integrated
          dedicated biometric hardware. The Patient ID preset is an identity/lookup card, not a full medical chart —
          keep clinical detail in a real EHR system, not on a card that can be lost or stolen.
        </p>
        <div className="space-y-1.5">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input flex-1"
                placeholder="e.g. Full name, National ID number, Date of birth"
                value={f}
                onChange={(e) => setFields(fields.map((row, idx) => (idx === i ? e.target.value : row)))}
              />
              <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setFields(fields.filter((_, idx) => idx !== i))}>
                <X size={14} />
              </button>
            </div>
          ))}
          {fields.length === 0 && <p className="text-xs text-slate-400">No fields yet.</p>}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Blocks (sector + block, in write order)</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              title="Pick enough free blocks to fit the fields above, without touching blocks already chosen"
              disabled={fields.length === 0}
              onClick={() => autoFillBlocksFor(fields, true)}
            >
              Auto-fill blocks
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const sector = 1; // sector 0 is skipped — it holds the card-wide manufacturer block
                setBlocks([...blocks, { sector, block: nextFreeMifareBlock(sector, blocks.filter((b) => b.sector === sector)) }]);
              }}
            >
              <Plus size={12} /> Add block
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          {blocks.map((b, i) => {
            const issue = mifareBlockIssue(b.block);
            return (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input w-24"
                    title="Sector"
                    placeholder="Sector"
                    value={b.sector}
                    onChange={(e) => setBlocks(blocks.map((row, idx) => (idx === i ? { ...row, sector: Number(e.target.value) } : row)))}
                  />
                  <input
                    type="number"
                    className={`input w-24 ${issue ? "border-red-400" : ""}`}
                    title="Block"
                    placeholder="Block"
                    value={b.block}
                    onChange={(e) => setBlocks(blocks.map((row, idx) => (idx === i ? { ...row, block: Number(e.target.value) } : row)))}
                  />
                  <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setBlocks(blocks.filter((_, idx) => idx !== i))}>
                    <X size={14} />
                  </button>
                </div>
                {issue && <p className="mt-1 text-xs text-red-600">{issue}</p>}
              </div>
            );
          })}
          {blocks.length === 0 && <p className="text-xs text-slate-400">No blocks yet — each block adds 16 bytes of card capacity.</p>}
        </div>
      </div>

      {blocks.length > 0 && (
        <p className={`mt-2 text-xs ${capacity < 20 ? "text-amber-600" : "text-slate-400"}`}>
          ~{Math.max(capacity, 0)} bytes usable for all fields combined (as compact JSON — keep values short; this
          is real MIFARE Classic block capacity, not a soft limit). Avoid block 3, 7, 11... within a 4-block sector —
          those are key trailers, and writing to them would corrupt the sector's own keys.
        </p>
      )}
    </div>
  );
}

function PageEditor({ pages, setPages }: { pages: NtagPageLayout[]; setPages: (p: NtagPageLayout[]) => void }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">Page ranges</label>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setPages([...pages, { startPage: 4, endPage: 6, purpose: "NDEF message" }])}
        >
          <Plus size={14} /> Add range
        </button>
      </div>
      <div className="space-y-2">
        {pages.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="number"
              className="input w-20"
              value={p.startPage}
              onChange={(e) => setPages(pages.map((row, idx) => (idx === i ? { ...row, startPage: Number(e.target.value) } : row)))}
            />
            <input
              type="number"
              className="input w-20"
              value={p.endPage}
              onChange={(e) => setPages(pages.map((row, idx) => (idx === i ? { ...row, endPage: Number(e.target.value) } : row)))}
            />
            <input
              className="input"
              placeholder="Purpose"
              value={p.purpose}
              onChange={(e) => setPages(pages.map((row, idx) => (idx === i ? { ...row, purpose: e.target.value } : row)))}
            />
            <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setPages(pages.filter((_, idx) => idx !== i))}>
              <X size={16} />
            </button>
          </div>
        ))}
        {pages.length === 0 && <p className="text-xs text-slate-400">No page ranges configured yet.</p>}
      </div>
    </div>
  );
}

const EMPTY_DESFIRE_FILE: DesfireFileLayout = { fileId: 1, type: "STANDARD_DATA", purpose: "", size: 32 };

function ApplicationEditor({
  applications,
  setApplications,
}: {
  applications: DesfireApplicationLayout[];
  setApplications: (a: DesfireApplicationLayout[]) => void;
}) {
  function updateApp(index: number, patch: Partial<DesfireApplicationLayout>) {
    setApplications(applications.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  function updateFile(appIndex: number, fileIndex: number, patch: Partial<DesfireFileLayout>) {
    setApplications(
      applications.map((a, i) =>
        i === appIndex ? { ...a, files: a.files.map((f, fi) => (fi === fileIndex ? { ...f, ...patch } : f)) } : a
      )
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">Applications (partitions)</label>
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            setApplications([
              ...applications,
              { aid: "F00001", name: "", keyCount: 1, keyType: "AES", files: [] },
            ])
          }
        >
          <Plus size={14} /> Add application
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Each application is an isolated partition (its own AID and keys) — e.g. one for building access, a
        separate one for a canteen wallet. Reads/writes use AES authentication and Plain communication mode.
      </p>
      <div className="space-y-3">
        {applications.map((app, appIndex) => (
          <div key={appIndex} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-2 flex items-center gap-2">
              <input
                className="input w-28 font-mono"
                placeholder="AID (hex)"
                value={app.aid}
                onChange={(e) => updateApp(appIndex, { aid: e.target.value })}
              />
              <input
                className="input flex-1"
                placeholder="Name (e.g. Building Access)"
                value={app.name ?? ""}
                onChange={(e) => updateApp(appIndex, { name: e.target.value })}
              />
              <input
                type="number"
                className="input w-20"
                min={1}
                max={14}
                title="Key count"
                value={app.keyCount}
                onChange={(e) => updateApp(appIndex, { keyCount: Number(e.target.value) })}
              />
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                onClick={() => setApplications(applications.filter((_, i) => i !== appIndex))}
              >
                <X size={16} />
              </button>
            </div>

            <div className="ml-2 space-y-2 border-l border-slate-100 pl-3 dark:border-slate-800">
              {app.files.map((file, fileIndex) => (
                <div key={fileIndex} className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="number"
                    className="input w-16"
                    min={0}
                    max={31}
                    title="File ID"
                    value={file.fileId}
                    onChange={(e) => updateFile(appIndex, fileIndex, { fileId: Number(e.target.value) })}
                  />
                  <select
                    className="input w-40"
                    value={file.type}
                    onChange={(e) => updateFile(appIndex, fileIndex, { type: e.target.value as DesfireFileType })}
                  >
                    {DESFIRE_FILE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {formatEnum(t)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input flex-1"
                    placeholder="Purpose"
                    value={file.purpose}
                    onChange={(e) => updateFile(appIndex, fileIndex, { purpose: e.target.value })}
                  />
                  {(file.type === "STANDARD_DATA" || file.type === "BACKUP_DATA") && (
                    <input
                      type="number"
                      className="input w-24"
                      placeholder="Size (bytes)"
                      value={file.size ?? ""}
                      onChange={(e) => updateFile(appIndex, fileIndex, { size: Number(e.target.value) })}
                    />
                  )}
                  {(file.type === "LINEAR_RECORD" || file.type === "CYCLIC_RECORD") && (
                    <>
                      <input
                        type="number"
                        className="input w-24"
                        placeholder="Record size"
                        value={file.recordSize ?? ""}
                        onChange={(e) => updateFile(appIndex, fileIndex, { recordSize: Number(e.target.value) })}
                      />
                      <input
                        type="number"
                        className="input w-24"
                        placeholder="Max records"
                        value={file.maxRecords ?? ""}
                        onChange={(e) => updateFile(appIndex, fileIndex, { maxRecords: Number(e.target.value) })}
                      />
                    </>
                  )}
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    onClick={() =>
                      updateApp(appIndex, { files: app.files.filter((_, i) => i !== fileIndex) })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  updateApp(appIndex, {
                    files: [...app.files, { ...EMPTY_DESFIRE_FILE, fileId: app.files.length }],
                  })
                }
              >
                <Plus size={12} /> Add file
              </button>
              {app.files.length === 0 && <p className="text-xs text-slate-400">No files in this application yet.</p>}
            </div>
          </div>
        ))}
        {applications.length === 0 && <p className="text-xs text-slate-400">No applications (partitions) configured yet.</p>}
      </div>
    </div>
  );
}
