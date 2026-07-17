import { Router } from "express";
import { db } from "@workspace/db";
import { flashAlertsTable } from "@workspace/db";
import { FLASH_PROMPT } from "../lib/prompts";
import { callClaude } from "../lib/anthropicClient";
import { RunFlashAlertBody } from "@workspace/api-zod";

const router = Router();

// POST /flash
router.post("/flash", async (req, res): Promise<void> => {
  const parsed = RunFlashAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { headline } = parsed.data;

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "ANTHROPIC_API_KEY is not configured" });
    return;
  }

  const userMessage = `Breaking event: ${headline}\nConfirm and assess. JSON only.`;

  try {
    const payload = await callClaude(FLASH_PROMPT, userMessage, 500, true, "flash");

    const [inserted] = await db
      .insert(flashAlertsTable)
      .values({
        headline_input: headline,
        payload_json: JSON.stringify(payload),
      })
      .returning();

    if (!inserted) {
      res.status(500).json({ error: "Failed to save flash alert" });
      return;
    }

    res.json({
      id: inserted.id,
      headline_input: inserted.headline_input,
      payload,
      created_at: inserted.created_at.toISOString(),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `Claude API error: ${errMsg}` });
  }
});

export default router;
