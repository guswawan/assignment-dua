import { createCompletion, createParsedCompletion } from "@anvia/core";
import { z } from "zod";
import { getClient } from "../../utils/openai-config.js";

function getModel() {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
  const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
  const client = getClient({
    apiKey: OPENAI_API_KEY,
    baseUrl: OPENAI_BASE_URL,
  });
  return client.completionModel(OPENAI_MODEL);
}

// ---------------------------------------------------------------------------
// Pattern 1: Fan-out / Fan-in
// 3 specialists review the raw brief in parallel, then their reviews are
// synthesized into one refined brief that feeds Stage 2.
// ---------------------------------------------------------------------------

const specialistPrompts: Record<string, { persona: string; focus: string }> = {
  product: {
    persona: "You are a senior product manager reviewing a raw product brief.",
    focus:
      "Identify the core user value, missing target-user detail, and any scope that is unclear or too broad for an MVP.",
  },
  engineering: {
    persona:
      "You are a senior software engineer reviewing a raw product brief.",
    focus:
      "Identify implementation risks, missing technical constraints, and any requirement that is ambiguous enough to cause wrong assumptions during coding.",
  },
  business: {
    persona:
      "You are a pragmatic business analyst reviewing a raw product brief.",
    focus:
      "Identify unclear success criteria, unstated constraints (budget, timeline, users), and anything that would make the scope hard to validate.",
  },
};

async function reviewBrief(rawBrief: string) {
  return Promise.all(
    Object.entries(specialistPrompts).map(
      async ([role, { persona, focus }]) => {
        const review = await createCompletion(getModel(), {
          instructions: `${persona} ${focus} Be concise: 3 to 5 bullet points only.`,
          input: rawBrief,
          maxTokens: 400,
        });

        return { role, review: review.text };
      },
    ),
  );
}

export const RefinedBriefSchema = z.object({
  title: z.string(),
  description: z.string(),
  targetUser: z.string(),
  scope: z.string(),
  keyConstraints: z.array(z.string()),
  openAssumptions: z.array(z.string()),
});

export type RefinedBrief = z.infer<typeof RefinedBriefSchema>;

async function synthesizeRefinedBrief(
  rawBrief: string,
  reviews: { role: string; review: string }[],
) {
  return createParsedCompletion(getModel(), {
    instructions:
      "Synthesize the specialist reviews into one refined product brief. Resolve conflicting concerns by favoring the smallest viable scope. State unresolved gaps as openAssumptions rather than guessing silently.",
    input: `Raw brief:\n${rawBrief}\n\nSpecialist reviews:\n${JSON.stringify(reviews, null, 2)}`,
    schema: RefinedBriefSchema,
    maxTokens: 800,
  });
}

export async function refineBrief(rawBrief: string): Promise<RefinedBrief> {
  const reviews = await reviewBrief(rawBrief);
  const synthesis = await synthesizeRefinedBrief(rawBrief, reviews);

  return synthesis.data;
}

// ---------------------------------------------------------------------------
// Pattern 2: Evaluator-Optimizer
// Each PRD section is generated, evaluated against a rubric, and revised
// if it fails, before being accepted as final.
// ---------------------------------------------------------------------------

interface GenerationOptions {
  draftMaxTokens?: number;
  revisionMaxTokens?: number;
}

async function generateDraft(
  context: string,
  instructions: string,
  maxTokens = 1800,
) {
  const response = await createCompletion(getModel(), {
    instructions,
    input: context,
    maxTokens,
  });

  return response.text;
}

const EvaluationSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(1).max(5),
  feedback: z.string(),
});

async function evaluateDraft(
  context: string,
  instructions: string,
  draft: string,
) {
  return createParsedCompletion(getModel(), {
    instructions: `Evaluate whether the draft correctly follows the required <output_format> and rules from the task instructions below. Check specificity, absence of fabricated data, and proportionate scope.\n\nTask instructions:\n${instructions}`,
    input: `Context:\n${context}\n\nDraft:\n${draft}`,
    schema: EvaluationSchema,
    maxTokens: 500,
  });
}

