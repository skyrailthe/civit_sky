import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/runpod";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const job = await getJob(id);
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "job status failed" },
      { status: 502 }
    );
  }
}
