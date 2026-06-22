import { NextRequest, NextResponse } from "next/server";
import { searchImages } from "@/lib/civitai";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const result = await searchImages({
      modelVersionId: sp.get("modelVersionId")
        ? Number(sp.get("modelVersionId"))
        : undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : 30,
      cursor: sp.get("cursor") ?? undefined,
      sort:
        (sp.get("sort") as
          | "Most Reactions"
          | "Most Comments"
          | "Newest"
          | null) ?? "Most Reactions",
      nsfw: sp.get("nsfw") === "false" ? false : true,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "images failed" },
      { status: 502 }
    );
  }
}
