const forbiddenHost = /^(?:localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?)$/i;

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url");
  if (!source) return new Response("Image URL is missing.", { status: 400 });

  let target: URL;
  try {
    target = new URL(source);
  } catch {
    return new Response("Invalid image URL.", { status: 400 });
  }
  if (!["https:", "http:"].includes(target.protocol) || forbiddenHost.test(target.hostname)) {
    return new Response("This image URL is not allowed.", { status: 400 });
  }

  try {
    const response = await fetch(target, {
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
        "user-agent": "GenPro Rack Builder/1.0",
      },
    });
    if (!response.ok) return new Response("The image could not be loaded.", { status: 502 });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return new Response("The URL does not point to an image.", { status: 415 });
    }
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > 12_000_000) return new Response("The image is too large.", { status: 413 });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 12_000_000) return new Response("The image is too large.", { status: 413 });
    return new Response(bytes, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400",
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return new Response("The image could not be retrieved.", { status: 502 });
  }
}
