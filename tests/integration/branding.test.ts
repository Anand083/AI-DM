import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { getStorage } from "@/server/providers/storage";
import { ForbiddenError, ValidationError } from "@/server/services/errors";
import {
  MAX_LOGO_BYTES,
  MAX_LOGO_SIDE,
  detectImageKind,
  processLogo,
} from "@/server/services/logo";
import {
  getBranding,
  loadBranding,
  readLogo,
  removeLogo,
  setLogo,
  updateBranding,
} from "@/server/services/branding";
import { createAgencyWithMembers, createUser } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

let sessionUserId: string | null = null;
vi.mock("@/server/auth/session", () => ({
  getSessionUser: async () =>
    sessionUserId
      ? {
          id: sessionUserId,
          name: "T",
          email: "t@example.test",
          emailVerified: true,
          isSuperAdmin: false,
          timezone: "UTC",
        }
      : null,
}));

const prisma = createTestClient();

const flat = (width: number, height: number, format: "png" | "jpeg" | "webp") =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    [format]()
    .toBuffer();

const noise = (size: number) => {
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
};

const input = {
  displayName: "Bright Studio",
  primaryColor: "#112233",
  accentColor: "#ABCDEF",
  supportEmail: "Help@Bright.example",
  website: "www.bright.example/about",
};

async function setup() {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    "Original Agency",
  );
  return { agency, owner: members[0]!, admin: members[1]!, member: members[2]! };
}

