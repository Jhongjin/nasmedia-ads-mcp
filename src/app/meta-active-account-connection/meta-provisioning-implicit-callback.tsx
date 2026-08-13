"use client";

import { useEffect, useState } from "react";

export function MetaProvisioningImplicitCallback() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = parameters.get("access_token");
    const oauthState = parameters.get("state");
    const expiresIn = Number(parameters.get("expires_in"));

    if (!accessToken || !oauthState) {
      return;
    }

    // Remove the fragment before the browser can retain the one-time token in
    // history. The value is sent only to the same-origin protected route.
    window.history.replaceState(null, "", window.location.pathname);

    void fetch("/api/auth/meta/inventory/provisioning/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        accessToken,
        state: oauthState,
        expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("provisioning callback failed");
        }

        window.location.replace("/meta-active-account-connection");
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return <p className="access-check-message">Meta 권한 결과를 처리하지 못했습니다. 다시 시도해 주세요.</p>;
  }

  return null;
}
