import express from "express";
import { z } from "zod";
import { reconcileIdentity } from "./lib/identity";

const app = express();
app.use(express.json());

const identifyBodySchema = z
  .object(
    {
      email: z.email().trim().nullable().optional(),
      phoneNumber: z.string().trim().min(1).nullable().optional(),
    },
    { error: "Invalid request body" },
  )
  .strict()
  .superRefine((data, ctx) => {
    const email = data.email ?? null;
    const phoneNumber = data.phoneNumber ?? null;

    if (email === null && phoneNumber === null) {
      ctx.addIssue({
        code: "custom",
        message: "At least one of email or phoneNumber must be provided",
      });
    }
  });

function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  return email.toLowerCase();
}

function validateIdentifyPayload(req: any, res: any, next: any): void {
  const parsedBody = identifyBodySchema.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(400).json({
      message: "Invalid request body",
      errors: parsedBody.error.flatten(),
    });
    return;
  }

  req.identifyPayload = parsedBody.data;
  next();
}

app.get("/health", (_req: any, res: any) => {
  res.status(200).json({ status: "ok" });
});

app.post("/identify", validateIdentifyPayload, async (req: any, res: any) => {
  try {
    const normalizedInput = {
      email: normalizeEmail(req.identifyPayload.email),
      phoneNumber: req.identifyPayload.phoneNumber ?? null,
    };

    const reconciliationResult = await reconcileIdentity(
      normalizedInput.email,
      normalizedInput.phoneNumber,
    );

    return res.status(200).json({
      message: "Identity reconciled",
      input: normalizedInput,
      reconciliation: reconciliationResult,
    });
  } catch (error) {
    console.error("Identify failed", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
