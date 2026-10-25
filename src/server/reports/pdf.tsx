import "server-only";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, initials } from "@/lib/brand";
import { normalizeHex, readableTextOn } from "@/lib/color";
import { formatChange, formatPosition } from "@/lib/rank-math";
import { describeBacklinks } from "@/lib/report-backlinks";
import type { ReportBacklinkRow, ReportKeywordRow, ReportModel } from "@/lib/report-model";

type ReactPdf = typeof import("@react-pdf/renderer");

export type PdfBranding = {
  displayName: string;
  primaryColor: string;
  accentColor: string;
  website: string | null;
  supportEmail: string | null;
  /** PNG or JPEG bytes. WebP must be converted before this point. */
  logo: Buffer | null;
};

/**
 * @react-pdf/renderer is an ES module package. The worker runs as CommonJS, so it is loaded with a
 * dynamic import, and the document is built inside this function from what was loaded.
 */
function createRenderer(rp: ReactPdf) {
  const { Document, Image, Link, Page, Rect, renderToBuffer, StyleSheet, Svg, Text, View } = rp;

  const GRAY = "#52525b";
  const LINE = "#e4e4e7";

  function styles(primary: string, accent: string) {
    return StyleSheet.create({
      page: {
        padding: 36,
        paddingBottom: 56,
        fontSize: 10,
        fontFamily: "Helvetica",
        color: "#18181b",
      },
      header: { flexDirection: "row", alignItems: "center", marginBottom: 18, gap: 10 },
      logo: { width: 36, height: 36, objectFit: "contain" },
      badge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: primary,
        color: readableTextOn(primary),
        textAlign: "center",
        paddingTop: 11,
        fontSize: 12,
        fontFamily: "Helvetica-Bold",
      },
      brandName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
      title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
      meta: { color: GRAY, marginBottom: 14 },
      rule: { height: 3, backgroundColor: accent, marginBottom: 14 },
      h2: {
        fontSize: 13,
        fontFamily: "Helvetica-Bold",
        marginTop: 16,
        marginBottom: 6,
        color: primary,
      },
      p: { lineHeight: 1.5 },
      kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
      kpi: { width: "23%", border: `1 solid ${LINE}`, borderRadius: 4, padding: 8 },
      kpiValue: { fontSize: 16, fontFamily: "Helvetica-Bold" },
      kpiLabel: { color: GRAY, marginTop: 2, fontSize: 8 },
      th: {
        flexDirection: "row",
        borderBottom: `1 solid ${LINE}`,
        paddingVertical: 3,
        fontFamily: "Helvetica-Bold",
      },
      tr: { flexDirection: "row", borderBottom: `1 solid ${LINE}`, paddingVertical: 3 },
      cKeyword: { width: "46%", paddingRight: 6 },
      cNum: { width: "14%" },
      cUrl: { width: "26%", color: GRAY },
      cIssue: { width: "50%", paddingRight: 6 },
      cSev: { width: "16%" },
      cPages: { width: "10%" },
      cFix: { width: "24%" },
      footer: {
        position: "absolute",
        bottom: 24,
        left: 36,
        right: 36,
        flexDirection: "row",
        justifyContent: "space-between",
        color: GRAY,
        fontSize: 8,
      },
      empty: { color: GRAY },
    });
  }

  function pathOf(url: string | null): string {
    if (!url) return "-";
    try {
      return new URL(url).pathname || "/";
    } catch {
      return url;
    }
  }

  const SEVERITY_LABEL = { CRITICAL: "Critical", WARNING: "Warning", NOTICE: "Notice" } as const;

  type S = ReturnType<typeof styles>;

  function Distribution({ model, color }: { model: ReportModel; color: string }) {
    const max = Math.max(1, ...model.distribution.map((d) => d.count));
    const rowH = 18;
    const barW = 300;
    return (
      <Svg width={barW} height={model.distribution.length * rowH}>
        {model.distribution.map((d, i) => (
          <Rect
            key={d.key}
            x={0}
            y={i * rowH + 3}
            width={d.count === 0 ? 0 : Math.max(2, (d.count / max) * barW)}
            height={rowH - 6}
            fill={color}
          />
        ))}
      </Svg>
    );
  }

  function DistributionLabels({ model }: { model: ReportModel }) {
    return (
      <View>
        {model.distribution.map((d) => (
          <View key={d.key} style={{ flexDirection: "row", height: 18, paddingTop: 3 }}>
            <Text style={{ width: 80 }}>{d.label}</Text>
            <Text>{d.count}</Text>
          </View>
        ))}
      </View>
    );
  }

  function LinkRows({ title, rows, s }: { title: string; rows: ReportBacklinkRow[]; s: S }) {
    if (rows.length === 0) return null;
    return (
      <View style={{ marginTop: 4 }}>
        <Text style={[s.p, { fontWeight: 700 }]}>{title}</Text>
        {rows.map((r) => (
          <View key={`${r.domain}-${r.anchor}`} style={s.tr} wrap={false}>
            <Text style={s.cIssue}>{r.domain}</Text>
            <Text style={s.cSev}>{r.dofollow ? "Dofollow" : "Nofollow"}</Text>
            <Text style={s.cPages}>{r.rating}</Text>
          </View>
        ))}
      </View>
    );
  }

  function KeywordTable({ rows, s, empty }: { rows: ReportKeywordRow[]; s: S; empty: string }) {
    if (rows.length === 0) return <Text style={s.empty}>{empty}</Text>;
    return (
      <View>
        <View style={s.th} fixed>
          <Text style={s.cKeyword}>Keyword</Text>
          <Text style={s.cNum}>Position</Text>
          <Text style={s.cNum}>Change</Text>
          <Text style={s.cUrl}>Ranking page</Text>
        </View>
        {rows.map((r) => (
          <View key={r.phrase} style={s.tr} wrap={false}>
            <Text style={s.cKeyword}>{r.phrase}</Text>
            <Text style={s.cNum}>{r.checked ? formatPosition(r.position) : "-"}</Text>
            <Text style={s.cNum}>{formatChange(r.change)}</Text>
            <Text style={s.cUrl}>{pathOf(r.url)}</Text>
          </View>
        ))}
      </View>
    );
  }

  function ReportDocument({ model, branding }: { model: ReportModel; branding: PdfBranding }) {
    const primary = normalizeHex(branding.primaryColor) ?? DEFAULT_PRIMARY;
    const accent = normalizeHex(branding.accentColor) ?? DEFAULT_ACCENT;
    const s = styles(primary, accent);
    const has = (key: ReportModel["sections"][number]) => model.sections.includes(key);
    const k = model.kpis;
    const kpis: [string, string][] = [
      ["Keywords tracked", String(k.tracked)],
      ["Average position", k.averagePosition === null ? "-" : String(k.averagePosition)],
      ["In the top 3", String(k.top3)],
      ["On the first page", String(k.top10)],
      ["Moved up", String(k.improved)],
      ["Moved down", String(k.declined)],
      ["Visibility score", String(k.visibility)],
      ["Average change", k.averageChange === null ? "-" : formatChange(k.averageChange)],
    ];

    return (
      <Document
        title={model.title}
        author={branding.displayName}
        creator={branding.displayName}
        producer={branding.displayName}
      >
        <Page size="A4" style={s.page}>
          <View style={s.header}>
            {branding.logo ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf images have no alt text
              <Image src={branding.logo} style={s.logo} />
            ) : (
              <Text style={s.badge}>{initials(branding.displayName)}</Text>
            )}
            <Text style={s.brandName}>{branding.displayName}</Text>
          </View>
          <View style={s.rule} />
          <Text style={s.title}>{model.title}</Text>
          <Text style={s.meta}>
            {model.clientName} | {model.domain} | {model.period.label}
          </Text>

          {has("summary") ? (
            <View>
              <Text style={s.h2}>Summary</Text>
              <Text style={s.p}>{model.summary}</Text>
              <View style={s.kpiRow}>
                {kpis.map(([label, value]) => (
                  <View key={label} style={s.kpi} wrap={false}>
                    <Text style={s.kpiValue}>{value}</Text>
                    <Text style={s.kpiLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {has("distribution") ? (
            <View wrap={false}>
              <Text style={s.h2}>Ranking distribution</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <DistributionLabels model={model} />
                <Distribution model={model} color={accent} />
              </View>
            </View>
          ) : null}

          {has("movers") ? (
            <View>
              <Text style={s.h2}>Biggest gains</Text>
              <KeywordTable
                rows={model.movers.up}
                s={s}
                empty="No keywords moved up in this period."
              />
              <Text style={s.h2}>Biggest drops</Text>
              <KeywordTable
                rows={model.movers.down}
                s={s}
                empty="No keywords moved down in this period."
              />
            </View>
          ) : null}

          {has("opportunities") ? (
            <View>
              <Text style={s.h2}>Keyword opportunities</Text>
              <Text style={[s.p, { marginBottom: 4 }]}>
                These keywords are close to the top. A little work could move them onto page one.
              </Text>
              <KeywordTable
                rows={model.opportunities}
                s={s}
                empty="No keywords between position 4 and 20."
              />
            </View>
          ) : null}

          {has("audit") ? (
            <View wrap={false}>
              <Text style={s.h2}>Site health</Text>
              {model.audit ? (
                <Text style={s.p}>
                  Health score {model.audit.healthScore} out of 100 on {model.audit.finishedOn}.{" "}
                  {model.audit.pagesCrawled} pages checked. {model.audit.counts.critical} critical,{" "}
                  {model.audit.counts.warning} warnings, {model.audit.counts.notice} notices.
                </Text>
              ) : (
                <Text style={s.empty}>No site check has been finished yet.</Text>
              )}
            </View>
          ) : null}

          {has("backlinks") ? (
            <View>
              <Text style={s.h2}>Backlinks</Text>
              {model.backlinks ? (
                <View>
                  {describeBacklinks(model.backlinks).map((line) => (
                    <Text key={line} style={[s.p, { marginBottom: 4 }]}>
                      {line}
                    </Text>
                  ))}
                  <LinkRows title="Strongest new links" rows={model.backlinks.topNew} s={s} />
                  <LinkRows title="Strongest lost links" rows={model.backlinks.topLost} s={s} />
                </View>
              ) : (
                <Text style={s.empty}>No backlink check has been done yet.</Text>
              )}
            </View>
          ) : null}

          {has("issues") ? (
            <View>
              <Text style={s.h2}>Top issues</Text>
              {model.issues.length === 0 ? (
                <Text style={s.empty}>No issues to show.</Text>
              ) : (
                <View>
                  <View style={s.th}>
                    <Text style={s.cIssue}>Issue</Text>
                    <Text style={s.cSev}>Severity</Text>
                    <Text style={s.cPages}>Pages</Text>
                  </View>
                  {model.issues.map((i) => (
                    <View key={i.code} style={s.tr} wrap={false}>
                      <Text style={s.cIssue}>{i.title}</Text>
                      <Text style={s.cSev}>{SEVERITY_LABEL[i.severity]}</Text>
                      <Text style={s.cPages}>{i.pages}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {has("rankings") ? (
            <View break>
              <Text style={s.h2}>All keyword rankings</Text>
              <KeywordTable rows={model.rankings} s={s} empty="No keywords are tracked yet." />
            </View>
          ) : null}

          {has("notes") && model.notes ? (
            <View wrap={false}>
              <Text style={s.h2}>Notes</Text>
              <Text style={s.p}>{model.notes}</Text>
            </View>
          ) : null}

          <View style={s.footer} fixed>
            <Text>
              {branding.displayName}
              {branding.website ? (
                <Link src={branding.website}>{`  ${branding.website}`}</Link>
              ) : null}
              {branding.supportEmail ? `  ${branding.supportEmail}` : ""}
            </Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      </Document>
    );
  }

  /** Draws the report as a PDF. The agency's name and colours are used, never the platform's. */
  return async function renderReportPdf(
    model: ReportModel,
    branding: PdfBranding,
  ): Promise<Buffer> {
    return renderToBuffer(<ReportDocument model={model} branding={branding} />);
  };
}

export async function renderReportPdf(model: ReportModel, branding: PdfBranding): Promise<Buffer> {
  const render = createRenderer(await import("@react-pdf/renderer"));
  return render(model, branding);
}
