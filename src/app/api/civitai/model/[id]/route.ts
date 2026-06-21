import { NextRequest, NextResponse } from "next/server";
import { getModel } from "@/lib/civitai";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const model = await getModel(Number(id));
    return NextResponse.json(model);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "getModel failed" },
      { status: 502 }
    );
  }
}