beforeAll(async () => {
  await resetDb(prisma);
});
beforeEach(() => {
  sessionUserId = null;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("processLogo", () => {
  it("accepts PNG, JPG and WebP and keeps the format", async () => {
    for (const [format, type] of [
      ["png", "image/png"],
      ["jpeg", "image/jpeg"],
      ["webp", "image/webp"],
    ] as const) {
      const result = await processLogo(await flat(200, 100, format));
      expect(result.contentType).toBe(type);
      expect([result.width, result.height]).toEqual([200, 100]);
      expect(detectImageKind(result.bytes)).toBe(format);
    }
  });

  it("shrinks big images to fit 512 by 512 and never enlarges small ones", async () => {
    const big = await processLogo(await flat(2000, 1000, "png"));
    expect([big.width, big.height]).toEqual([MAX_LOGO_SIDE, 256]);
    const small = await processLogo(await flat(40, 40, "png"));
    expect([small.width, small.height]).toEqual([40, 40]);
  });

  it("rejects SVG, even when it pretends to be something else", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(processLogo(svg)).rejects.toMatchObject({
      fieldErrors: { logo: expect.stringMatching(/SVG/) },
    });
    await expect(processLogo(Buffer.from('<?xml version="1.0"?><svg></svg>'))).rejects.toThrow(
      /SVG/,
    );
    await expect(processLogo(Buffer.from("  \n<SVG></SVG>"))).rejects.toThrow(/SVG/);
  });

  it("rejects files over 1 MB", async () => {
    const huge = await noise(800);
    expect(huge.length).toBeGreaterThan(MAX_LOGO_BYTES);
    await expect(processLogo(huge)).rejects.toMatchObject({
      fieldErrors: { logo: "The logo must be 1 MB or smaller." },
    });
  });

  it("rejects files that are not images, empty files, and broken images", async () => {
    await expect(processLogo(Buffer.from("just some text"))).rejects.toThrow(/PNG, JPG or WebP/);
    await expect(processLogo(Buffer.from("%PDF-1.7 ..."))).rejects.toThrow(/PNG, JPG or WebP/);
    await expect(processLogo(Buffer.alloc(0))).rejects.toThrow(/Choose an image/);
    const png = await flat(50, 50, "png");
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.from("garbage garbage garbage")]);
    await expect(processLogo(broken)).rejects.toThrow(/could not be read/);
    await expect(processLogo(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("removes hidden data by writing the image again", async () => {
    const withMeta = await sharp({
      create: { width: 30, height: 30, channels: 3, background: "#fff" },
    })
      .withMetadata({ exif: { IFD0: { Copyright: "secret-copyright-text" } } })
      .jpeg()
      .toBuffer();
    expect(withMeta.includes(Buffer.from("secret-copyright-text"))).toBe(true);
    const result = await processLogo(withMeta);
    expect(result.bytes.includes(Buffer.from("secret-copyright-text"))).toBe(false);
  });
});

describe("branding settings", () => {
  it("starts with the agency name and default colours", async () => {
    const s = await setup();
    expect(await getBranding(s.member.ctx)).toEqual({
      displayName: "Original Agency",
      primaryColor: "#18181b",
      accentColor: "#2563eb",
      supportEmail: null,
      website: null,
      hasLogo: false,
      logoVersion: null,
      customized: false,
    });
  });

  it("saves cleaned values, shows them to the whole team, and logs the change", async () => {
    const s = await setup();
    const saved = await updateBranding(s.admin.ctx, input);
    expect(saved).toMatchObject({
      displayName: "Bright Studio",
      primaryColor: "#112233",
      accentColor: "#abcdef",
      supportEmail: "help@bright.example",
      website: "https://bright.example",
      customized: true,
    });
    expect(await getBranding(s.member.ctx)).toEqual(saved);
    await updateBranding(s.owner.ctx, {
      ...input,
      displayName: "Second Name",
      supportEmail: "",
      website: "",
    });
    expect(await loadBranding(s.agency.id)).toMatchObject({
      displayName: "Second Name",
      supportEmail: null,
      website: null,
    });
    expect(await prisma.branding.count({ where: { agencyId: s.agency.id } })).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: { agencyId: s.agency.id, action: "branding.updated" },
      }),
    ).toBe(2);
  });

  it("validates every field", async () => {
    const s = await setup();
    const bad = (patch: object) => updateBranding(s.owner.ctx, { ...input, ...patch });
    await expect(bad({ displayName: "x" })).rejects.toMatchObject({
      fieldErrors: { displayName: expect.any(String) },
    });
    await expect(bad({ primaryColor: "blue" })).rejects.toMatchObject({
      fieldErrors: { primaryColor: expect.stringContaining("hex code") },
    });
    await expect(bad({ accentColor: "#12" })).rejects.toMatchObject({
      fieldErrors: { accentColor: expect.any(String) },
    });
    await expect(bad({ supportEmail: "nope" })).rejects.toMatchObject({
      fieldErrors: { supportEmail: expect.any(String) },
    });
    await expect(bad({ website: "not a site" })).rejects.toMatchObject({
      fieldErrors: { website: expect.any(String) },
    });
    await expect(bad({ primaryColor: "#fff; background:url(//evil)" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("only owners and admins can change it, and client users cannot read it", async () => {
    const s = await setup();
    await expect(updateBranding(s.member.ctx, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setLogo(s.member.ctx, await flat(50, 50, "png"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(removeLogo(s.member.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getBranding({ ...s.owner.ctx, role: "CLIENT" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("keeps agencies apart", async () => {
    const a = await setup();
    const b = await setup();
    await updateBranding(a.owner.ctx, input);
    expect((await getBranding(b.owner.ctx)).displayName).toBe(b.agency.name);
  });
});

describe("logo storage", () => {
  it("saves a logo, replaces it (deleting the old file), and removes it", async () => {
    const s = await setup();
    const first = await setLogo(s.owner.ctx, await flat(300, 300, "png"));
    expect(first.hasLogo).toBe(true);
    const row1 = await prisma.branding.findUniqueOrThrow({ where: { agencyId: s.agency.id } });
    expect(row1.logoKey).toMatch(new RegExp(`^branding/${s.agency.id}/logo-[0-9a-f]{12}\\.png$`));
    expect(row1.displayName).toBe("Original Agency"); // created with the agency name
    const stored = await readLogo(s.agency.id);
    expect(stored?.contentType).toBe("image/png");
    expect(detectImageKind(stored!.bytes)).toBe("png");

    const second = await setLogo(s.admin.ctx, await flat(100, 100, "jpeg"));
    expect(second.logoVersion).not.toBe(first.logoVersion);
    const row2 = await prisma.branding.findUniqueOrThrow({ where: { agencyId: s.agency.id } });
    expect(row2.logoContentType).toBe("image/jpeg");
    expect(await getStorage().get(row1.logoKey!)).toBeNull(); // old file is gone
    expect((await readLogo(s.agency.id))?.contentType).toBe("image/jpeg");

    const removed = await removeLogo(s.owner.ctx);
    expect(removed.hasLogo).toBe(false);
    expect(await getStorage().get(row2.logoKey!)).toBeNull();
    expect(await readLogo(s.agency.id)).toBeNull();
    await expect(removeLogo(s.owner.ctx)).resolves.toMatchObject({ hasLogo: false });
  });

  it("does not store anything when the upload is refused", async () => {
    const s = await setup();
    await expect(setLogo(s.owner.ctx, Buffer.from("<svg></svg>"))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await prisma.branding.count({ where: { agencyId: s.agency.id } })).toBe(0);
  });

  it("never serves another agency's logo", async () => {
    const a = await setup();
    const b = await setup();
    await setLogo(a.owner.ctx, await flat(60, 60, "png"));
    expect(await readLogo(b.agency.id)).toBeNull();
  });
});

describe("logo route", () => {
  async function routeSetup() {
    const s = await setup();
    const outsider = await createUser(prisma);
    const route = await import("@/app/app/[agencySlug]/branding/logo/route");
    const params = Promise.resolve({ agencySlug: s.agency.slug });
    return { s, outsider, route, params };
  }
  const upload = async (bytes: Buffer, name = "logo.png", type = "image/png") => {
    const form = new FormData();
    form.set("logo", new File([new Uint8Array(bytes)], name, { type }));
    return new Request("http://localhost/logo", { method: "POST", body: form });
  };

  it("lets an owner upload and any team member download, with safe headers", async () => {
    const { s, route, params } = await routeSetup();
    sessionUserId = s.owner.user.id;
    const res = await route.POST(await upload(await flat(100, 100, "png")), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).logoVersion).toMatch(/^[0-9a-f]{12}$/);

    sessionUserId = s.member.user.id;
    const get = await route.GET(new Request("http://localhost/logo"), { params });
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(get.headers.get("cache-control")).toContain("private");
    expect(get.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(detectImageKind(Buffer.from(await get.arrayBuffer()))).toBe("png");
  });

  it("answers 401 without a session, 404 to strangers, 403 to members who upload, 400 for bad files", async () => {
    const { s, outsider, route, params } = await routeSetup();
    const get = () => route.GET(new Request("http://localhost/logo"), { params });
    expect((await get()).status).toBe(401);
    sessionUserId = outsider.id;
    expect((await get()).status).toBe(404);
    expect((await route.POST(await upload(await flat(10, 10, "png")), { params })).status).toBe(
      404,
    );
    sessionUserId = s.member.user.id;
    expect((await route.POST(await upload(await flat(10, 10, "png")), { params })).status).toBe(
      403,
    );
    sessionUserId = s.owner.user.id;
    const svg = await route.POST(
      await upload(Buffer.from("<svg></svg>"), "logo.png", "image/png"),
      { params },
    );
    expect(svg.status).toBe(400);
    expect((await svg.json()).fieldErrors.logo).toMatch(/SVG/);
    // A big file is refused either by its announced size (413) or after reading it (400).
    const big = await route.POST(await upload(await noise(800)), { params });
    expect([400, 413]).toContain(big.status);
    expect((await big.json()).fieldErrors.logo).toBe("The logo must be 1 MB or smaller.");
    const announced = new Request("http://localhost/logo", {
      method: "POST",
      headers: { "content-length": String(5 * 1024 * 1024) },
      body: new FormData(),
    });
    expect((await route.POST(announced, { params })).status).toBe(413);
    const noFile = await route.POST(
      new Request("http://localhost/logo", { method: "POST", body: new FormData() }),
      { params },
    );
    expect(noFile.status).toBe(400);
    expect((await get()).status).toBe(404); // nothing was saved
  });

  it("deletes the logo", async () => {
    const { s, route, params } = await routeSetup();
    sessionUserId = s.owner.user.id;
    await route.POST(await upload(await flat(30, 30, "webp"), "l.webp", "image/webp"), { params });
    expect(
      (await route.DELETE(new Request("http://localhost/logo", { method: "DELETE" }), { params }))
        .status,
    ).toBe(200);
    expect((await route.GET(new Request("http://localhost/logo"), { params })).status).toBe(404);
    sessionUserId = s.member.user.id;
    expect(
      (await route.DELETE(new Request("http://localhost/logo", { method: "DELETE" }), { params }))
        .status,
    ).toBe(403);
  });
});

void db;
