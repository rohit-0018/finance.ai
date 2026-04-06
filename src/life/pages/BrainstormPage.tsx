// Brainstorm — the heart of Phase 2.
//
// Layout: two-column.
//   Left : chat transcript + phase chips + text input
//   Right: phase tracker + (once decomposition reached) editable plan table
//          + commit gate report + "Commit plan" button
//
// Flow:
//   1. /life/brainstorm (no id) → creates a new brainstorm row immediately
//      after the first user message (so we don't spam empty rows on visit).
//   2. Each user turn → runBrainstormTurn → persists user message, assistant
//      message, merges context_update into brainstorm, advances phase.
//   3. When the agent returns a draft_plan, we upsert a life_plans draft.
//   4. User edits the draft table in place (title, estimate, when_where,
//      start/due). Each edit updates local state; "Save draft" persists.
//   5. "Run commit gates" runs evaluateCommitGates. Blockers are rendered
//      in a list; user can't commit while any remain.
//   6. "Commit plan" runs commitBrainstorm → navigates to the new project.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  getBrainstorm,
  createBrainstorm,
  updateBrainstorm,
  listAgentMessages,
  saveAgentMessage,
  createPlanDraft,
  updatePlanSnapshot,
  listPlansForBrainstorm,
  listMemory,
  upsertMemory,
} from '../lib/db'
import { runBrainstormTurn } from '../lib/brainstormAgent'
import { evaluateCommitGates, type GateResult } from '../lib/commitGates'
import { commitBrainstorm } from '../lib/commitBrainstorm'
import type {
  LifeBrainstorm,
  LifeAgentMessage,
  LifePlan,
  PlanSnapshot,
  PlanSnapshotTask,
  BrainstormPhase,
} from '../types'

const PHASES: { id: BrainstormPhase; label: string; hint: string }[] = [
  { id: 'goal', label: 'Goal', hint: 'what does done look like?' },
  { id: 'constraints', label: 'Constraints', hint: 'deadline, people, risk' },
  { id: 'decomposition', label: 'Decomposition', hint: 'tasks + estimates' },
  { id: 'schedule', label: 'Schedule', hint: 'dates, intentions' },
  { id: 'review', label: 'Review', hint: 'commit gates' },
]

function emptyPlan(): PlanSnapshot {
  return {
    definition_of_done: '',
    milestones: [],
    tasks: [],
    risks: [],
    pre_mortem: { why_fail: '', smallest_version: '', first_cut: '' },
  }
}

