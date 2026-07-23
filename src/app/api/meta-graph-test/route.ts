export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetaAdAccount = {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  disable_reason?: number;
  currency?: string;
  timezone_name?: string;
};

type MetaApiResponse = {
  data?: MetaAdAccount[];
  paging?: {
    next?: string;
  };
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

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

  try {
    const url = new URL(
      "https://graph.facebook.com/me/adaccounts",
    );

    url.searchParams.set(
      "fields",
      [
        "id",
        "account_id",
        "name",
        "account_status",
        "disable_reason",
        "currency",
        "timezone_name",
      ].join(","),
    );

    url.searchParams.set("limit", "100");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    const payload =
      (await response.json()) as MetaApiResponse;

    if (!response.ok || payload.error) {
      return Response.json(
        {
          ok: false,
          status: response.status,
          error:
            payload.error?.message ??
            "Meta Marketing API 호출에 실패했습니다.",
          metaError: payload.error
            ? {
                type: payload.error.type,
                code: payload.error.code,
                subcode: payload.error.error_subcode,
              }
            : undefined,
        },
        {
          status: response.status || 500,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const accounts = payload.data ?? [];

    return Response.json(
      {
        ok: true,
        accountCount: accounts.length,
        hasNextPage: Boolean(payload.paging?.next),
        accounts,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Meta Graph API test failed:", error);

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Meta Marketing API 연결 중 오류가 발생했습니다.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}