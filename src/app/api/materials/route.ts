import { DEFAULT_MATERIALS } from "@/models/materials";

export async function GET() {
  return Response.json({ materials: DEFAULT_MATERIALS });
}
