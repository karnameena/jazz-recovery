export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function bytesToBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function serializeCredential(credential: PublicKeyCredential) {
  const response = credential.response;
  const base = { id: credential.id, rawId: bytesToBase64Url(credential.rawId), type: credential.type };
  if (response instanceof AuthenticatorAttestationResponse) {
    return { ...base, response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      attestationObject: bytesToBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : []
    } };
  }
  const assertion = response as AuthenticatorAssertionResponse;
  return { ...base, response: {
    clientDataJSON: bytesToBase64Url(assertion.clientDataJSON),
    authenticatorData: bytesToBase64Url(assertion.authenticatorData),
    signature: bytesToBase64Url(assertion.signature),
    userHandle: assertion.userHandle ? bytesToBase64Url(assertion.userHandle) : null
  } };
}
