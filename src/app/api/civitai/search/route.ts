import { NextRequest, NextResponse } from "next/server";
import { searchModels } from "@/lib/civitai";
import type { CivitaiModelType } from "@/lib/types";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const types = sp.getAll("types") as CivitaiModelType[];
  try {
    const result = await searchModels({
      query: sp.get("query") ?? undefined,
      types: types.length ? types : undefined,
      baseModels: sp.getAll("baseModels"),
      limit: sp.get("limit") ? Number(sp.get("limit")) : 24,
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      sort:
        (sp.get("sort") as
          | "Highest Rated"
          | "Most Downloaded"
          | "Newest"
          | null) ?? "Most Downloaded",
      nsfw: sp.get("nsfw") === "true" ? true : false,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 502 }
    );
  }
}
