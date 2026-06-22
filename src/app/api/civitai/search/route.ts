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
      cursor: sp.get("cursor") ?? undefined,
      sort:
        (sp.get("sort") as
          | "Highest Rated"
          | "Most Downloaded"
          | "Newest"
          | null) ?? "Most Downloaded",
      // по умолчанию включаем NSFW — иначе Civitai не отдаёт превью таких моделей
      nsfw: sp.get("nsfw") === "false" ? false : true,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 502 }
    );
  }
}
