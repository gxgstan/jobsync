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
    return NextResponse.json(await subscriptionModels(provider));
  } catch {
    return NextResponse.json({ error: "Subscription sign-in is unavailable on Tinyboy. Reconnect the account on the server." }, { status: 503 });
  }
}
