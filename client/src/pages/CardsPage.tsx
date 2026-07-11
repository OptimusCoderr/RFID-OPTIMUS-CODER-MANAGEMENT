import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { CARD_STATUS_OPTIONS, CARD_TYPE_OPTIONS, formatEnum } from "@/lib/constants";
import type { Card, CardTemplate, CardType, PaginatedResponse } from "@/types";

interface RegisterFormState {
  uid: string;
  cardType: CardType;
  label: string;
  notes: string;
  templateId: string;
}

const EMPTY_FORM: RegisterFormState = { uid: "", cardType: "MIFARE_CLASSIC_1K", label: "", notes: "", templateId: "" };

export default function CardsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<RegisterFormState>(EMPTY_FORM);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [cardType, setCardType] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["cards", { page, status, cardType, search }],
    queryFn: async () =>
      (
        await api.get<PaginatedResponse<Card>>("/cards", {
          params: { page, pageSize: 20, status: status || undefined, cardType: cardType || undefined, search: search || undefined },
        })
      ).data,
    placeholderData: (prev) => prev,
  });

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<CardTemplate[]>("/templates")).data,
  });

  const registerCard = useMutation({
    mutationFn: async (payload: RegisterFormState) =>
      (
        await api.post("/cards", {
          ...payload,
          uid: payload.uid.trim().toUpperCase(),
          label: payload.label || undefined,
          notes: payload.notes || undefined,
          templateId: payload.templateId || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Card registered");
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setModalOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not register card")),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    registerCard.mutate(form);
  }

  const availableTemplates = templates?.filter((t) => t.cardType === form.cardType) ?? [];

  return (
    <div>
      <PageHeader
        title="Cards"
        description="Every MIFARE, NTAG, or generic RFID tag registered to your organization."
        actions={
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> Register card
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-56 pl-9"
            placeholder="Search UID or label..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="input w-44"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {CARD_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {formatEnum(s)}
            </option>
          ))}
        </select>
        <select
          className="input w-52"
          value={cardType}
          onChange={(e) => {
            setCardType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All card types</option>
          {CARD_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {formatEnum(t)}
            </option>
          ))}
        </select>
        {isFetching && <Spinner className="h-4 w-4" />}
      </div>

      {isLoading ? (
        <FullPageSpinner />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">UID</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Holder</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data?.data.map((card) => (
                <tr key={card.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <Link to={`/cards/${card.id}`} className="font-mono font-medium text-brand-600 hover:underline dark:text-brand-400">
                      {card.uid}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{card.label ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{formatEnum(card.cardType)}</td>
                  <td className="px-4 py-3 text-slate-500">{card.holder?.fullName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={card.status}>{formatEnum(card.status)}</Badge>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No cards match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
              <span className="text-slate-400">
                Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} cards)
              </span>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button
                  className="btn-secondary"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Register a card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">UID (hex)</label>
            <input
              className="input font-mono"
              required
              placeholder="04A1B2C3D4"
              value={form.uid}
              onChange={(e) => setForm((f) => ({ ...f, uid: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Card type</label>
            <select
              className="input"
              value={form.cardType}
              onChange={(e) => setForm((f) => ({ ...f, cardType: e.target.value as CardType, templateId: "" }))}
            >
              {CARD_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {formatEnum(t)}
                </option>
              ))}
            </select>
          </div>
          {availableTemplates.length > 0 && (
            <div>
              <label className="label">Template (optional)</label>
              <select className="input" value={form.templateId} onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}>
                <option value="">No template</option>
                {availableTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Label</label>
            <input className="input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={registerCard.isPending}>
            Register card
          </button>
        </form>
      </Modal>
    </div>
  );
}
