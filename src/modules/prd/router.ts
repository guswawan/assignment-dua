import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { PrdRequestSchema } from "./schema.js";
import { prdQueue } from "../../utils/queue.js";
import { prisma } from "../../utils/prisma.js";
import { readFile } from "node:fs/promises";

export const prdRouter = new Hono()
  .get("/", async (c) => {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
    });
    return c.json(projects);
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");

    const project = await prisma.project.findUnique({
      where: { id },
      include: { sections: { include: { evaluations: true } }, consistency: true },
    });

    if (!project) {
      return c.json({ message: "Project not found" }, 404);
    }

    return c.json(project);
  })
  .get("/:id/download", async (c) => {
    const id = c.req.param("id");

    const project = await prisma.project.findUnique({ where: { id } });

    if (!project || !project.filePath) {
      return c.json({ message: "PRD not ready yet" }, 404);
    }

    const content = await readFile(project.filePath);
    const isPdf = project.filePath.endsWith(".pdf");

    c.header("Content-Type", isPdf ? "application/pdf" : "text/markdown");
    c.header("Content-Disposition", `attachment; filename="${id}.${isPdf ? "pdf" : "md"}"`);
    return c.body(content);
  })
  .post("/", zValidator("json", PrdRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const { title, description, additionalInfo } = body;

    console.log("[prd:request] User input received", {
      title,
      description,
      additionalInfo: additionalInfo ?? null,
    });

    const newProject = await prisma.project.create({
      data: {
        title,
        description,
        additionalInfo,
        status: "pending",
      },
    });

    const job = await prdQueue.add("generate-prd", newProject);

    console.log("[prd:response] PRD generation queued", {
      projectId: newProject.id,
      jobId: job.id,
      status: newProject.status,
    });

    return c.json({
      message: "PRD generation is on queue",
      projectId: newProject.id,
    });
  });
