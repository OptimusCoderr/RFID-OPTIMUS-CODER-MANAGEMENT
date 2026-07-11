import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { CARD_TYPE_OPTIONS, formatEnum } from "@/lib/constants";
import type { CardTemplate, CardType, MifareSectorLayout, NtagPageLayout } from "@/types";

const isMifareClassic = (t: CardType) => t.startsWith("MIFARE_CLASSIC");
const isPageBased = (t: CardType) => t.startsWith("NTAG") || t.startsWith("MIFARE_ULTRALIGHT");

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cardType, setCardType] = useState<CardType>("MIFARE_CLASSIC_1K");
  const [sectors, setSectors] = useState<MifareSectorLayout[]>([]);
  const [pages, setPages] = useState<NtagPageLayout[]>([]);
  const [isDefault, setIsDefault] = useState(false);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<CardTemplate[]>("/templates")).data,
  });

  const createTemplate = useMutation({
    mutationFn: async () =>
      (
        await api.post("/templates", {
          name,
          cardType,
          description: description || undefined,
          isDefault,
          layout: {
            sectors: isMifareClassic(cardType) ? sectors : undefined,
            pages: isPageBased(cardType) ? pages : undefined,
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
    setIsDefault(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
          </div>
        ))}
        {templates?.length === 0 && <p className="text-sm text-slate-400">No templates yet.</p>}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New card template" wide>
        <form onSubmit={handleSubmit} className="space-y-4">
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

          {isMifareClassic(cardType) && (
            <SectorEditor sectors={sectors} setSectors={setSectors} />
          )}
          {isPageBased(cardType) && <PageEditor pages={pages} setPages={setPages} />}

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
      <div className="space-y-2">
        {sectors.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="number"
              className="input w-20"
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
        ))}
        {sectors.length === 0 && <p className="text-xs text-slate-400">No sectors configured — factory default keys will be assumed.</p>}
      </div>
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
