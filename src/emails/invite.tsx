import { Heading, Link, Text } from "@react-email/components";
import { buttonStyle, EmailLayout } from "./layout";

export type InviteProps = {
  /** Agency display name. For client invites this is the only name shown. */
  brandName: string;
  inviterName: string;
  roleLabel: string;
  url: string;
};

export function Invite({ brandName, inviterName, roleLabel, url }: InviteProps) {
  return (
    <EmailLayout preview={`${inviterName} invited you to ${brandName}`} brandName={brandName}>
      <Heading as="h1" style={{ fontSize: 22 }}>
        You are invited to {brandName}
      </Heading>
      <Text>
        {inviterName} invited you to join {brandName} as {roleLabel}.
      </Text>
      <Link href={url} style={buttonStyle}>
        Accept invitation
      </Link>
      <Text style={{ fontSize: 12, color: "#71717a" }}>This invitation expires in 7 days.</Text>
    </EmailLayout>
  );
}
