import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const FolderHint = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
});

const ClassifyInput = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  excerpt: z.string().default(""),
  imageDataUrl: z.string().nullable().optional(),
  folders: z.array(FolderHint).default([]),
});

export type SortDecision = {
  folder: string;
  folderDescription: string;
  isNewFolder: boolean;
  summary: string;
  tags: string[];
  reason: string;
  confidence: number;
};

export const classifyFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ClassifyInput.parse(input))
  .handler(async ({ data }): Promise<SortDecision> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured for this app.");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const { streamText, Output, NoObjectGeneratedError } = await import("ai");

    const gateway = createLovableAiGatewayProvider(key, { structuredOutputs: true });
    const model = gateway("google/gemini-3.5-flash");

    const existing = data.folders.length
      ? data.folders
          .map((f) => `- ${f.name}${f.description ? `: ${f.description}` : ""}`)
          .join("\n")
      : "(none yet)";

    const system = [
      "You are a filing assistant that sorts files by their CONTENT, not by file extension.",
      "Pick the single best existing folder when one clearly fits the content.",
      "If no existing folder fits, invent a new, short topical folder name for that domain",
      "(e.g. 'Tax & Finance', 'Medical Records', 'Travel', 'Machine Learning Papers').",
      "Folder names: 1-3 words, Title Case, no emojis, no dates.",
      "Keep the summary under 200 characters and return at most 5 short lowercase tags.",
      "Set isNewFolder true only when the folder is not in the existing list.",
      "confidence is between 0 and 1.",
    ].join(" ");

    const prompt = [
      `File name: ${data.fileName}`,
      `Type: ${data.mimeType}`,
      `Size: ${data.size} bytes`,
      `Existing folders:\n${existing}`,
      data.excerpt ? `Content excerpt:\n"""\n${data.excerpt.slice(0, 8000)}\n"""` : "Content excerpt: (not extractable — judge from name, type and any image provided)",
    ].join("\n\n");

    const schema = z.object({
      folder: z.string(),
      folderDescription: z.string(),
      isNewFolder: z.boolean(),
      summary: z.string(),
      tags: z.array(z.string()),
      reason: z.string(),
      confidence: z.number(),
    });

    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (data.imageDataUrl) {
      content.push({ type: "image", image: data.imageDataUrl });
    }

    try {
      const result = streamText({
        model,
        system,
        messages: [{ role: "user", content: content as never }],
        output: Output.object({ schema }),
      });
      const output = await result.output;
      return {
        folder: output.folder.trim() || "Unsorted",
        folderDescription: output.folderDescription ?? "",
        isNewFolder: Boolean(output.isNewFolder),
        summary: output.summary ?? "",
        tags: (output.tags ?? []).slice(0, 5),
        reason: output.reason ?? "",
        confidence: Math.max(0, Math.min(1, Number(output.confidence) || 0.5)),
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          folder: "Unsorted",
          folderDescription: "Files the assistant could not classify",
          isNewFolder: true,
          summary: "",
          tags: [],
          reason: "The assistant could not read this file's content.",
          confidence: 0,
        };
      }
      throw error;
    }
  });