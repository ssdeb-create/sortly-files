import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SummarizeInput = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  excerpt: z.string().default(""),
  imageDataUrl: z.string().nullable().optional(),
});

export type FileSummary = {
  summary: string;
  keyPoints: string[];
  tags: string[];
};

export const summarizeFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SummarizeInput.parse(input))
  .handler(async ({ data }): Promise<FileSummary> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured for this app.");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const { streamText, Output, NoObjectGeneratedError } = await import("ai");

    const gateway = createLovableAiGatewayProvider(key, { structuredOutputs: true });
    const model = gateway("google/gemini-3.5-flash");

    const system = [
      "You summarize a single file for someone skimming it inside a file manager.",
      "Write a plain, concrete summary of what the file actually contains (max 320 characters).",
      "Then give 2-5 short key points (max 90 characters each) and at most 5 lowercase tags.",
      "Never invent details that are not in the content.",
    ].join(" ");

    const prompt = [
      `File name: ${data.fileName}`,
      `Type: ${data.mimeType}`,
      data.excerpt
        ? `Content:\n"""\n${data.excerpt.slice(0, 12000)}\n"""`
        : "Content: (not extractable as text — judge from the name, type and any image provided)",
    ].join("\n\n");

    const schema = z.object({
      summary: z.string(),
      keyPoints: z.array(z.string()),
      tags: z.array(z.string()),
    });

    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (data.imageDataUrl) content.push({ type: "image", image: data.imageDataUrl });

    try {
      const result = streamText({
        model,
        system,
        messages: [{ role: "user", content: content as never }],
        output: Output.object({ schema }),
      });
      const output = await result.output;
      return {
        summary: (output.summary ?? "").trim(),
        keyPoints: (output.keyPoints ?? []).slice(0, 5),
        tags: (output.tags ?? []).slice(0, 5),
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return { summary: "", keyPoints: [], tags: [] };
      }
      throw error;
    }
  });
