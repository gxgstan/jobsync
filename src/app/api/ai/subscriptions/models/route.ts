import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { subscriptionModels } from "@/lib/ai/subscription-model";

export async function GET(request: NextRequest) {
  if (!(await auth())?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const provider = request.nextUrl.searchParams.get("provider");
  if (provider !== "claude-code" && provider !== "codex") {
    return NextResponse.json({ error: "Unknown subscription provider" }, { status: 400 });
  }
  try {
    return NextResponse.json(await subscriptionModels(provider, request.nextUrl.searchParams.get("refresh") === "1"));
  } catch {
    return NextResponse.json({ error: "Could not load subscription models from Tinyboy. Retry or reconnect the account on the server." }, { status: 503 });
  }
}
