import { NextRequest, NextResponse } from "next/server";
import { startJob } from "@/lib/runpod";
import type { GenerateRequest } from "@/lib/types";
import { isCompatible } from "@/lib/compatibility";

export async function POST(req: NextRequest) {
  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (!body.checkpoint?.downloadUrl) {
    return NextResponse.json(
      { error: "checkpoint is required" },
      { status: 400 }
    );
  }

  // серверная защита: не доверяем клиенту — отсекаем несовместимые доп. источники
  const incompatible = (body.extras ?? []).filter(
    (e) => !isCompatible(body.checkpoint.baseModel, e.baseModel)
  );
  if (incompatible.length > 0) {
    return NextResponse.json(
      {
        error:
          "Несовместимые доп. источники: " +
          incompatible.map((e) => e.name).join(", "),
      },
      { status: 400 }
    );
  }

  try {
    const { id } = await startJob(body);
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generate failed" },
      { status: 502 }
    );
  }
}