async function reviseDraft(
  context: string,
  instructions: string,
  draft: string,
  feedback: string,
  maxTokens = 1800,
) {
  const response = await createCompletion(getModel(), {
    instructions: `Revise the draft using the evaluator feedback. Keep the same <output_format> from the original task instructions.\n\nOriginal task instructions:\n${instructions}`,
    input: `Context:\n${context}\n\nDraft:\n${draft}\n\nEvaluator feedback:\n${feedback}`,
    maxTokens,
  });

  return response.text;
}

export interface SectionResult {
  draft: string;
  finalText: string;
  revised: boolean;
  evaluation: z.infer<typeof EvaluationSchema>;
}

export async function generateWithEvaluation(
  context: string,
  instructions: string,
  options: GenerationOptions = {},
): Promise<SectionResult> {
  const draft = await generateDraft(
    context,
    instructions,
    options.draftMaxTokens,
  );
  const evaluation = await evaluateDraft(context, instructions, draft);
  const passed = evaluation.data.score >= 4;
  let finalText = draft;
  let revised = false;

  if (!passed) {
    finalText = await reviseDraft(
      context,
      instructions,
      draft,
      evaluation.data.feedback,
      options.revisionMaxTokens,
    );
    revised = true;
  }

  return {
    draft,
    finalText,
    revised,
    evaluation: { ...evaluation.data, passed },
  };
}

// ---------------------------------------------------------------------------
// Document-level evaluator: cross-check Data Model <-> API Contract
// (these two sections are generated independently in Stage 2, so they can
// drift; this closes that gap by treating Data Model as source of truth)
// ---------------------------------------------------------------------------

const ConsistencySchema = z.object({
  consistent: z.boolean(),
  issues: z.array(z.string()),
});

function limitText(value: string, maxLength = 3500) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n\n[Truncated for consistency check]`;
}

async function evaluateConsistency(dataModel: string, apiContract: string) {
  return createParsedCompletion(getModel(), {
    instructions:
      "Check only critical consistency between Data Model and API Contract. Return at most 5 issues. Be concise. Flag undefined entities/fields and missing endpoint coverage for clearly user-manageable entities.",
    input: `Data Model:\n${limitText(dataModel)}\n\nAPI Contract:\n${limitText(apiContract)}`,
    schema: ConsistencySchema,
    maxTokens: 250,
  });
}

async function reconcileApiContract(
  dataModel: string,
  apiContract: string,
  issues: string[],
) {
  const response = await createCompletion(getModel(), {
    instructions:
      "Revise the API Contract so it is fully consistent with the given Data Model. Fix only the listed issues. Keep the same output format/structure as the original API Contract.",
    input: `Data Model (source of truth):\n${dataModel}\n\nCurrent API Contract:\n${apiContract}\n\nIssues to fix:\n- ${issues.join("\n- ")}`,
    maxTokens: 3000,
  });

  return response.text;
}

export interface ConsistencyResult {
  apiContract: string;
  wasReconciled: boolean;
  issues: string[];
}

export async function ensureDataApiConsistency(
  dataModel: string,
  apiContract: string,
): Promise<ConsistencyResult> {
  let check: Awaited<ReturnType<typeof evaluateConsistency>>;

  try {
    check = await evaluateConsistency(dataModel, apiContract);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      apiContract,
      wasReconciled: false,
      issues: [`Consistency check failed: ${message}`],
    };
  }

  if (check.data.consistent) {
    return { apiContract, wasReconciled: false, issues: [] };
  }

  let reconciled: string;

  try {
    reconciled = await reconcileApiContract(
      dataModel,
      apiContract,
      check.data.issues,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      apiContract,
      wasReconciled: false,
      issues: [...check.data.issues, `API reconciliation failed: ${message}`],
    };
  }

  return {
    apiContract: reconciled,
    wasReconciled: true,
    issues: check.data.issues,
  };
}
