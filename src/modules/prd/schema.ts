import z from "zod";

export const PrdRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  additionalInfo: z.string().optional(),
});
