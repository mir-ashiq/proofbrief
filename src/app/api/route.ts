// ProofBrief — lightweight health check for setup troubleshooting.
// Reports whether the server has a Clocked key configured; never echoes the key.

import { NextResponse } from "next/server";
import { hasApiKey } from "@/lib/clocked";

export async function GET() {
  return NextResponse.json({
    app: "ProofBrief",
    ok: true,
    clockedApiKeyConfigured: hasApiKey(),
    endpoints: ["/clocked/rerank", "/clocked/grounding", "/clocked/compare"],
  });
}