const BrainstormPage: React.FC = () => {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const values = useLifeStore((s) => s.values)
  const horizons = useLifeStore((s) => s.horizons)
  const workspaces = useLifeStore((s) => s.workspaces)
  const mode = useLifeStore((s) => s.mode)

  const [brainstorm, setBrainstorm] = useState<LifeBrainstorm | null>(null)
  const [messages, setMessages] = useState<LifeAgentMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [planDraft, setPlanDraft] = useState<LifePlan | null>(null)
  const [snapshot, setSnapshot] = useState<PlanSnapshot>(emptyPlan())
  const [gateReport, setGateReport] = useState<{
    blockers: GateResult[]
    warnings: GateResult[]
  } | null>(null)
  const [committing, setCommitting] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Boot: load existing brainstorm if id present
  useEffect(() => {
    if (!lifeUser) return
    if (!id) {
      setBrainstorm(null)
      setMessages([])
      setPlanDraft(null)
      setSnapshot(emptyPlan())
      return
    }
    ;(async () => {
      const bs = await getBrainstorm(lifeUser.id, id)
      if (!bs) return
      setBrainstorm(bs)
      const msgs = await listAgentMessages(lifeUser.id, { brainstormId: id, limit: 100 })
      setMessages(msgs)
      const plans = await listPlansForBrainstorm(lifeUser.id, id)
      const draft = plans.find((p) => p.status === 'draft') ?? null
      setPlanDraft(draft)
      if (draft) setSnapshot(draft.snapshot)
    })().catch((e) => alert((e as Error).message))
  }, [id, lifeUser])

  // Scroll to bottom on new message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  const send = useCallback(async () => {
    if (!lifeUser || !activeWorkspace || !input.trim() || sending) return
    const text = input.trim()
    setSending(true)
    try {
      // Ensure a brainstorm row exists (create on first turn).
      let bs = brainstorm
      if (!bs) {
        bs = await createBrainstorm({
          userId: lifeUser.id,
          workspaceId: activeWorkspace.id,
          title: text.slice(0, 80),
        })
        setBrainstorm(bs)
        // Replace URL so refresh keeps the brainstorm id
        window.history.replaceState(null, '', `/life/brainstorm/${bs.id}`)
      }

      // Persist user turn
      const userMsg = await saveAgentMessage({
        userId: lifeUser.id,
        workspaceId: activeWorkspace.id,
        brainstormId: bs.id,
        role: 'user',
        content: text,
      })
      setMessages((m) => [...m, userMsg])
      setInput('')

      // Ask the agent
      const memory = await listMemory(lifeUser.id, activeWorkspace.id)
      const result = await runBrainstormTurn({
        user: lifeUser,
        workspace: activeWorkspace,
        workspaces,
        values,
        horizons,
        memory: memory.map((m) => ({
          key: m.key,
          value: m.value,
          workspace_id: m.workspace_id,
        })),
        mode,
        brainstorm: bs,
        history: messages,
        userMessage: text,
      })

      // Persist assistant turn
      const asstMsg = await saveAgentMessage({
        userId: lifeUser.id,
        workspaceId: activeWorkspace.id,
        brainstormId: bs.id,
        role: 'assistant',
        content: result.user_facing || '(no response)',
        meta: { next_phase: result.next_phase, context_update: result.context_update },
      })
      setMessages((m) => [...m, asstMsg])

      // Merge context + advance phase
      const mergedContext = { ...bs.context, ...(result.context_update ?? {}) }
      const nextBs: LifeBrainstorm = {
        ...bs,
        context: mergedContext,
        phase: result.next_phase,
      }
      await updateBrainstorm(lifeUser.id, bs.id, {
        context: mergedContext,
        phase: result.next_phase,
      })
      setBrainstorm(nextBs)

      // Persist any memory updates the agent extracted
      if (result.memory_updates && result.memory_updates.length > 0) {
        for (const m of result.memory_updates) {
          try {
            await upsertMemory({
              userId: lifeUser.id,
              workspaceId: m.workspace_scoped ? activeWorkspace.id : null,
              key: m.key,
              value: m.value,
              source: 'agent',
            })
          } catch {/* non-fatal */}
        }
      }

      // Upsert plan draft if the agent produced one
      if (result.draft_plan) {
        if (planDraft) {
          await updatePlanSnapshot(lifeUser.id, planDraft.id, result.draft_plan)
          setPlanDraft({ ...planDraft, snapshot: result.draft_plan })
        } else {
          const created = await createPlanDraft({
            userId: lifeUser.id,
            brainstormId: bs.id,
            snapshot: result.draft_plan,
          })
          setPlanDraft(created)
        }
        setSnapshot(result.draft_plan)
      }
    } catch (err) {
      alert(`Brainstorm turn failed: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }, [activeWorkspace, brainstorm, horizons, input, lifeUser, messages, planDraft, sending, values])

  const saveDraft = async () => {
    if (!lifeUser || !planDraft) return
    await updatePlanSnapshot(lifeUser.id, planDraft.id, snapshot)
    setPlanDraft({ ...planDraft, snapshot })
  }

  const runGates = async () => {
    if (!lifeUser || !brainstorm || !planDraft) return
    const result = await evaluateCommitGates({
      user: lifeUser,
      brainstorm,
      plan: { ...planDraft, snapshot },
      horizons,
      workspaces,
      values,
      mode,
      exploration: Boolean(brainstorm.context.exploration),
    })
    setGateReport({ blockers: result.blockers, warnings: result.warnings })
    setSnapshot(result.calibratedSnapshot)
  }

  const commit = async () => {
    if (!lifeUser || !brainstorm || !planDraft || committing) return
    setCommitting(true)
    try {
      const result = await evaluateCommitGates({
        user: lifeUser,
        brainstorm,
        plan: { ...planDraft, snapshot },
        horizons,
        workspaces,
        values,
        mode,
        exploration: Boolean(brainstorm.context.exploration),
      })
      if (result.blockers.length > 0) {
        setGateReport({ blockers: result.blockers, warnings: result.warnings })
        throw new Error('Commit gates failed. Fix blockers and retry.')
      }
      const { projectId } = await commitBrainstorm({
        user: lifeUser,
        brainstorm,
        plan: { ...planDraft, snapshot: result.calibratedSnapshot },
        snapshot: result.calibratedSnapshot,
        category: activeWorkspace?.kind === 'work' ? 'office' : 'personal',
      })
      navigate(`/life/projects/${projectId}`)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setCommitting(false)
    }
  }

  const phase = brainstorm?.phase ?? 'goal'

  return (
    <LifeLayout title={brainstorm?.title ? `Brainstorm · ${brainstorm.title}` : 'New brainstorm'}>
      <div className="life-brainstorm-grid">
        {/* LEFT: chat */}
        <section className="life-brainstorm-chat">
          <div className="phase-strip">
            {PHASES.map((p) => (
              <div
                key={p.id}
                className={`phase ${phase === p.id ? 'active' : ''} ${
                  PHASES.findIndex((x) => x.id === phase) > PHASES.findIndex((x) => x.id === p.id)
                    ? 'done'
                    : ''
                }`}
                title={p.hint}
              >
                <span className="dot" />
                <span>{p.label}</span>
              </div>
            ))}
          </div>

          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="life-empty-inline" style={{ padding: 24 }}>
                Start by typing the one thing you want to get done. The agent will
                interview you through goal → constraints → decomposition → schedule,
                then draft a committable plan.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-${m.role}`}>
                <div className="bubble">{m.content}</div>
              </div>
            ))}
            {sending && (
              <div className="chat-msg chat-assistant">
                <div className="bubble muted">thinking…</div>
              </div>
            )}
          </div>

          <div className="chat-input-row">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="say what you want to get done…"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
              }}
            />
            <button className="life-btn primary" onClick={send} disabled={sending || !input.trim()}>
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </section>

        {/* RIGHT: plan + gates */}
        <aside className="life-brainstorm-plan">
          {!planDraft ? (
            <div className="life-card">
              <h3>Plan draft</h3>
              <p className="life-empty-inline">
                The agent will draft a plan once you reach the decomposition phase.
                Keep talking on the left.
              </p>
            </div>
          ) : (
            <>
              <div className="life-card">
                <h3>Definition of done</h3>
                <textarea
                  value={snapshot.definition_of_done}
                  onChange={(e) =>
                    setSnapshot((s) => ({ ...s, definition_of_done: e.target.value }))
                  }
                  rows={2}
                  placeholder="single sentence — when is this project shipped?"
                />
              </div>

              <div className="life-card">
                <h3>Pre-mortem</h3>
                <PreMortemField
                  label="Why it will fail"
                  value={snapshot.pre_mortem.why_fail}
                  onChange={(v) =>
                    setSnapshot((s) => ({
                      ...s,
                      pre_mortem: { ...s.pre_mortem, why_fail: v },
                    }))
                  }
                />
                <PreMortemField
                  label="Smallest version that still counts"
                  value={snapshot.pre_mortem.smallest_version}
                  onChange={(v) =>
                    setSnapshot((s) => ({
                      ...s,
                      pre_mortem: { ...s.pre_mortem, smallest_version: v },
                    }))
                  }
                />
                <PreMortemField
                  label="First thing you'll cut"
                  value={snapshot.pre_mortem.first_cut}
                  onChange={(v) =>
                    setSnapshot((s) => ({
                      ...s,
                      pre_mortem: { ...s.pre_mortem, first_cut: v },
                    }))
                  }
                />
              </div>

              <div className="life-card">
                <h3>Tasks ({snapshot.tasks.length})</h3>
                <div className="plan-tasks">
                  {snapshot.tasks.map((t, i) => (
                    <PlanTaskRow
                      key={t.temp_id || i}
                      task={t}
                      onChange={(next) =>
                        setSnapshot((s) => {
                          const tasks = [...s.tasks]
                          tasks[i] = next
                          return { ...s, tasks }
                        })
                      }
                      onDelete={() =>
                        setSnapshot((s) => ({
                          ...s,
                          tasks: s.tasks.filter((_, j) => j !== i),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>

              {gateReport && (
                <div className="life-card">
                  <h3>Gate report</h3>
                  {gateReport.blockers.length === 0 && gateReport.warnings.length === 0 ? (
                    <p className="big">All gates clear. Ready to commit.</p>
                  ) : (
                    <>
                      {gateReport.blockers.map((g, i) => (
                        <div key={`b-${i}`} className="gate gate-block">
                          <strong>{g.gate}</strong> — {g.message}
                          {g.fix && <div className="life-empty-inline">{g.fix}</div>}
                        </div>
                      ))}
                      {gateReport.warnings.map((g, i) => (
                        <div key={`w-${i}`} className="gate gate-warn">
                          <strong>{g.gate}</strong> — {g.message}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="life-btn" onClick={saveDraft}>
                  Save draft
                </button>
                <button className="life-btn" onClick={runGates}>
                  Run gates
                </button>
                <button
                  className="life-btn primary"
                  onClick={commit}
                  disabled={committing || (gateReport?.blockers.length ?? 0) > 0}
                >
                  {committing ? 'Committing…' : 'Commit plan'}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </LifeLayout>
  )
}

const PreMortemField: React.FC<{
  label: string
  value: string
  onChange: (v: string) => void
}> = ({ label, value, onChange }) => (
  <div style={{ marginBottom: 6 }}>
    <div className="kicker">{label}</div>
    <textarea rows={1} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
)

const PlanTaskRow: React.FC<{
  task: PlanSnapshotTask
  onChange: (t: PlanSnapshotTask) => void
  onDelete: () => void
}> = ({ task, onChange, onDelete }) => (
  <div className="plan-task">
    <input
      value={task.title}
      onChange={(e) => onChange({ ...task, title: e.target.value })}
      placeholder="task title"
    />
    <div className="plan-task-meta">
      <input
        type="number"
        value={task.estimate_min ?? ''}
        onChange={(e) =>
          onChange({ ...task, estimate_min: e.target.value ? Number(e.target.value) : undefined })
        }
        placeholder="min"
        style={{ width: 70 }}
      />
      <select
        value={task.priority ?? 3}
        onChange={(e) => onChange({ ...task, priority: Number(e.target.value) })}
      >
        <option value={1}>P1</option>
        <option value={2}>P2</option>
        <option value={3}>P3</option>
        <option value={4}>P4</option>
        <option value={5}>P5</option>
      </select>
      <input
        type="datetime-local"
        value={task.start_at ? task.start_at.slice(0, 16) : ''}
        onChange={(e) =>
          onChange({ ...task, start_at: e.target.value ? new Date(e.target.value).toISOString() : undefined })
        }
      />
      <button className="plan-task-del" onClick={onDelete} title="Remove task">
        ×
      </button>
    </div>
    <input
      value={task.when_where ?? ''}
      onChange={(e) => onChange({ ...task, when_where: e.target.value })}
      placeholder="when / where (required for P1)"
    />
    <input
      value={task.first_action ?? ''}
      onChange={(e) => onChange({ ...task, first_action: e.target.value })}
      placeholder="first physical action"
    />
  </div>
)

export default BrainstormPage
