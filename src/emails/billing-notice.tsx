import { Heading, Link, Text } from "@react-email/components";
import { buttonStyle, EmailLayout } from "./layout";

export type BillingNoticeProps = {
  /** The platform name: these emails go to agency owners, not to client users. */
  brandName: string;
  preview: string;
  heading: string;
  paragraphs: string[];
  actionLabel: string;
  url: string;
};

export function BillingNotice({
  brandName,
  preview,
  heading,
  paragraphs,
  actionLabel,
  url,
}: BillingNoticeProps) {
  return (
    <EmailLayout preview={preview} brandName={brandName}>
      <Heading as="h1" style={{ fontSize: 22 }}>
        {heading}
      </Heading>
      {paragraphs.map((p) => (
        <Text key={p}>{p}</Text>
      ))}
      <Link href={url} style={buttonStyle}>
        {actionLabel}
      </Link>
    </EmailLayout>
  );
}
