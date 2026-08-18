import { ASSETS } from "@/models/assets";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const type = url.searchParams.get("type");

  const assets = ASSETS.filter((asset) => {
    if (category && asset.category !== category) return false;
    if (type && asset.type !== type) return false;
    return true;
  });

  return Response.json({ assets });
}
