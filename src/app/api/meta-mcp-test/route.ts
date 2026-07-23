import { createMCPClient } from "@ai-sdk/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const accessToken =
    process.env.META_SYSTEM_USER_ACCESS_TOKEN;

  if (!accessToken) {
    return Response.json(
      {
        ok: false,
        error:
          "META_SYSTEM_USER_ACCESS_TOKEN 환경변수가 없습니다.",
      },
      { status: 500 },
    );
  }

  let client: Awaited<
    ReturnType<typeof createMCPClient>
  > | null = null;

  try {
    client = await createMCPClient({
      transport: {
        type: "http",
        url: "https://mcp.facebook.com/ads",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const tools = await client.tools();
    const toolNames = Object.keys(tools);

    return Response.json(
      {
        ok: true,
        message: "Meta Ads MCP 연결 성공",
        toolCount: toolNames.length,
        tools: toolNames,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Meta Ads MCP test failed:", error);

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Meta Ads MCP 연결 중 알 수 없는 오류가 발생했습니다.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } finally {
    if (client) {
      await client.close().catch((closeError) => {
        console.error(
          "Meta MCP client close failed:",
          closeError,
        );
      });
    }
  }
}