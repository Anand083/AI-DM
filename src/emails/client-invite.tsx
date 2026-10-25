import { Heading, Link, Text } from "@react-email/components";
import { buttonStyle, EmailLayout } from "./layout";

export type ClientInviteProps = {
  /** Agency display name. The only name shown. */
  brandName: string;
  clientName: string;
  url: string;
  supportEmail?: string | null;
};

export function ClientInvite({ brandName, clientName, url, supportEmail }: ClientInviteProps) {
  return (
    <EmailLayout preview={`${brandName} invited you to see your reports`} brandName={brandName}>
      <Heading as="h1" style={{ fontSize: 22 }}>
        See your results online
      </Heading>
      <Text>
        {brandName} invited you to a private page for {clientName}. You can see how your website is
        doing in Google and download your reports.
      </Text>
      <Link href={url} style={buttonStyle}>
        Open your page
      </Link>
      <Text style={{ fontSize: 12, color: "#71717a" }}>
        This link expires in 7 days.
        {supportEmail ? ` Questions? Write to ${supportEmail}.` : ""}
      </Text>
    </EmailLayout>
  );
}
