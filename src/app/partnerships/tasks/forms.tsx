"use client";

import { useActionState } from "react";

import { FormField, FormMessage } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { fieldClasses, Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { initialFormState } from "@/lib/forms";
import { TASK_POINTS_MAX, TASK_POINTS_MIN } from "@/modules/rewards/rules";
import { POINTS_TASK_CATEGORIES, POINTS_TASK_CATEGORY_LABELS } from "@/modules/rewards/tasks-domain";

import { completeTaskAction, decideTaskAction, proposeTaskAction, retireTaskAction } from "./actions";

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function ProposeTaskForm() {
  const [state, action] = useActionState(proposeTaskAction, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <FormField
        id="title"
        label="Title"
        description="What the creator does, e.g. “Join a creator community meetup”."
        required
      >
        {(a11y) => <Input {...a11y} name="title" maxLength={80} defaultValue={text(v.title)} autoComplete="off" />}
      </FormField>
      <FormField
        id="description"
        label="How it's checked"
        description="What the creator does and how the team confirms it (10–400 characters)."
        required
      >
        {(a11y) => (
          <textarea
            {...a11y}
            name="description"
            rows={3}
            maxLength={400}
            defaultValue={text(v.description)}
            className={cn(fieldClasses, "h-auto py-3")}
          />
        )}
      </FormField>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField id="category" label="Category" required>
          {(a11y) => (
            <NativeSelect {...a11y} name="category" defaultValue={text(v.category) || "community"}>
              {POINTS_TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {POINTS_TASK_CATEGORY_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="points" label="Points" description={`${TASK_POINTS_MIN}–${TASK_POINTS_MAX}.`} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="points"
              inputMode="numeric"
              defaultValue={text(v.points) || "100"}
              className="sm:max-w-xs"
            />
          )}
        </FormField>
      </div>
      <p className="text-footnote text-ink-subtle">
        Tasks can&apos;t reward giving consent, sharing data, bank data or anything credit-related. Another partnerships
        admin approves the task before creators see it.
      </p>
      <div>
        <SubmitButton pendingLabel="Saving…">Propose task</SubmitButton>
      </div>
    </form>
  );
}

export function DecideTaskForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(decideTaskAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="taskId" value={taskId} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton name="decision" value="approve" pendingLabel="Saving…">
          Approve and publish
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="secondary" pendingLabel="Saving…">
          Reject
        </SubmitButton>
      </div>
    </form>
  );
}

export function RetireTaskForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(retireTaskAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="taskId" value={taskId} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Retiring…">
          Retire task
        </SubmitButton>
      </div>
      <p className="text-footnote text-ink-subtle">
        Creators keep the points they earned; no one can complete it after.
      </p>
    </form>
  );
}

export function CompleteTaskForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(completeTaskAction, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="taskId" value={taskId} />
      <FormField id="handle" label="Creator's handle" description="Their primary handle, e.g. @aarohi.makes." required>
        {(a11y) => (
          <Input {...a11y} name="handle" defaultValue={text(v.handle)} autoComplete="off" className="sm:max-w-sm" />
        )}
      </FormField>
      <FormField
        id="note"
        label="How you checked it"
        description="Short, and no personal identifiers (numbers, e-mail addresses, phone numbers)."
      >
        {(a11y) => <Input {...a11y} name="note" maxLength={280} defaultValue={text(v.note)} autoComplete="off" />}
      </FormField>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Mark complete
        </SubmitButton>
      </div>
    </form>
  );
}
