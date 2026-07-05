import { Worker } from "bullmq";
import { PRD_QUEUE_NAME, connection } from "./utils/queue-config.js";
import "dotenv/config";
import { prisma } from "./utils/prisma.js";
import {
  refineBrief,
  generateWithEvaluation,
  ensureDataApiConsistency,
} from "./modules/prd/services.js";
import {
  getProblemStatementPrompt,
  getUserStoriesPrompt,
  getAcceptanceCriteriaPrompt,
  getDataModelPrompt,
  getApiContractPrompt,
  getTechStackPrompt,
} from "./modules/prd/prompts.js";
import { mkdir, writeFile } from "node:fs/promises";
import { writeMarkdownPdf } from "./utils/pdf.js";

const SECTION_TYPES = [
  "problem_statement",
  "user_stories",
  "acceptance_criteria",
  "data_model",
  "api_contract",
  "tech_stack",
] as const;

export const worker = new Worker(
  PRD_QUEUE_NAME,
  async (job) => {
    const projectId = job.data.id;

    console.log("[prd:worker] Job received", {
      jobId: job.id,
      projectId,
      title: job.data.title,
      status: job.data.status,
    });

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "processing" },
    });

    console.log("[prd:worker] Project marked as processing", { projectId });

    const rawBrief = `
        Title: ${job.data.title}
        Description: ${job.data.description}
        Additional Info: ${job.data.additionalInfo ?? "none"}
        `;

    console.log("[prd:worker] Processing user input", {
      projectId,
      rawBrief,
    });

    console.log("[prd:worker] Stage 1 started: refining brief", { projectId });

    const refinedBrief = await refineBrief(rawBrief);

    console.log("[prd:worker] Stage 1 completed: refined brief", {
      projectId,
      refinedBrief,
    });

    await prisma.project.update({
      where: { id: projectId },
      data: { refinedBrief },
    });

    const context = `
        Title: ${refinedBrief.title}
        Description: ${refinedBrief.description}
        Target User: ${refinedBrief.targetUser}
        Scope: ${refinedBrief.scope}
        Key Constraints: ${refinedBrief.keyConstraints.join(", ")}
        Open Assumptions: ${refinedBrief.openAssumptions.join(", ")}
        `;

    const prompts = [
      getProblemStatementPrompt(),
      getUserStoriesPrompt(),
      getAcceptanceCriteriaPrompt(),
      getDataModelPrompt(),
      getApiContractPrompt(),
      getTechStackPrompt(),
    ];

    console.log("[prd:worker] Stage 2 started: generating sections", {
      projectId,
      sections: SECTION_TYPES,
    });

    const results = [];

    for (const [i, prompt] of prompts.entries()) {
      const sectionType = SECTION_TYPES[i];
      const maxTokens = sectionType === "api_contract" ? 1400 : 1800;

      console.log("[prd:worker] Section generation started", {
        projectId,
        sectionType,
        maxTokens,
      });

      const result = await generateWithEvaluation(context, prompt, {
        draftMaxTokens: maxTokens,
        revisionMaxTokens: maxTokens,
      });

      console.log("[prd:worker] Section generation completed", {
        projectId,
        sectionType,
        revised: result.revised,
        evaluation: result.evaluation,
      });

      results.push(result);
    }

    console.log("[prd:worker] Stage 2 completed: all sections generated", {
      projectId,
      sectionCount: results.length,
    });

    console.log("[prd:worker] Persisting section results", { projectId });

    await Promise.all(
      results.map((result, i) =>
        prisma.prdSection.create({
          data: {
            projectId,
            sectionType: SECTION_TYPES[i],
            draft: result.draft,
            finalText: result.finalText,
            revised: result.revised,
            evaluations: {
              create: {
                passed: result.evaluation.passed,
                score: result.evaluation.score,
                feedback: result.evaluation.feedback,
              },
            },
          },
        }),
      ),
    );

    console.log("[prd:worker] Section results persisted", { projectId });

    const [
      problemStatement,
      userStories,
      acceptanceCriteria,
      dataModel,
      apiContract,
      techStack,
    ] = results.map((r) => r.finalText);

    console.log(
      "[prd:worker] Stage 3 started: checking Data Model/API consistency",
      {
        projectId,
      },
    );

    const consistency = await ensureDataApiConsistency(dataModel, apiContract);

    if (consistency.wasReconciled) {
      console.log("[prd:worker] API Contract reconciled against Data Model", {
        projectId,
        issues: consistency.issues,
      });
    } else {
      console.log("[prd:worker] Data Model/API consistency check passed", {
        projectId,
      });
    }

    await prisma.consistencyCheck.create({
      data: {
        projectId,
        consistent: consistency.issues.length === 0,
        issues: consistency.issues,
        reconciledAt: consistency.wasReconciled ? new Date() : null,
      },
    });

    const generatedAt = new Date().toISOString();

    const finalPrd = `# PRD — ${refinedBrief.title}
Generated: ${generatedAt}

${[
  problemStatement,
  userStories,
  acceptanceCriteria,
  dataModel,
  consistency.apiContract,
  techStack,
].join("\n\n")}`;

    await mkdir("reports", { recursive: true });
    const markdownFilePath = `reports/${projectId}.md`;
    const filePath = `reports/${projectId}.pdf`;
    await writeFile(markdownFilePath, finalPrd, "utf-8");
    await writeMarkdownPdf(finalPrd, filePath);

    console.log("[prd:worker] Final PRD written", {
      projectId,
      markdownFilePath,
      filePath,
    });

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "done", filePath },
    });

    console.log("[prd:worker] Job completed", { projectId, filePath });
  },
  { connection },
);

worker.on("failed", async (job, error) => {
  const projectId = job?.data?.id;

  console.error("[prd:worker] Job failed", {
    jobId: job?.id,
    projectId,
    reason: error.message,
    stack: error.stack,
  });

  if (!projectId) {
    return;
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "failed" },
  });
});
