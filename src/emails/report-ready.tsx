import { Heading, Link, Text } from "@react-email/components";
import { buttonStyle, EmailLayout } from "./layout";

export type ReportReadyProps = {
  /** Agency display name. The only name shown. */
  brandName: string;
  projectName: string;
  periodLabel: string;
  summary: string;
  /** Link to the online report. Set when the PDF is too big to attach. */
  url?: string;
  /** True when the PDF is attached. */
  attached: boolean;
  supportEmail?: string | null;
};

export function ReportReady({
  brandName,
  projectName,
  periodLabel,
  summary,
  url,
  attached,
  supportEmail,
}: ReportReadyProps) {
  return (
    <EmailLayout preview={`Your ${projectName} report is ready`} brandName={brandName}>
      <Heading as="h1" style={{ fontSize: 22 }}>
        Your {projectName} report
      </Heading>
      <Text style={{ color: "#52525b" }}>{periodLabel}</Text>
      <Text>{summary}</Text>
      {attached ? <Text>The full report is attached to this email as a PDF.</Text> : null}
      {url ? (
        <Link href={url} style={buttonStyle}>
          Open the report
        </Link>
      ) : null}
      {supportEmail ? (
        <Text style={{ fontSize: 12, color: "#71717a" }}>
          Questions? Reply to this email or write to {supportEmail}.
        </Text>
      ) : null}
    </EmailLayout>
  );
}
