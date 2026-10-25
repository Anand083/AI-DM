import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_FILES,
  ACTION_GUARD_MARKERS,
  PAGE_FOLDERS,
  ROUTE_GUARD_MARKERS,
  ROUTES,
} from "./registry";

const root = path.resolve(import.meta.dirname, "../..");

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, found);
    else found.push(rel);
  }
  return found;
}

const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const all = walk("src");

describe("every route handler is registered and guarded", () => {
  const routeFiles = all.filter((f) => f.endsWith("/route.ts")).sort();

  it("has no route handler missing from the registry, and no stale entries", () => {
    expect(routeFiles).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(routeFiles)("%s contains its guard", (file) => {
    const guard = ROUTES[file]!;
    const text = read(file);
    const markers = ROUTE_GUARD_MARKERS[guard];
    if (guard === "provider-secret") {
      expect(markers.some((m) => text.includes(m))).toBe(true);
    } else {
      for (const marker of markers)
        expect(text, `${file} should contain ${marker}`).toContain(marker);
    }
  });

  it("tenant routes check the permission, not just membership", () => {
    for (const [file, guard] of Object.entries(ROUTES)) {
      if (guard !== "tenant") continue;
      const text = read(file);
      // The service the route calls checks `can()`. The route must call a service, not the database.
      expect(text, file).toMatch(/from "@\/server\/services\//);
      expect(text, file).not.toMatch(/from "@\/server\/db/);
    }
  });
});

describe("every server action file is registered and guarded", () => {
  const actionFiles = all
    .filter((f) => /\.tsx?$/.test(f) && read(f).trimStart().startsWith('"use server"'))
    .sort();

  it("has no action file missing from the registry, and no stale entries", () => {
    expect(actionFiles).toEqual(Object.keys(ACTION_FILES).sort());
  });

  it.each(actionFiles)("%s uses its guard", (file) => {
    const guard = ACTION_FILES[file]!;
    const text = read(file);
    const markers = ACTION_GUARD_MARKERS[guard];
    expect(
      markers.some((m) => text.includes(m)),
      `${file} should use one of ${markers.join(", ")}`,
    ).toBe(true);
  });

  it("tenant action files never read the database directly", () => {
    for (const [file, guard] of Object.entries(ACTION_FILES)) {
      if (guard !== "tenant") continue;
      expect(read(file), file).not.toMatch(/from "@\/server\/db/);
    }
  });

  it("tenant actions are wrapped before they are exported", () => {
    // Every exported function in a tenant file calls something built by withTenantAction.
    for (const [file, guard] of Object.entries(ACTION_FILES)) {
      if (guard !== "tenant") continue;
      const text = read(file);
      const wrapped = [...text.matchAll(/const (\w+) = withTenantAction\(/g)].map((m) => m[1]!);
      expect(wrapped.length, file).toBeGreaterThan(0);
      const exported = [
        ...text.matchAll(/export async function (\w+)\(([^)]*)\)[^{]*\{([\s\S]*?)\n\}/g),
      ];
      for (const [, name, , body] of exported) {
        expect(
          wrapped.some((w) => body!.includes(`${w}(`)),
          `${file}: ${name} must call a wrapped action`,
        ).toBe(true);
      }
    }
  });
});

describe("pages call their own guard", () => {
  for (const { folder, marker } of PAGE_FOLDERS) {
    const pages = all.filter((f) => f.startsWith(`${folder}/`) && f.endsWith("/page.tsx"));
    it(`${folder} has pages to check`, () => {
      expect(pages.length).toBeGreaterThan(3);
    });
    it.each(pages)(`%s calls ${marker}`, (file) => {
      expect(read(file)).toContain(marker);
    });
  }
});
