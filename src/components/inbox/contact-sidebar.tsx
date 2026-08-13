"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Contact,
  Deal,
  ContactNote,
  Tag,
  Pipeline,
  PipelineStage,
} from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  X,
  CheckCircle2,
  Circle,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { DealForm } from "@/components/pipelines/deal-form";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
  contact: Contact | null;
}

type ContactTagRow = Tag & { contact_tag_id: string };

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<ContactTagRow[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Account-scoped lookups (loaded once per account switch)
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [allStages, setAllStages] = useState<PipelineStage[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [changingStage, setChangingStage] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingDealId, setDeletingDealId] = useState<string | null>(null);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  // Load account-scoped lookups once per account
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [tagsRes, pipelinesRes, stagesRes] = await Promise.all([
        supabase.from("tags").select("*").order("name"),
        supabase.from("pipelines").select("*").order("created_at"),
        supabase
          .from("pipeline_stages")
          .select("*")
          .order("position", { ascending: true }),
      ]);
      if (cancelled) return;
      setAllTags((tagsRes.data ?? []) as Tag[]);
      setPipelines((pipelinesRes.data ?? []) as Pipeline[]);
      setAllStages((stagesRes.data ?? []) as PipelineStage[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleToggleTag = useCallback(
    async (tag: Tag) => {
      if (!contact) return;
      const supabase = createClient();
      const existing = tags.find((t) => t.id === tag.id);
      if (existing) {
        const { error } = await supabase
          .from("contact_tags")
          .delete()
          .eq("id", existing.contact_tag_id);
        if (!error) setTags((prev) => prev.filter((t) => t.id !== tag.id));
      } else {
        const { data, error } = await supabase
          .from("contact_tags")
          .insert({ contact_id: contact.id, tag_id: tag.id })
          .select("id")
          .single();
        if (!error && data) {
          setTags((prev) => [
            ...prev,
            { ...tag, contact_tag_id: data.id as string },
          ]);
        }
      }
    },
    [contact, tags]
  );

  // The "active" deal: most recent open one (fallback to most recent).
  const activeDeal = useMemo(() => {
    if (deals.length === 0) return null;
    return deals.find((d) => (d.status ?? "open") === "open") ?? deals[0];
  }, [deals]);

  // Backfill: contacts that started chatting before the auto-prospect
  // hook shipped don't have a deal yet. Create one on the fly the first
  // time we open the sidebar for them so the funnel stays complete.
  //
  // The ref guards against double-fire: strict-mode remounts, the
  // `fetchContactData` refetch that briefly returns deals=[] mid-load,
  // and the effect's own re-run after setDeals — all of them would
  // otherwise queue a second insert before the first `deals` state
  // update lands. We only attempt one backfill per contact per session,
  // and re-query the DB inside the effect so we don't insert on top of
  // a deal that already exists but hadn't loaded into state yet.
  const backfillAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!contact || !accountId) return;
    if (deals.length > 0) return;
    if (pipelines.length === 0 || allStages.length === 0) return;
    if (backfillAttempted.current.has(contact.id)) return;
    backfillAttempted.current.add(contact.id);

    const pipelineId = pipelines[0].id;
    const firstStage = allStages
      .filter((s) => s.pipeline_id === pipelineId)
      .sort((a, b) => a.position - b.position)[0];
    if (!firstStage) return;

    let cancelled = false;
    (async () => {
      const supabase = createClient();

      // Authoritative existence check — state can lag behind reality.
      const { data: existing } = await supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .limit(1);
      if (cancelled) return;
      if (existing && existing.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDeals(existing as Deal[]);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
      const { data, error } = await supabase
        .from("deals")
        .insert({
          account_id: accountId,
          user_id: user.id,
          pipeline_id: pipelineId,
          stage_id: firstStage.id,
          contact_id: contact.id,
          title: contact.name || contact.phone || "Nuevo prospecto",
          value: 0,
          status: "open",
        })
        .select("*, stage:pipeline_stages(*)")
        .single();
      if (cancelled) return;
      if (!error && data) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDeals([data as Deal]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contact, accountId, deals, pipelines, allStages]);

  const activePipelineStages = useMemo(() => {
    if (!activeDeal) return [];
    return allStages
      .filter((s) => s.pipeline_id === activeDeal.pipeline_id)
      .sort((a, b) => a.position - b.position);
  }, [activeDeal, allStages]);

  const handleChangeStage = useCallback(
    async (stageId: string) => {
      if (!activeDeal || stageId === activeDeal.stage_id) return;
      setChangingStage(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: stageId })
        .eq("id", activeDeal.id);
      if (!error) {
        const nextStage = allStages.find((s) => s.id === stageId);
        setDeals((prev) =>
          prev.map((d) =>
            d.id === activeDeal.id
              ? { ...d, stage_id: stageId, stage: nextStage ?? d.stage }
              : d
          )
        );
      }
      setChangingStage(false);
    },
    [activeDeal, allStages]
  );

  const handleChangePipeline = useCallback(
    async (pipelineId: string) => {
      if (!activeDeal || pipelineId === activeDeal.pipeline_id) return;
      const firstStage = allStages
        .filter((s) => s.pipeline_id === pipelineId)
        .sort((a, b) => a.position - b.position)[0];
      if (!firstStage) return;
      setChangingStage(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("deals")
        .update({ pipeline_id: pipelineId, stage_id: firstStage.id })
        .eq("id", activeDeal.id);
      if (!error) {
        setDeals((prev) =>
          prev.map((d) =>
            d.id === activeDeal.id
              ? {
                  ...d,
                  pipeline_id: pipelineId,
                  stage_id: firstStage.id,
                  stage: firstStage,
                }
              : d,
          ),
        );
      }
      setChangingStage(false);
    },
    [activeDeal, allStages],
  );

  const handleDeleteDeal = useCallback(
    async (dealId: string) => {
      setDeletingDealId(dealId);
      const supabase = createClient();
      const { error } = await supabase.from("deals").delete().eq("id", dealId);
      setDeletingDealId(null);
      if (!error) {
        setDeals((prev) => prev.filter((d) => d.id !== dealId));
        setConfirmDeleteId(null);
      }
    },
    [],
  );

  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTags, tagQuery]);

  const defaultPipelineId = activeDeal?.pipeline_id ?? pipelines[0]?.id ?? "";
  const dealFormStages = useMemo(
    () =>
      allStages
        .filter((s) => s.pipeline_id === defaultPipelineId)
        .sort((a, b) => a.position - b.position),
    [allStages, defaultPipelineId]
  );

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">
          {tThread("selectConversation")}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Pipeline stage stepper */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" />
              {tSidebar("pipelineStage")}
            </div>
            {activeDeal && pipelines.length > 1 && (
              <select
                value={activeDeal.pipeline_id}
                onChange={(e) => handleChangePipeline(e.target.value)}
                disabled={changingStage}
                className="mt-2 h-8 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/50 disabled:opacity-60"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <div className="mt-2">
              {activeDeal && activePipelineStages.length > 0 ? (
                <ol className="relative ml-2">
                  {/* Vertical connector line — sits behind the circles */}
                  <span
                    aria-hidden
                    className="absolute left-[7px] top-3 bottom-3 w-px bg-border"
                  />
                  {activePipelineStages.map((stage) => {
                    const currentIndex = activePipelineStages.findIndex(
                      (s) => s.id === activeDeal.stage_id
                    );
                    const idx = activePipelineStages.findIndex(
                      (s) => s.id === stage.id
                    );
                    const isCurrent = stage.id === activeDeal.stage_id;
                    const isPast = idx < currentIndex;
                    return (
                      <li key={stage.id} className="relative">
                        <button
                          type="button"
                          onClick={() => handleChangeStage(stage.id)}
                          disabled={changingStage}
                          className="group flex w-full items-center gap-3 rounded-md py-1.5 pr-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-60"
                        >
                          <span className="relative z-10 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-card">
                            {isPast ? (
                              <CheckCircle2 className="h-[15px] w-[15px] fill-foreground text-background" />
                            ) : isCurrent ? (
                              <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full border-2 border-foreground">
                                <span className="h-[7px] w-[7px] rounded-full bg-foreground" />
                              </span>
                            ) : (
                              <span className="h-[13px] w-[13px] rounded-full border border-border bg-card" />
                            )}
                          </span>
                          <span
                            className={
                              isCurrent
                                ? "font-semibold text-foreground"
                                : isPast
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                            }
                          >
                            {stage.name}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noPipeline")}
                </p>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {tSidebar("tags")}
              </div>
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      aria-label={tSidebar("addTag")}
                      className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  }
                />
                <PopoverContent className="w-64 p-2">
                  <input
                    type="text"
                    value={tagQuery}
                    onChange={(e) => setTagQuery(e.target.value)}
                    placeholder={tSidebar("searchTags")}
                    className="mb-2 w-full rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                  />
                  <div className="max-h-56 space-y-0.5 overflow-y-auto">
                    {filteredTags.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        {tSidebar("noTagsAvailable")}
                      </p>
                    ) : (
                      filteredTags.map((tag) => {
                        const selected = tags.some((t) => t.id === tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => handleToggleTag(tag)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="flex-1 text-foreground">
                              {tag.name}
                            </span>
                            {selected && (
                              <Check className="h-3 w-3 text-primary" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noTags")}
                </p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => handleToggleTag(tag)}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Remove ${tag.name}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Deals */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                {tSidebar("deals")}
              </div>
              <button
                type="button"
                onClick={() => setDealFormOpen(true)}
                disabled={!defaultPipelineId}
                aria-label={tSidebar("addDeal")}
                className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noDeals")}
                </p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="group rounded-lg bg-muted px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex-1 text-sm font-medium text-foreground">
                        {deal.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(deal.id)}
                        aria-label="Delete deal"
                        className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                    {confirmDeleteId === deal.id && (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px]">
                        <span className="text-red-400">Eliminar deal?</span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deletingDealId === deal.id}
                            className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDeal(deal.id)}
                            disabled={deletingDealId === deal.id}
                            className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingDealId === deal.id ? "..." : "Eliminar"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {defaultPipelineId && (
        <DealForm
          open={dealFormOpen}
          onOpenChange={setDealFormOpen}
          pipelineId={defaultPipelineId}
          stages={dealFormStages}
          defaultContactId={contact.id}
          onSaved={fetchContactData}
        />
      )}
    </div>
  );
}
